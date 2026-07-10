'use client'
/**
 * Owner finance input controls for expenses and inventory losses.
 */

import { startTransition, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useActionState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardHeader } from '../../../../components/ui/Card'
import LoadingOverlay from '../../../../components/ui/LoadingOverlay'
import Toast from '../../../../components/ui/Toast'
import { useToast } from '../../../../lib/hooks/useToast'
import { recordFinanceExpense, recordInventoryLoss, type FinanceFormState } from './actions'

type BranchOption = {
  id: string
  name: string
}

type UomOption = {
  id: string
  name: string
  conversion_factor: number
  is_base_uom: boolean
  is_base_unit: boolean
}

export type LossProductOption = {
  branch_id: string
  branch_name: string
  product_id: string
  product_name: string
  sku?: string | null
  available_base_quantity: number
  average_base_unit_cost: number
  cost_source_label: string
  cost_source_total: number
  cost_source_base_quantity: number
  uom_options: UomOption[]
}

type Props = {
  branches: BranchOption[]
  lossProducts: LossProductOption[]
}

const inputStyle = {
  width: '100%',
  height: 44,
  border: '1px solid var(--color-border)',
  borderRadius: 8,
  padding: '0 12px',
  boxSizing: 'border-box' as const,
  fontSize: 13,
  color: 'var(--color-text-primary)',
  backgroundColor: 'var(--color-background)',
}

/**
 * FinanceControls renders owner-only forms for expenses and inventory losses.
 */
