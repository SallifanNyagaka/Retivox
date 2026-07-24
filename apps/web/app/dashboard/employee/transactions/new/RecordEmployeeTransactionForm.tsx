'use client'
/**
 * Employee web transaction form.
 *
 * The form collects product IDs and quantities only; prices, stock checks,
 * totals, and stock deductions are handled server-side by the atomic RPC.
 */

import { startTransition, useEffect, useRef, useState, type FormEvent } from 'react'
import { useActionState } from 'react'
import { useRouter } from 'next/navigation'
import LoadingOverlay from '../../../../../components/ui/LoadingOverlay'
import Toast from '../../../../../components/ui/Toast'
import { useToast } from '../../../../../lib/hooks/useToast'
import { recordEmployeeTransaction, type EmployeeTransactionFormState } from './actions'

type RecordTransactionAction = (
  previousState: EmployeeTransactionFormState,
  formData: FormData
) => Promise<EmployeeTransactionFormState>

/**
 * Branch-scoped product option available to the employee.
 */
export type EmployeeProductOption = {
  optionId: string
  productId: string
  name: string
  sku: string
  category: string
  unit: string
  sellingPrice: number
  pricingMethod: 'fixed_price' | 'assisted_pack' | 'manual_quantity'
  roundingRule: 'none' | 'nearest_5' | 'up_5' | 'down_5' | 'nearest_10'
  pricingOptions: Array<{
    quantity: number
    baseQuantity: number
    price: number
    maxDiscountAmount: number
    uomId: string | null
  }>
  uomOptions: Array<{
    id: string
    name: string
    abbreviation: string
    conversionFactor: number
    isBaseUnit: boolean
    isBaseUom: boolean
    isDefaultSaleUom: boolean
    isDefaultPurchaseUom: boolean
  }>
  quantityOnHand: number
  quantityReserved: number
  baseQuantityOnHand: number
  baseQuantityReserved: number
  recoveryItemId: string | null
  stockSource: 'normal' | 'recovery'
}

/**
 * Draft line item state.
 */
type LineItemDraft = {
  id: string
  optionId: string
  uomId: string
  quantity: string
}

/**
 * Props for the record transaction form.
 */
type Props = {
  products: EmployeeProductOption[]
  currency: string
  action?: RecordTransactionAction
  branchId?: string
  redirectPath?: string
  submitLabel?: string
  pendingMessage?: string
}

type PreviewPricing = {
  lineTotal: number
  maxDiscountAmount: number
}

type LineDraftSummary = {
  row: LineItemDraft
  product: EmployeeProductOption | null
  selectedUom: EmployeeProductOption['uomOptions'][number] | null
  baseUom: EmployeeProductOption['uomOptions'][number] | null
  quantity: number
  baseQuantity: number | null
  pricing: PreviewPricing | null
  availableBaseQuantity: number
}

/**
 * Formats product prices for display only.
 */
function formatMoney(amount: number, currency: string) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)
}

/**
 * Applies the same preview rounding rules as the database pricing resolver.
 */
function roundPreviewPrice(value: number, rule: EmployeeProductOption['roundingRule']): number {
  if (rule === 'none') return Number(value.toFixed(2))
  if (rule === 'up_5') return Math.ceil(value / 5) * 5
  if (rule === 'down_5') return Math.floor(value / 5) * 5
  if (rule === 'nearest_10') return Math.round(value / 10) * 10
  return Math.round(value / 5) * 5
}

/**
 * Resolves display-only pricing and max discount from owner-approved options.
 */
