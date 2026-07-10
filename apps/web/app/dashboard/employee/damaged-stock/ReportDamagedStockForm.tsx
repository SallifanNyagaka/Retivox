'use client'
/**
 * Employee damaged stock report form.
 */

import { startTransition, useEffect, useRef, useState, type FormEvent } from 'react'
import { useActionState } from 'react'
import { useRouter } from 'next/navigation'
import { reportDamagedStock, type DamagedStockFormState } from './actions'

export type DamageReportProductOption = {
  productId: string
  name: string
  sku: string | null
  category: string | null
  baseQuantityAvailable: number
  uomOptions: Array<{
    id: string
    name: string
    abbreviation: string
    conversionFactor: number
    isBaseUnit: boolean
    isBaseUom: boolean
    isDefaultPurchaseUom: boolean
    isDefaultSaleUom: boolean
  }>
}

type Props = {
  products: DamageReportProductOption[]
}

function getDefaultUOM(product: DamageReportProductOption | null) {
  if (!product) return null

  return product.uomOptions.find((uom) => uom.isBaseUom || uom.isBaseUnit || uom.conversionFactor === 1) ??
    product.uomOptions.find((uom) => uom.isDefaultPurchaseUom) ??
    product.uomOptions[0] ??
    null
}

function getBaseUOM(product: DamageReportProductOption | null) {
  if (!product) return null

  return product.uomOptions.find((uom) => uom.isBaseUom || uom.isBaseUnit || uom.conversionFactor === 1) ?? product.uomOptions[0] ?? null
}

function formatQuantity(value: number) {
  return value.toLocaleString(undefined, { maximumFractionDigits: 4 })
}

const inputStyle = {
  width: '100%',
  height: 44,
  border: '1px solid var(--color-border)',
  borderRadius: 8,
  padding: '0 12px',
  boxSizing: 'border-box',
  fontSize: 13,
  color: 'var(--color-text-primary)',
  backgroundColor: 'var(--color-background)',
} as const