export default function FinanceControls({ branches, lossProducts }: Props) {
  const router = useRouter()
  const { toast, toastState, dismiss } = useToast()
  const [expenseState, expenseAction, expensePending] = useActionState<FinanceFormState, FormData>(recordFinanceExpense, {
    success: false,
    error: null,
  })
  const [lossState, lossAction, lossPending] = useActionState<FinanceFormState, FormData>(recordInventoryLoss, {
    success: false,
    error: null,
  })
  const previousExpensePending = useRef(expensePending)
  const previousLossPending = useRef(lossPending)
  const [expenseBranchId, setExpenseBranchId] = useState('')
  const [expenseCategory, setExpenseCategory] = useState('Rent')
  const [expenseDescription, setExpenseDescription] = useState('')
  const [expenseAmount, setExpenseAmount] = useState('')
  const [expenseDate, setExpenseDate] = useState(new Date().toISOString().slice(0, 10))
  const [lossBranchId, setLossBranchId] = useState(lossProducts[0]?.branch_id ?? '')
  const [lossProductId, setLossProductId] = useState(lossProducts[0]?.product_id ?? '')
  const [lossUomId, setLossUomId] = useState(lossProducts[0]?.uom_options[0]?.id ?? '')
  const [lossQuantity, setLossQuantity] = useState('')
  const [lossType, setLossType] = useState('breakage')
  const [lossReason, setLossReason] = useState('')
  const [recoverySalePrice, setRecoverySalePrice] = useState('')

  useEffect(() => {
    if (previousExpensePending.current && !expensePending) {
      if (expenseState.success) {
        toast.success('Expense recorded')
        setExpenseDescription('')
        setExpenseAmount('')
        router.refresh()
      } else if (expenseState.error) {
        toast.error(expenseState.error)
      }
    }

    previousExpensePending.current = expensePending
  }, [expensePending, expenseState.error, expenseState.success, router, toast])

  useEffect(() => {
    if (previousLossPending.current && !lossPending) {
      if (lossState.success) {
        toast.success('Inventory loss recorded')
        setLossQuantity('')
        setLossReason('')
        setRecoverySalePrice('')
        router.refresh()
      } else if (lossState.error) {
        toast.error(lossState.error)
      }
    }

    previousLossPending.current = lossPending
  }, [lossPending, lossState.error, lossState.success, router, toast])

  const branchProducts = useMemo(
    () => lossProducts.filter((product) => product.branch_id === lossBranchId),
    [lossBranchId, lossProducts]
  )
  const selectedLossProduct = branchProducts.find((product) => product.product_id === lossProductId) ?? branchProducts[0] ?? null
  const selectedLossUom = selectedLossProduct?.uom_options.find((uom) => uom.id === lossUomId) ?? selectedLossProduct?.uom_options[0] ?? null
  const lossQuantityValue = Number(lossQuantity || 0)
  const lossBaseQuantity = selectedLossUom && lossQuantityValue > 0 ? lossQuantityValue * selectedLossUom.conversion_factor : 0
  const estimatedGrossLoss = selectedLossProduct ? lossBaseQuantity * selectedLossProduct.average_base_unit_cost : 0
  const recoverySalePriceValue = Number(recoverySalePrice || 0)
  const expectedRecoveryRevenue = recoverySalePriceValue > 0 && lossBaseQuantity > 0
    ? recoverySalePriceValue * lossBaseQuantity
    : 0
  const estimatedNetLoss = Math.max(estimatedGrossLoss - expectedRecoveryRevenue, 0)
  const costSourceText = selectedLossProduct?.cost_source_total && selectedLossProduct.cost_source_base_quantity
    ? `${selectedLossProduct.cost_source_label}: ${selectedLossProduct.cost_source_total.toLocaleString(undefined, { maximumFractionDigits: 2 })} / ${selectedLossProduct.cost_source_base_quantity.toLocaleString(undefined, { maximumFractionDigits: 4 })} individual units`
    : selectedLossProduct?.cost_source_label ?? 'Stock cost'

  useEffect(() => {
    if (!selectedLossProduct) {
      return
    }

    if (lossProductId !== selectedLossProduct.product_id) {
      setLossProductId(selectedLossProduct.product_id)
    }

    const nextUom = selectedLossProduct.uom_options.find((uom) => uom.id === lossUomId) ?? selectedLossProduct.uom_options[0]
    if (nextUom && lossUomId !== nextUom.id) {
      setLossUomId(nextUom.id)
    }
  }, [lossProductId, lossUomId, selectedLossProduct])

  const onExpenseSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const formData = new FormData()
    formData.set('branchId', expenseBranchId)
    formData.set('category', expenseCategory)
    formData.set('description', expenseDescription)
    formData.set('amount', expenseAmount)
    formData.set('incurredOn', expenseDate)

    startTransition(() => {
      expenseAction(formData)
    })
  }

  const onLossSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const formData = new FormData()
    formData.set('branchId', lossBranchId)
    formData.set('productId', lossProductId)
    formData.set('uomId', lossUomId)
    formData.set('quantity', lossQuantity)
    formData.set('lossType', lossType)
    formData.set('reason', lossReason)
    formData.set('recoverableAmount', String(expectedRecoveryRevenue))
    formData.set('recoverySalePrice', recoverySalePrice)

    startTransition(() => {
      lossAction(formData)
    })
  }

  return (
    <>
      {(expensePending || lossPending) && (
        <LoadingOverlay message={expensePending ? 'Recording expense...' : 'Recording inventory loss...'} />
      )}
      {toastState && <Toast message={toastState.message} type={toastState.type} duration={toastState.duration} onDismiss={dismiss} />}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <Card padding="md">
          <CardHeader title="One-off expense" />
          <details>
            <summary style={{ cursor: 'pointer', color: 'var(--color-text-primary)', fontSize: 14, fontWeight: 800 }}>
              Add a once-off expense
            </summary>
          <form onSubmit={onExpenseSubmit} className="mt-3 flex flex-col gap-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label style={{ fontSize: 13 }}>
                <span style={{ display: 'block', marginBottom: 6, fontWeight: 500 }}>Branch</span>
                <select value={expenseBranchId} onChange={(event) => setExpenseBranchId(event.target.value)} style={inputStyle}>
                  <option value="">Entire business</option>
                  {branches.map((branch) => (
                    <option key={branch.id} value={branch.id}>{branch.name}</option>
                  ))}
                </select>
              </label>
              <label style={{ fontSize: 13 }}>
                <span style={{ display: 'block', marginBottom: 6, fontWeight: 500 }}>Category</span>
                <input value={expenseCategory} onChange={(event) => setExpenseCategory(event.target.value)} required style={inputStyle} />
              </label>
            </div>

            <label style={{ fontSize: 13 }}>
              <span style={{ display: 'block', marginBottom: 6, fontWeight: 500 }}>Description</span>
              <input value={expenseDescription} onChange={(event) => setExpenseDescription(event.target.value)} required placeholder="e.g. July rent, staff wages, electricity" style={inputStyle} />
            </label>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label style={{ fontSize: 13 }}>
                <span style={{ display: 'block', marginBottom: 6, fontWeight: 500 }}>Amount</span>
                <input type="number" min={0.01} step="0.01" value={expenseAmount} onChange={(event) => setExpenseAmount(event.target.value)} required style={inputStyle} />
              </label>
              <label style={{ fontSize: 13 }}>
                <span style={{ display: 'block', marginBottom: 6, fontWeight: 500 }}>Date</span>
                <input type="date" value={expenseDate} onChange={(event) => setExpenseDate(event.target.value)} style={inputStyle} />
              </label>
            </div>

            {expenseState.error && <p style={{ margin: 0, color: 'var(--color-danger)', fontSize: 13 }}>{expenseState.error}</p>}
            <button type="submit" className="btn-primary" disabled={expensePending} style={{ padding: '10px 16px', borderRadius: 8 }}>
              Record expense
            </button>
          </form>
          </details>
        </Card>

        <Card padding="md">
          <CardHeader title="Breakage / stock loss" />
          <details>
            <summary style={{ cursor: 'pointer', color: 'var(--color-text-primary)', fontSize: 14, fontWeight: 800 }}>
              Record damaged, spoiled, or lost stock
            </summary>
          <form onSubmit={onLossSubmit} className="mt-3 flex flex-col gap-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label style={{ fontSize: 13 }}>
                <span style={{ display: 'block', marginBottom: 6, fontWeight: 500 }}>Branch</span>
                <select value={lossBranchId} onChange={(event) => setLossBranchId(event.target.value)} required style={inputStyle}>
                  <option value="">Select branch</option>
                  {branches.map((branch) => (
                    <option key={branch.id} value={branch.id}>{branch.name}</option>
                  ))}
                </select>
              </label>
              <label style={{ fontSize: 13 }}>
                <span style={{ display: 'block', marginBottom: 6, fontWeight: 500 }}>Product</span>
                <select value={lossProductId} onChange={(event) => setLossProductId(event.target.value)} required style={inputStyle}>
                  <option value="">Select product</option>
                  {branchProducts.map((product) => (
                    <option key={`${product.branch_id}-${product.product_id}`} value={product.product_id}>
                      {product.product_name}{product.sku ? ` - ${product.sku}` : ''}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label style={{ fontSize: 13 }}>
                <span style={{ display: 'block', marginBottom: 6, fontWeight: 500 }}>Individual unit from product setup</span>
                <select value={lossUomId} onChange={(event) => setLossUomId(event.target.value)} required disabled style={{ ...inputStyle, opacity: 0.8 }}>
                  <option value="">Select unit</option>
                  {(selectedLossProduct?.uom_options ?? []).map((uom) => (
                    <option key={uom.id} value={uom.id}>{uom.name}</option>
                  ))}
                </select>
              </label>
              <label style={{ fontSize: 13 }}>
                <span style={{ display: 'block', marginBottom: 6, fontWeight: 500 }}>Quantity affected</span>
                <input type="number" min={0.0001} step="0.0001" value={lossQuantity} onChange={(event) => setLossQuantity(event.target.value)} required style={inputStyle} />
              </label>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label style={{ fontSize: 13 }}>
                <span style={{ display: 'block', marginBottom: 6, fontWeight: 500 }}>Loss type</span>
                <select value={lossType} onChange={(event) => setLossType(event.target.value)} style={inputStyle}>
                  <option value="breakage">Breakage</option>
                  <option value="spoilage">Spoilage</option>
                  <option value="theft">Theft</option>
                  <option value="markdown_damage">Damaged markdown</option>
                  <option value="other">Other</option>
                </select>
              </label>
            </div>

            <label style={{ fontSize: 13 }}>
              <span style={{ display: 'block', marginBottom: 6, fontWeight: 500 }}>Recovery selling price per individual unit</span>
              <input
                type="number"
                min={0}
                step="0.01"
                value={recoverySalePrice}
                onChange={(event) => setRecoverySalePrice(event.target.value)}
                placeholder="e.g. sell each cracked egg at 10"
                style={inputStyle}
              />
              <span style={{ display: 'block', marginTop: 6, color: 'var(--color-text-muted)', fontSize: 12 }}>
                Recoverable value is calculated as damaged individual units x this price. The damaged stock then appears in the employee sale form.
              </span>
            </label>

            <label style={{ fontSize: 13 }}>
              <span style={{ display: 'block', marginBottom: 6, fontWeight: 500 }}>Reason</span>
              <input value={lossReason} onChange={(event) => setLossReason(event.target.value)} required placeholder="e.g. 12 eggs cracked during unloading" style={inputStyle} />
            </label>

            <p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: 12, lineHeight: 1.5 }}>
              Estimated stock loss: {estimatedNetLoss.toLocaleString(undefined, { maximumFractionDigits: 2 })}.
              {selectedLossUom && selectedLossProduct
                ? ` ${lossQuantityValue.toLocaleString(undefined, { maximumFractionDigits: 4 })} ${selectedLossUom.name} equals ${lossBaseQuantity.toLocaleString(undefined, { maximumFractionDigits: 4 })} individual units.`
                : ''}
              {selectedLossProduct
                ? ` Cost per individual unit: ${selectedLossProduct.average_base_unit_cost.toLocaleString(undefined, { maximumFractionDigits: 4 })} (${costSourceText}). Cost value: ${lossBaseQuantity.toLocaleString(undefined, { maximumFractionDigits: 4 })} x ${selectedLossProduct.average_base_unit_cost.toLocaleString(undefined, { maximumFractionDigits: 4 })} = ${estimatedGrossLoss.toLocaleString(undefined, { maximumFractionDigits: 2 })}.`
                : ''}
              {expectedRecoveryRevenue > 0
                ? ` Recoverable sale value: ${lossBaseQuantity.toLocaleString(undefined, { maximumFractionDigits: 4 })} x ${recoverySalePriceValue.toLocaleString(undefined, { maximumFractionDigits: 2 })} = ${expectedRecoveryRevenue.toLocaleString(undefined, { maximumFractionDigits: 2 })}.`
                : ''}
            </p>

            {lossState.error && <p style={{ margin: 0, color: 'var(--color-danger)', fontSize: 13 }}>{lossState.error}</p>}
            <button type="submit" className="btn-primary" disabled={lossPending || lossProducts.length === 0} style={{ padding: '10px 16px', borderRadius: 8 }}>
              Record loss
            </button>
          </form>
          </details>
        </Card>
      </div>
    </>
  )
}