function resolvePreviewPricing(product: EmployeeProductOption, baseQuantity: number, selectedUomId: string | null): PreviewPricing | null {
  if (!Number.isFinite(baseQuantity) || baseQuantity <= 0) {
    return null
  }

  const matchingUomOptions = product.pricingOptions.filter((option) => option.uomId === selectedUomId)

  if (product.pricingMethod === 'fixed_price' && matchingUomOptions.length === 0) {
    return {
      lineTotal: Number((product.sellingPrice * baseQuantity).toFixed(2)),
      maxDiscountAmount: 0,
    }
  }

  const sourceOptions = matchingUomOptions.length > 0 ? matchingUomOptions : product.pricingOptions.filter((option) => option.uomId === null)
  const sortedOptions = [...sourceOptions]
    .filter((option) => option.baseQuantity > 0 && option.price >= 0)
    .sort((first, second) => first.baseQuantity - second.baseQuantity)

  if (sortedOptions.length === 0) {
    return {
      lineTotal: Number((product.sellingPrice * baseQuantity).toFixed(2)),
      maxDiscountAmount: 0,
    }
  }

  if (product.pricingMethod === 'manual_quantity') {
    const exactOption = sortedOptions.find((option) => option.baseQuantity === baseQuantity)
    return exactOption
      ? {
          lineTotal: Number(exactOption.price.toFixed(2)),
          maxDiscountAmount: Number(exactOption.maxDiscountAmount.toFixed(2)),
        }
      : null
  }

  const exactOption = sortedOptions.find((option) => option.baseQuantity === baseQuantity)

  if (exactOption) {
    return {
      lineTotal: Number(exactOption.price.toFixed(2)),
      maxDiscountAmount: Number(exactOption.maxDiscountAmount.toFixed(2)),
    }
  }

  const basisOption = [...sortedOptions].reverse().find((option) => option.baseQuantity < baseQuantity) ?? sortedOptions[0]
  const quantityMultiplier = baseQuantity / basisOption.baseQuantity

  return {
    lineTotal: roundPreviewPrice(baseQuantity * (basisOption.price / basisOption.baseQuantity), product.roundingRule),
    maxDiscountAmount: Number((basisOption.maxDiscountAmount * quantityMultiplier).toFixed(2)),
  }
}

/**
 * Explains how a product will be priced in employee-friendly language.
 */
function getPricingHint(product: EmployeeProductOption): string {
  if (product.stockSource === 'recovery') {
    return 'Owner-approved damaged stock. This uses the recovery selling price and does not allow discounts'
  }

  if (product.pricingMethod === 'manual_quantity') {
    return 'Manual approved prices only'
  }

  if (product.pricingMethod === 'assisted_pack') {
    return 'System-assisted pack pricing'
  }

  return 'Fixed price'
}

/**
 * Returns a concise pricing label for dropdowns and badges.
 */
function getPricingLabel(product: EmployeeProductOption): string {
  if (product.stockSource === 'recovery') {
    return 'Damaged recovery stock'
  }

  if (product.pricingMethod === 'manual_quantity') {
    return 'Manual prices'
  }

  if (product.pricingMethod === 'assisted_pack') {
    return 'Pack pricing'
  }

  return 'Fixed price'
}

/**
 * Explains the rounding rule applied to system-assisted pack pricing.
 */
function getRoundingLabel(rule: EmployeeProductOption['roundingRule']): string {
  if (rule === 'none') return 'no rounding'
  if (rule === 'up_5') return 'round up to 5'
  if (rule === 'down_5') return 'round down to 5'
  if (rule === 'nearest_10') return 'nearest 10'
  return 'nearest 5'
}

/**
 * Finds the default sale unit for an employee product.
 */
function getDefaultSaleUOM(product: EmployeeProductOption | null): EmployeeProductOption['uomOptions'][number] | null {
  if (!product) {
    return null
  }

  return product.uomOptions.find((uom) => uom.isDefaultSaleUom) ??
    product.uomOptions.find((uom) => uom.isBaseUom || uom.isBaseUnit || uom.conversionFactor === 1) ??
    product.uomOptions[0] ??
    null
}

/**
 * Finds the base unit for an employee product.
 */
function getBaseUOM(product: EmployeeProductOption | null): EmployeeProductOption['uomOptions'][number] | null {
  if (!product) {
    return null
  }

  return product.uomOptions.find((uom) => uom.isBaseUom || uom.isBaseUnit || uom.conversionFactor === 1) ?? product.uomOptions[0] ?? null
}

/**
 * Converts a selected UOM quantity to the base quantity used by inventory.
 */