export default function ReportDamagedStockForm({ products }: Props) {
  const router = useRouter()
  const previousPending = useRef(false)
  const firstProduct = products[0] ?? null
  const firstUom = getDefaultUOM(firstProduct)
  const [productId, setProductId] = useState(firstProduct?.productId ?? '')
  const [uomId, setUomId] = useState(firstUom?.id ?? '')
  const [quantity, setQuantity] = useState('')
  const [lossType, setLossType] = useState<'breakage' | 'spoilage' | 'theft' | 'markdown_damage' | 'other'>('breakage')
  const [reason, setReason] = useState('')
  const [state, action, isPending] = useActionState<DamagedStockFormState, FormData>(reportDamagedStock, {
    success: false,
    error: null,
    message: null,
  })

  const selectedProduct = products.find((product) => product.productId === productId) ?? null
  const selectedUom = selectedProduct?.uomOptions.find((uom) => uom.id === uomId) ?? getDefaultUOM(selectedProduct)
  const baseUom = getBaseUOM(selectedProduct)
  const quantityValue = Number(quantity || 0)
  const baseQuantity = selectedUom && quantityValue > 0 ? quantityValue * selectedUom.conversionFactor : 0
  const exceedsAvailable = selectedProduct ? baseQuantity > selectedProduct.baseQuantityAvailable : false

  useEffect(() => {
    let refreshTimer: ReturnType<typeof setTimeout> | null = null

    if (previousPending.current && !isPending && state.success) {
      setQuantity('')
      setReason('')
      refreshTimer = setTimeout(() => router.refresh(), 0)
    }

    previousPending.current = isPending
    return () => {
      if (refreshTimer) clearTimeout(refreshTimer)
    }
  }, [isPending, router, state.success])

  const onProductChange = (nextProductId: string) => {
    const nextProduct = products.find((product) => product.productId === nextProductId) ?? null
    setProductId(nextProductId)
    setUomId(getDefaultUOM(nextProduct)?.id ?? '')
  }

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (exceedsAvailable) {
      return
    }

    const formData = new FormData()
    formData.set('productId', productId)
    formData.set('uomId', uomId)
    formData.set('quantity', quantity)
    formData.set('lossType', lossType)
    formData.set('reason', reason)

    startTransition(() => action(formData))
  }

  if (products.length === 0) {
    return (
      <div style={{ padding: '28px 16px', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>
        No stocked products are available for damage reporting at your branch.
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-2 text-left" style={{ fontSize: 13, color: 'var(--color-text-primary)' }}>
          Product
          <select value={productId} onChange={(event) => onProductChange(event.target.value)} required style={inputStyle}>
            {products.map((product) => (
              <option key={product.productId} value={product.productId}>
                {product.name}{product.sku ? ` - ${product.sku}` : ''}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-2 text-left" style={{ fontSize: 13, color: 'var(--color-text-primary)' }}>
          Individual unit from product setup
          <select value={uomId} onChange={(event) => setUomId(event.target.value)} required disabled style={{ ...inputStyle, opacity: 0.8 }}>
            {(selectedProduct?.uomOptions ?? []).map((uom) => (
              <option key={uom.id} value={uom.id}>
                {uom.name}{uom.abbreviation ? ` (${uom.abbreviation})` : ''}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-2 text-left" style={{ fontSize: 13, color: 'var(--color-text-primary)' }}>
          Quantity affected
          <input
            type="number"
            min="0.0001"
            step="0.0001"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            required
            style={inputStyle}
          />
        </label>

        <label className="flex flex-col gap-2 text-left" style={{ fontSize: 13, color: 'var(--color-text-primary)' }}>
          Damage type
          <select value={lossType} onChange={(event) => setLossType(event.target.value as typeof lossType)} required style={inputStyle}>
            <option value="breakage">Breakage</option>
            <option value="spoilage">Spoilage</option>
            <option value="theft">Theft or missing</option>
            <option value="markdown_damage">Damaged but sellable</option>
            <option value="other">Other</option>
          </select>
        </label>
      </div>

      <label className="flex flex-col gap-2 text-left" style={{ fontSize: 13, color: 'var(--color-text-primary)' }}>
        What happened?
        <input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          required
          maxLength={240}
          placeholder="e.g. 12 eggs cracked during unloading"
          style={inputStyle}
        />
      </label>

      <div
        className="rounded-xl border"
        style={{
          borderColor: exceedsAvailable ? 'var(--color-danger)' : 'var(--color-border)',
          backgroundColor: 'var(--color-surface)',
          padding: 12,
          fontSize: 12,
          color: 'var(--color-text-muted)',
          lineHeight: 1.5,
        }}
      >
        {selectedProduct && selectedUom && baseUom ? (
          <>
            <p style={{ margin: 0 }}>
              Available stock: {formatQuantity(selectedProduct.baseQuantityAvailable)} {baseUom.name}.
            </p>
            <p style={{ margin: '4px 0 0' }}>
              Reported damage: {formatQuantity(quantityValue)} {selectedUom.name} = {formatQuantity(baseQuantity)} {baseUom.name}.
            </p>
            <p style={{ margin: '4px 0 0' }}>
              The owner will decide whether this damaged stock can be recovered and sold at a reduced price.
            </p>
            {exceedsAvailable && (
              <p style={{ margin: '6px 0 0', color: 'var(--color-danger)', fontWeight: 800 }}>
                This is higher than the available stock. Please check the quantity.
              </p>
            )}
          </>
        ) : (
          <p style={{ margin: 0 }}>Select a product and unit to preview the individual-unit conversion.</p>
        )}
      </div>

      {state.error && (
        <p style={{ margin: 0, color: 'var(--color-danger)', fontSize: 13, fontWeight: 700 }}>{state.error}</p>
      )}
      {state.success && state.message && (
        <p style={{ margin: 0, color: 'var(--color-success)', fontSize: 13, fontWeight: 700 }}>{state.message}</p>
      )}

      <button
        type="submit"
        className="btn-primary"
        disabled={isPending || !productId || !uomId || !quantity || !reason || exceedsAvailable}
        style={{ padding: '10px 16px', borderRadius: 8, opacity: isPending ? 0.75 : 1 }}
      >
        {isPending ? 'Submitting report...' : 'Submit damage report'}
      </button>
    </form>
  )
}