function getBaseQuantity(quantity: number, selectedUom: EmployeeProductOption['uomOptions'][number] | null): number | null {
  if (!selectedUom || !Number.isFinite(quantity) || quantity <= 0) {
    return null
  }

  return Number((quantity * selectedUom.conversionFactor).toFixed(4))
}

/**
 * Formats available stock using the selected sale UOM, plus exact base units.
 */
function formatAvailableQuantity(
  baseQuantity: number,
  selectedUom: EmployeeProductOption['uomOptions'][number] | null,
  baseUom: EmployeeProductOption['uomOptions'][number] | null
) {
  const safeBaseQuantity = Math.max(baseQuantity, 0)
  const formattedBaseQuantity = safeBaseQuantity.toLocaleString(undefined, { maximumFractionDigits: 4 })

  if (!selectedUom || !baseUom || selectedUom.conversionFactor <= 1) {
    return `${formattedBaseQuantity} ${baseUom?.name ?? selectedUom?.name ?? 'units'}`
  }

  const selectedQuantity = Math.floor(safeBaseQuantity / selectedUom.conversionFactor)
  const remainingBaseQuantity = Math.round((safeBaseQuantity - selectedQuantity * selectedUom.conversionFactor) * 10000) / 10000
  const formattedSelectedQuantity = selectedQuantity.toLocaleString(undefined, { maximumFractionDigits: 4 })
  const formattedRemainingBaseQuantity = remainingBaseQuantity.toLocaleString(undefined, { maximumFractionDigits: 4 })
  const remainderText = remainingBaseQuantity > 0 ? ` and ${formattedRemainingBaseQuantity} ${baseUom.name}` : ''

  return `${formattedSelectedQuantity} ${selectedUom.name}${remainderText} (${formattedBaseQuantity} ${baseUom.name})`
}

/**
 * Labels dropdown products with remaining damaged quantity where it matters.
 */
function getProductOptionLabel(product: EmployeeProductOption): string {
  const baseUom = getBaseUOM(product)

  if (product.stockSource !== 'recovery') {
    return `${product.name} (${product.sku}) - ${getPricingLabel(product)}`
  }

  return `${product.name} (${product.sku}) - ${formatAvailableQuantity(
    product.baseQuantityOnHand - product.baseQuantityReserved,
    baseUom,
    baseUom
  )} available`
}

/**
 * Shared input styling for the transaction form.
 */
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

/**
 * RecordEmployeeTransactionForm renders the web POS transaction form.
 */
export default function RecordEmployeeTransactionForm({
  products,
  currency,
  action: recordTransactionAction = recordEmployeeTransaction,
  branchId,
  redirectPath = '/dashboard/employee/transactions',
  submitLabel = 'Record transaction',
  pendingMessage = 'Recording transaction...',
}: Props) {
  const router = useRouter()
  const previousPending = useRef(false)
  const [rows, setRows] = useState<LineItemDraft[]>([
    {
      id: 'row-1',
      optionId: products[0]?.optionId ?? '',
      uomId: getDefaultSaleUOM(products[0] ?? null)?.id ?? '',
      quantity: '1',
    },
  ])
  const [paymentMethod, setPaymentMethod] = useState<'mpesa_manual' | 'cash'>('mpesa_manual')
  const [discountAmount, setDiscountAmount] = useState('0')
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [mpesaRefCode, setMpesaRefCode] = useState('')
  const [cashDepositCode, setCashDepositCode] = useState('')
  const [state, action, isPending] = useActionState<EmployeeTransactionFormState, FormData>(recordTransactionAction, {
    success: false,
    error: null,
  })
  const { toast, toastState, dismiss } = useToast()
  const hasAdvancedPricing = products.some(
    (product) => product.pricingMethod !== 'fixed_price' || product.pricingOptions.length > 0,
  )
  const lineSummaries: LineDraftSummary[] = rows.map((row) => {
    const product = products.find((availableProduct) => availableProduct.optionId === row.optionId) ?? null
    const selectedUom = product?.uomOptions.find((uom) => uom.id === row.uomId) ?? getDefaultSaleUOM(product)
    const baseUom = getBaseUOM(product)
    const quantity = Number(row.quantity)
    const baseQuantity = getBaseQuantity(quantity, selectedUom)
    const pricing = product && baseQuantity ? resolvePreviewPricing(product, baseQuantity, selectedUom?.id ?? null) : null
    const availableBaseQuantity = product ? product.baseQuantityOnHand - product.baseQuantityReserved : 0

    return {
      row,
      product,
      selectedUom,
      baseUom,
      quantity,
      baseQuantity,
      pricing,
      availableBaseQuantity,
    }
  })
  const requestedBaseQuantityByOption = new Map<string, number>()

  lineSummaries.forEach((summary) => {
    if (!summary.product || !summary.baseQuantity) {
      return
    }

    requestedBaseQuantityByOption.set(
      summary.product.optionId,
      (requestedBaseQuantityByOption.get(summary.product.optionId) ?? 0) + summary.baseQuantity
    )
  })

  const invalidPriceSummary = lineSummaries.find((summary) => summary.product && summary.baseQuantity && !summary.pricing)
  const outOfStockSummary = lineSummaries.find((summary) => {
    if (!summary.product) {
      return false
    }

    return (requestedBaseQuantityByOption.get(summary.product.optionId) ?? 0) > summary.availableBaseQuantity
  })
  const subtotalPreview = lineSummaries.reduce((sum, summary) => sum + (summary.pricing?.lineTotal ?? 0), 0)
  const maxAllowedDiscount = lineSummaries.reduce((sum, summary) => sum + (summary.pricing?.maxDiscountAmount ?? 0), 0)
  const hasRecoveryLines = lineSummaries.some((summary) => summary.product?.stockSource === 'recovery')
  const discountValue = Number(discountAmount || 0)
  const discountInvalid = !Number.isFinite(discountValue) || discountValue < 0
  const discountTooHigh = Number.isFinite(discountValue) && discountValue > maxAllowedDiscount
  const safeDiscountValue = discountInvalid ? 0 : discountValue
  const totalPreview = Math.max(0, subtotalPreview - safeDiscountValue)
  const hasValidLine = lineSummaries.some((summary) => summary.product && summary.selectedUom && summary.quantity > 0)
  const canSubmit =
    !isPending &&
    products.length > 0 &&
    hasValidLine &&
    !invalidPriceSummary &&
    !outOfStockSummary &&
    !discountInvalid &&
    !discountTooHigh

  /**
   * Handles completed submissions and redirects back to transaction history.
   */
  useEffect(() => {
    let redirectTimer: ReturnType<typeof setTimeout> | null = null

    if (previousPending.current && !isPending) {
      if (state.success) {
        toast.success(state.message ?? 'Transaction recorded successfully')
        redirectTimer = setTimeout(() => {
          router.push(redirectPath)
          router.refresh()
        }, 0)
      } else if (state.error) {
        toast.error(state.error)
      }
    }

    previousPending.current = isPending
    return () => {
      if (redirectTimer) {
        clearTimeout(redirectTimer)
      }
    }
  }, [isPending, redirectPath, router, state.error, state.message, state.success, toast])

  /**
   * Updates one line item draft field.
   */
  const updateRow = (rowId: string, field: keyof Omit<LineItemDraft, 'id'>, value: string) => {
    setRows((currentRows) =>
      currentRows.map((row) => (row.id === rowId ? { ...row, [field]: value } : row))
    )
  }

  /**
   * Adds another product row.
   */
  const addRow = () => {
    setRows((currentRows) => [
      ...currentRows,
      {
        id: `row-${currentRows.length + 1}-${Date.now()}`,
        optionId: products[0]?.optionId ?? '',
        uomId: getDefaultSaleUOM(products[0] ?? null)?.id ?? '',
        quantity: '1',
      },
    ])
  }

  /**
   * Removes a product row while keeping at least one row visible.
   */
  const removeRow = (rowId: string) => {
    setRows((currentRows) => (currentRows.length > 1 ? currentRows.filter((row) => row.id !== rowId) : currentRows))
  }

  /**
   * Submits the transaction to the server action.
   */
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (invalidPriceSummary) {
      toast.error(`${invalidPriceSummary.product?.name ?? 'This product'} does not have an approved price for ${invalidPriceSummary.row.quantity} ${invalidPriceSummary.selectedUom?.name ?? 'units'}`)
      return
    }

    if (outOfStockSummary?.product) {
      const requestedBaseQuantity = requestedBaseQuantityByOption.get(outOfStockSummary.product.optionId) ?? 0
      const baseUom = outOfStockSummary.baseUom?.name ?? 'base units'
      toast.error(
        `${outOfStockSummary.product.name} is out of stock for this sale. Requested ${requestedBaseQuantity.toLocaleString(undefined, { maximumFractionDigits: 4 })} ${baseUom}, available ${Math.max(outOfStockSummary.availableBaseQuantity, 0).toLocaleString(undefined, { maximumFractionDigits: 4 })} ${baseUom}.`
      )
      return
    }

    if (discountInvalid) {
      toast.error('Enter a valid discount amount')
      return
    }

    if (discountTooHigh) {
      toast.error(`Discount cannot exceed ${formatMoney(maxAllowedDiscount, currency)} for the selected items`)
      return
    }

    const formData = new FormData()
    if (branchId) {
      formData.set('branchId', branchId)
    }
    formData.set(
      'itemsJson',
      JSON.stringify(
        rows
          .map((row) => ({
            row,
            product: products.find((product) => product.optionId === row.optionId) ?? null,
          }))
          .filter(({ row, product }) => product && row.uomId && Number(row.quantity) > 0)
          .map(({ row, product }) => ({
            productId: product?.productId,
            uomId: row.uomId,
            quantity: Number(row.quantity),
            recoveryItemId: product?.recoveryItemId ?? null,
          }))
      )
    )
    formData.set('paymentMethod', paymentMethod)
    formData.set('discountAmount', discountAmount)
    formData.set('customerName', customerName)
    formData.set('customerPhone', customerPhone)
    formData.set('mpesaRefCode', mpesaRefCode)
    formData.set('cashDepositCode', cashDepositCode)

    startTransition(() => {
      action(formData)
    })
  }

  return (
    <>
      {isPending && <LoadingOverlay message={pendingMessage} />}
      {toastState && (
        <Toast
          message={toastState.message}
          type={toastState.type}
          duration={toastState.duration}
          onDismiss={dismiss}
        />
      )}

      <form onSubmit={onSubmit} className="flex w-full flex-col gap-5">
        {!hasAdvancedPricing && products.length > 0 && (
          <div
            className="rounded-xl border"
            style={{
              borderColor: 'var(--color-border)',
              backgroundColor: 'var(--color-surface)',
              padding: 14,
              color: 'var(--color-text-primary)',
            }}
          >
            <p style={{ margin: 0, fontSize: 13, fontWeight: 800 }}>Fixed prices are currently loaded</p>
            <p style={{ margin: '5px 0 0', fontSize: 12, color: 'var(--color-text-muted)' }}>
              If you expected pack or manual quantity prices, run the UOM-aware stock and sales SQL migration and refresh this page.
            </p>
          </div>
        )}

        {/* Product line items */}
        <div className="flex flex-col gap-3">
          {rows.map((row, index) => {
            const selectedProduct = products.find((product) => product.optionId === row.optionId) ?? null
            const quantity = Number(row.quantity)
            const selectedUom = selectedProduct?.uomOptions.find((uom) => uom.id === row.uomId) ?? getDefaultSaleUOM(selectedProduct)
            const baseUom = getBaseUOM(selectedProduct)
            const baseQuantity = getBaseQuantity(quantity, selectedUom)
            const previewPricing = selectedProduct && baseQuantity ? resolvePreviewPricing(selectedProduct, baseQuantity, selectedUom?.id ?? null) : null
            const availableBaseQuantity = selectedProduct
              ? selectedProduct.baseQuantityOnHand - selectedProduct.baseQuantityReserved
              : 0
            const requestedBaseQuantity = selectedProduct
              ? requestedBaseQuantityByOption.get(selectedProduct.optionId) ?? 0
              : 0
            const isOverStock = selectedProduct ? requestedBaseQuantity > availableBaseQuantity : false
            const availableDisplay = formatAvailableQuantity(availableBaseQuantity, selectedUom, baseUom)
            const requestedDisplay = formatAvailableQuantity(requestedBaseQuantity, selectedUom, baseUom)

            return (
              <div
                key={row.id}
                className="rounded-xl border"
                style={{ borderColor: 'var(--color-border)', padding: 14, backgroundColor: 'var(--color-background)' }}
              >
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_150px_120px_auto] sm:items-end">
                  <label className="flex flex-col gap-2 text-left" style={{ fontSize: 13, color: 'var(--color-text-primary)' }}>
                    Product {index + 1}
                    <select
                      value={row.optionId}
                      onChange={(event) => {
                        const nextProduct = products.find((product) => product.optionId === event.target.value) ?? null
                        setRows((currentRows) =>
                          currentRows.map((currentRow) =>
                            currentRow.id === row.id
                              ? {
                                  ...currentRow,
                                  optionId: event.target.value,
                                  uomId: getDefaultSaleUOM(nextProduct)?.id ?? '',
                                }
                              : currentRow
                          )
                        )
                      }}
                      required
                      style={inputStyle}
                    >
                      {products.map((product) => (
                        <option key={product.optionId} value={product.optionId}>
                          {getProductOptionLabel(product)}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="flex flex-col gap-2 text-left" style={{ fontSize: 13, color: 'var(--color-text-primary)' }}>
                    Sell as
                    <select
                      value={row.uomId}
                      onChange={(event) => updateRow(row.id, 'uomId', event.target.value)}
                      required
                      style={inputStyle}
                    >
                      <option value="">Select unit</option>
                      {(selectedProduct?.uomOptions ?? []).map((uom) => (
                        <option key={uom.id} value={uom.id}>
                          {uom.name} x {uom.conversionFactor}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="flex flex-col gap-2 text-left" style={{ fontSize: 13, color: 'var(--color-text-primary)' }}>
                    Quantity
                    <input
                      type="number"
                      min="0.0001"
                      step="0.0001"
                      value={row.quantity}
                      onChange={(event) => updateRow(row.id, 'quantity', event.target.value)}
                      required
                      style={inputStyle}
                    />
                  </label>

                  <button
                    type="button"
                    className="btn-outline"
                    style={{ padding: '8px 16px', borderRadius: 8 }}
                    onClick={() => removeRow(row.id)}
                  >
                    Remove
                  </button>
                </div>

                {selectedProduct && (
                  <div
                    className="rounded-lg border"
                    style={{
                      margin: '12px 0 0',
                      padding: 12,
                      borderColor: 'var(--color-border)',
                      backgroundColor: 'var(--color-surface)',
                      fontSize: 12,
                      color: 'var(--color-text-muted)',
                    }}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        style={{
                          border: '1px solid var(--color-border)',
                          borderRadius: 999,
                          padding: '4px 10px',
                          backgroundColor: 'var(--color-background)',
                          color: 'var(--color-text-primary)',
                          fontWeight: 800,
                        }}
                      >
                        {getPricingLabel(selectedProduct)}
                      </span>
                      <span>
                        Available: {availableDisplay}
                      </span>
                      {baseQuantity && baseUom && (
                        <span>
                          This sale uses {baseQuantity.toLocaleString(undefined, { maximumFractionDigits: 4 })} {baseUom.name}
                        </span>
                      )}
                      {selectedProduct.pricingMethod === 'assisted_pack' && (
                        <span>Rounding: {getRoundingLabel(selectedProduct.roundingRule)}</span>
                      )}
                      {selectedProduct.stockSource === 'recovery' && (
                        <span
                          style={{
                            border: '1px solid rgba(217, 119, 6, 0.35)',
                            borderRadius: 999,
                            padding: '4px 10px',
                            backgroundColor: 'rgba(217, 119, 6, 0.1)',
                            color: '#92400e',
                            fontWeight: 800,
                          }}
                        >
                          Damaged stock
                        </span>
                      )}
                    </div>

                    <p style={{ margin: '8px 0 0' }}>{getPricingHint(selectedProduct)}.</p>

                    <p style={{ margin: '6px 0 0', fontWeight: 800, color: previewPricing === null ? 'var(--color-danger)' : 'var(--color-text-primary)' }}>
                      {previewPricing === null
                        ? 'This quantity does not have an approved manual price.'
                        : `Estimated line total: ${formatMoney(previewPricing.lineTotal, currency)}`}
                    </p>

                    {previewPricing && (
                      <p style={{ margin: '6px 0 0', color: 'var(--color-text-muted)' }}>
                        {selectedProduct.stockSource === 'recovery'
                          ? 'Discounts do not apply to recovery stock.'
                          : `Max discount for this line: ${formatMoney(previewPricing.maxDiscountAmount, currency)}`}
                      </p>
                    )}

                    {isOverStock && baseUom && (
                      <p style={{ margin: '6px 0 0', color: 'var(--color-danger)', fontWeight: 800 }}>
                        Not enough stock. Requested {requestedDisplay}, available {availableDisplay}.
                      </p>
                    )}

                    {selectedProduct.pricingOptions.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {selectedProduct.pricingOptions.map((option) => {
                          const optionUom = selectedProduct.uomOptions.find((uom) => uom.id === option.uomId) ?? baseUom
                          const optionQuantity = optionUom ? option.baseQuantity / optionUom.conversionFactor : option.baseQuantity

                          return (
                          <button
                            key={`${selectedProduct.productId}-${option.uomId ?? 'base'}-${option.baseQuantity}-${option.price}`}
                            type="button"
                            onClick={() => {
                              setRows((currentRows) =>
                                currentRows.map((currentRow) =>
                                  currentRow.id === row.id
                                    ? {
                                        ...currentRow,
                                        uomId: optionUom?.id ?? currentRow.uomId,
                                        quantity: String(optionQuantity),
                                      }
                                    : currentRow
                                )
                              )
                            }}
                            style={{
                              border: '1px solid var(--color-border)',
                              borderRadius: 999,
                              padding: '4px 10px',
                              backgroundColor: 'var(--color-background)',
                              color: 'var(--color-text-primary)',
                              fontWeight: 700,
                              cursor: 'pointer',
                            }}
                          >
                            {optionQuantity.toLocaleString(undefined, { maximumFractionDigits: 4 })} {optionUom?.name ?? selectedProduct.unit} = {formatMoney(option.price, currency)}
                            {option.maxDiscountAmount > 0 ? ` (discount up to ${formatMoney(option.maxDiscountAmount, currency)})` : ''}
                          </button>
                          )
                        })}
                      </div>
                    ) : (
                      <p style={{ margin: '6px 0 0' }}>
                        Base price: {formatMoney(selectedProduct.sellingPrice, currency)} per {selectedProduct.unit}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )
          })}

          <button type="button" className="btn-outline" style={{ padding: '8px 16px', borderRadius: 8 }} onClick={addRow}>
            Add product
          </button>
        </div>

        {/* Customer and discount fields */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-2 text-left" style={{ fontSize: 13, color: 'var(--color-text-primary)' }}>
            Customer name optional
            <input value={customerName} onChange={(event) => setCustomerName(event.target.value)} style={inputStyle} />
          </label>
          <label className="flex flex-col gap-2 text-left" style={{ fontSize: 13, color: 'var(--color-text-primary)' }}>
            Customer phone optional
            <input value={customerPhone} onChange={(event) => setCustomerPhone(event.target.value)} style={inputStyle} />
          </label>
          <label className="flex flex-col gap-2 text-left" style={{ fontSize: 13, color: 'var(--color-text-primary)' }}>
            Discount amount
            <input
              type="number"
              min="0"
              max={maxAllowedDiscount}
              step="0.01"
              value={discountAmount}
              onChange={(event) => setDiscountAmount(event.target.value)}
              style={inputStyle}
            />
            <span style={{ fontSize: 12, color: discountTooHigh ? 'var(--color-danger)' : 'var(--color-text-muted)' }}>
              Max allowed discount: {formatMoney(maxAllowedDiscount, currency)}
            </span>
          </label>
          <label className="flex flex-col gap-2 text-left" style={{ fontSize: 13, color: 'var(--color-text-primary)' }}>
            Payment method
            <select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as 'mpesa_manual' | 'cash')} style={inputStyle}>
              <option value="mpesa_manual">M-Pesa manual</option>
              <option value="cash">Cash</option>
            </select>
          </label>
        </div>

        {/* Payment reference fields */}
        {paymentMethod === 'mpesa_manual' ? (
          <label className="flex flex-col gap-2 text-left" style={{ fontSize: 13, color: 'var(--color-text-primary)' }}>
            M-Pesa reference code
            <input value={mpesaRefCode} onChange={(event) => setMpesaRefCode(event.target.value)} required style={inputStyle} />
          </label>
        ) : (
          <label className="flex flex-col gap-2 text-left" style={{ fontSize: 13, color: 'var(--color-text-primary)' }}>
            Cash deposit/reference code
            <input value={cashDepositCode} onChange={(event) => setCashDepositCode(event.target.value)} required style={inputStyle} />
          </label>
        )}

        {state.error && (
          <div
            style={{
              backgroundColor: 'var(--color-danger-light)',
              border: '1px solid var(--color-danger)',
              color: 'var(--color-danger)',
              borderRadius: 8,
              padding: '12px 14px',
              fontSize: 13,
            }}
          >
            {state.error}
          </div>
        )}

        <div
          className="rounded-xl border"
          style={{
            borderColor: discountTooHigh || invalidPriceSummary || outOfStockSummary ? 'var(--color-danger)' : 'var(--color-border)',
            backgroundColor: 'var(--color-surface)',
            padding: 14,
            textAlign: 'left',
            fontSize: 13,
            color: 'var(--color-text-primary)',
          }}
        >
          <p style={{ margin: 0, fontWeight: 800 }}>Sale summary</p>
          <p style={{ margin: '6px 0 0', color: 'var(--color-text-muted)' }}>
            Subtotal: {formatMoney(subtotalPreview, currency)} · Discount limit: {formatMoney(maxAllowedDiscount, currency)}
          </p>
          <p style={{ margin: '6px 0 0', color: 'var(--color-text-primary)', fontWeight: 800 }}>
            Customer pays: {formatMoney(totalPreview, currency)}
          </p>
          {discountTooHigh && (
            <p style={{ margin: '6px 0 0', color: 'var(--color-danger)', fontWeight: 800 }}>
              The entered discount is above the owner-approved maximum for these items.
            </p>
          )}
          {hasRecoveryLines && (
            <p style={{ margin: '6px 0 0', color: 'var(--color-text-muted)' }}>
              Damaged recovery stock is sold at its owner-approved recovery price and is excluded from discounts.
            </p>
          )}
          {invalidPriceSummary && (
            <p style={{ margin: '6px 0 0', color: 'var(--color-danger)', fontWeight: 800 }}>
              One selected quantity does not have an approved price.
            </p>
          )}
          {outOfStockSummary && (
            <p style={{ margin: '6px 0 0', color: 'var(--color-danger)', fontWeight: 800 }}>
              One selected product exceeds available stock.
            </p>
          )}
        </div>

        <button
          type="submit"
          className="btn-primary"
          disabled={!canSubmit}
          style={{ padding: '10px 20px', borderRadius: 8, opacity: !canSubmit ? 0.75 : 1 }}
        >
          {isPending ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="h-4 w-4 animate-spin text-white" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
              </svg>
              {pendingMessage}
            </span>
          ) : (
            submitLabel
          )}
        </button>
      </form>
    </>
  )
}
