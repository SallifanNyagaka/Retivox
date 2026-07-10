/**
 * Client-side modal form for initiating a stock transfer.
 *
 * The form lets the owner choose source and destination branches,
 * add multiple product rows, and submit the transfer through a server action.
 */

'use client'

import { startTransition, useEffect, useRef, useState, type FormEvent } from 'react'
import { useActionState } from 'react'
import { useRouter } from 'next/navigation'
import Modal from '../../../../components/ui/Modal'
import Toast from '../../../../components/ui/Toast'
import LoadingOverlay from '../../../../components/ui/LoadingOverlay'
import { useToast } from '../../../../lib/hooks/useToast'
import { fromBaseUnits } from '../../../../lib/uom/utils'
import { initiateTransfer, type FormState } from './actions'
import type { BranchOption, StockProduct, TransferDraftItem, TransferStockRow, TransferUOMOption } from './types'

/**
 * Props for the initiate transfer modal.
 */
type Props = {
  branches: BranchOption[]
  stockRows: TransferStockRow[]
  products: StockProduct[]
  managedBranchIds: string[]
}

/**
 * Returns an empty draft row for the product list.
 */
function createEmptyItem(): TransferDraftItem {
  return { productId: '', uomId: '', quantity: '1' }
}

/**
 * Finds the base UOM for a stock row.
 */
function getBaseUOM(row: TransferStockRow | null): TransferUOMOption | null {
  if (!row) {
    return null
  }

  return row.uom_options.find((uom) => uom.is_base_uom || uom.is_base_unit || uom.conversion_factor === 1) ?? row.uom_options[0] ?? null
}

/**
 * Finds the receiving UOM that should be used by default for transfers.
 */
function getDefaultReceivingUOM(row: TransferStockRow | null): TransferUOMOption | null {
  if (!row) {
    return null
  }

  const purchaseUoms = getTransferUOMOptions(row)

  return purchaseUoms.find((uom) => uom.is_default_purchase_uom) ??
    [...purchaseUoms].sort((first, second) => second.conversion_factor - first.conversion_factor)[0] ??
    getBaseUOM(row)
}

/**
 * Returns UOMs allowed in transfer intake, falling back to linked UOMs for older data.
 */
function getTransferUOMOptions(row: TransferStockRow | null): TransferUOMOption[] {
  if (!row) {
    return []
  }

  const purchaseUoms = row.uom_options.filter((uom) => uom.is_purchase_uom)
  return purchaseUoms.length > 0 ? purchaseUoms : row.uom_options
}

/**
 * Formats total base units in the selected transfer UOM.
 */
function formatBaseQuantity(baseQuantity: number, selectedUom: TransferUOMOption | null, baseUom: TransferUOMOption | null): string {
  if (!selectedUom || !baseUom) {
    return new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).format(baseQuantity)
  }

  if (selectedUom.id === baseUom.id || selectedUom.conversion_factor === 1) {
    return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).format(baseQuantity)} ${baseUom.name}`
  }

  return fromBaseUnits(baseQuantity, {
    name: selectedUom.name,
    conversionFactor: selectedUom.conversion_factor,
    baseUomName: baseUom.name,
  })
}

/**
 * Formats a product label for a stock option.
 */
function getProductLabel(row: TransferStockRow) {
  const product = row.products?.[0]
  const branch = row.branches?.[0]
  const sku = product?.sku ? ` · ${product.sku}` : ''
  const branchName = branch?.name ? ` · ${branch.name}` : ''
  const baseAvailable = Math.max(
    0,
    Number(row.base_quantity_on_hand ?? row.quantity_on_hand) - Number(row.base_quantity_reserved ?? row.quantity_reserved)
  )
  const available = formatBaseQuantity(baseAvailable, getDefaultReceivingUOM(row), getBaseUOM(row))

  return `${product?.name ?? 'Unknown product'}${sku}${branchName} · Available: ${available}`
}

/**
 * Initiate transfer button and modal.
 */
export default function TransferInitiateForm({ branches, stockRows, products, managedBranchIds }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [fromBranchId, setFromBranchId] = useState('')
  const [toBranchId, setToBranchId] = useState('')
  const [notes, setNotes] = useState('')
  const [items, setItems] = useState<TransferDraftItem[]>([createEmptyItem()])

  const { toast, toastState, dismiss } = useToast()
  const [state, action, isPending] = useActionState<FormState, FormData>(initiateTransfer, {
    success: false,
    error: null,
  })
  const previousPending = useRef(isPending)

  /**
   * Resets the draft form after a successful transfer creation.
   */
  useEffect(() => {
    let resetTimer: ReturnType<typeof setTimeout> | null = null

    if (previousPending.current && !isPending) {
      if (state.success) {
        toast.success('Transfer initiated successfully')
        router.refresh()
        resetTimer = setTimeout(() => {
          setOpen(false)
          setFromBranchId('')
          setToBranchId('')
          setNotes('')
          setItems([createEmptyItem()])
        }, 0)
      } else if (state.error) {
        toast.error(state.error)
      }
    }

    previousPending.current = isPending
    return () => {
      if (resetTimer) {
        clearTimeout(resetTimer)
      }
    }
  }, [isPending, router, state.error, state.success, toast])

  /**
   * Opens the modal with sensible defaults.
   */
  const openModal = () => {
    const firstBranch = branches.find((branch) => managedBranchIds.includes(branch.id))?.id ?? branches[0]?.id ?? ''
    const secondBranch = branches.find((branch) => branch.id !== firstBranch)?.id ?? ''
    const fallbackToBranch = secondBranch || ''

    setFromBranchId(firstBranch)
    setToBranchId(fallbackToBranch)
    setNotes('')
    setItems([createEmptyItem()])
    setOpen(true)
  }

  /**
   * Clears and updates the source branch selection.
   */
  const handleFromBranchChange = (value: string) => {
    setFromBranchId(value)
    setToBranchId(branches.find((branch) => branch.id !== value)?.id ?? '')
    setItems([createEmptyItem()])
  }

  /**
   * Adds a new blank product row to the modal.
   */
  const addItem = () => {
    setItems((current) => [...current, createEmptyItem()])
  }

  /**
   * Removes a product row when the user no longer needs it.
   */
  const removeItem = (index: number) => {
    setItems((current) => current.filter((_, currentIndex) => currentIndex !== index))
  }

  /**
   * Updates a single draft item field.
   */
  const updateItem = (index: number, field: keyof TransferDraftItem, value: string) => {
    setItems((current) =>
      current.map((item, currentIndex) =>
        currentIndex === index ? { ...item, [field]: value } : item
      )
    )
  }

  /**
   * Updates a single draft item with multiple field changes.
   */
  const updateItemPatch = (index: number, patch: Partial<TransferDraftItem>) => {
    setItems((current) =>
      current.map((item, currentIndex) =>
        currentIndex === index ? { ...item, ...patch } : item
      )
    )
  }

  /**
   * Submits the modal form to the server action.
   */
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const formData = new FormData()
    formData.set('fromBranchId', fromBranchId)
    formData.set('toBranchId', toBranchId)
    formData.set('notes', notes)
    formData.set('itemsCount', String(items.length))

    items.forEach((item, index) => {
      formData.set(`productId_${index}`, item.productId)
      formData.set(`uomId_${index}`, item.uomId)
      formData.set(`quantity_${index}`, item.quantity)
    })

    startTransition(() => {
      action(formData)
    })
  }

  const sourceStockRows = stockRows.filter((row) => row.branch_id === fromBranchId)
  const sourceProductOptions =
    sourceStockRows.length > 0
      ? sourceStockRows.map((row) => ({
          id: row.product_id,
          label: getProductLabel(row),
        }))
      : products.map((product) => ({
          id: product.id,
          label: `${product.name}${product.sku ? ` - ${product.sku}` : ''}`,
        }))
  const destinationOptions = branches.filter((branch) => branch.id !== fromBranchId)
  const routeTouchesManagedBranch = managedBranchIds.includes(fromBranchId) || managedBranchIds.includes(toBranchId)
  const canSubmit = fromBranchId !== '' && toBranchId !== '' && routeTouchesManagedBranch && items.length > 0

  return (
    <>
      {isPending && <LoadingOverlay message="Initiating transfer..." />}
      {toastState && (
        <Toast
          message={toastState.message}
          type={toastState.type}
          onDismiss={dismiss}
          duration={toastState.duration}
        />
      )}

      <button
        type="button"
        className="btn-primary"
        style={{ padding: '10px 20px', borderRadius: 6 }}
        onClick={openModal}
        disabled={branches.length < 2}
      >
        Initiate transfer
      </button>

      <Modal isOpen={open} title="Initiate transfer" onClose={() => setOpen(false)}>
        <form onSubmit={onSubmit}>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
              maxHeight: '70vh',
              overflowY: 'auto',
              paddingRight: 4,
            }}
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label style={{ fontSize: 13, display: 'block' }}>
                <span style={{ display: 'block', marginBottom: 6, fontWeight: 500 }}>From branch</span>
                <select
                  value={fromBranchId}
                  onChange={(event) => handleFromBranchChange(event.target.value)}
                  required
                  style={{
                    width: '100%',
                    height: 44,
                    border: '1px solid var(--color-border)',
                    borderRadius: 8,
                    padding: '0 12px',
                    boxSizing: 'border-box',
                    fontSize: 13,
                    backgroundColor: 'var(--color-background)',
                    color: 'var(--color-text-primary)',
                  }}
                >
                  <option value="">Select source branch</option>
                  {branches.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.name}
                    </option>
                  ))}
                </select>
              </label>

              <label style={{ fontSize: 13, display: 'block' }}>
                <span style={{ display: 'block', marginBottom: 6, fontWeight: 500 }}>To branch</span>
                <select
                  value={toBranchId}
                  onChange={(event) => setToBranchId(event.target.value)}
                  required
                  style={{
                    width: '100%',
                    height: 44,
                    border: '1px solid var(--color-border)',
                    borderRadius: 8,
                    padding: '0 12px',
                    boxSizing: 'border-box',
                    fontSize: 13,
                    backgroundColor: 'var(--color-background)',
                    color: 'var(--color-text-primary)',
                  }}
                >
                  <option value="">Select destination branch</option>
                  {destinationOptions.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div className="flex items-center justify-between gap-3">
                <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)' }}>
                  Products
                </p>
                <button
                  type="button"
                  className="btn-outline"
                  style={{ padding: '8px 16px', borderRadius: 8, fontSize: 13 }}
                  onClick={addItem}
                >
                  Add product
                </button>
              </div>

              {items.map((item, index) => {
                const selectedStockRow = sourceStockRows.find((row) => row.product_id === item.productId) ?? null
                const receivingUoms = getTransferUOMOptions(selectedStockRow)
                const selectedUom = receivingUoms.find((uom) => uom.id === item.uomId) ?? getDefaultReceivingUOM(selectedStockRow)
                const baseUom = getBaseUOM(selectedStockRow)
                const quantity = Number(item.quantity)
                const baseQuantity = selectedUom && Number.isFinite(quantity) && quantity > 0
                  ? quantity * selectedUom.conversion_factor
                  : null
                const baseAvailable = selectedStockRow
                  ? Math.max(
                      0,
                      Number(selectedStockRow.base_quantity_on_hand ?? selectedStockRow.quantity_on_hand) -
                        Number(selectedStockRow.base_quantity_reserved ?? selectedStockRow.quantity_reserved)
                    )
                  : 0
                const transferPreview = selectedUom && baseUom && baseQuantity !== null
                  ? `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).format(quantity)} ${selectedUom.name} = ${new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).format(baseQuantity)} ${baseUom.name}`
                  : null
                const availablePreview = selectedStockRow
                  ? formatBaseQuantity(baseAvailable, selectedUom, baseUom)
                  : null

                return (
                <div
                  key={`${index}-${item.productId || 'empty'}-${item.uomId || 'unit'}`}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'minmax(0, 1fr) minmax(150px, 190px) 120px auto',
                    gap: 10,
                    alignItems: 'end',
                  }}
                >
                  <label style={{ fontSize: 13, display: 'block' }}>
                    <span style={{ display: 'block', marginBottom: 6, fontWeight: 500 }}>Product</span>
                    <select
                      value={item.productId}
                      onChange={(event) => {
                        const nextProductId = event.target.value
                        const nextStockRow = sourceStockRows.find((row) => row.product_id === nextProductId) ?? null
                        updateItemPatch(index, {
                          productId: nextProductId,
                          uomId: getDefaultReceivingUOM(nextStockRow)?.id ?? '',
                        })
                      }}
                      required
                      disabled={!fromBranchId}
                      style={{
                        width: '100%',
                        height: 44,
                        border: '1px solid var(--color-border)',
                        borderRadius: 8,
                        padding: '0 12px',
                        boxSizing: 'border-box',
                        fontSize: 13,
                        backgroundColor: 'var(--color-background)',
                        color: 'var(--color-text-primary)',
                      }}
                    >
                      <option value="">{fromBranchId ? 'Select product' : 'Choose a source branch first'}</option>
                      {sourceProductOptions.map((product) => {
                        return (
                          <option key={product.id} value={product.id}>
                            {product.label}
                          </option>
                        )
                      })}
                    </select>
                  </label>

                  <label style={{ fontSize: 13, display: 'block' }}>
                    <span style={{ display: 'block', marginBottom: 6, fontWeight: 500 }}>Transfer as</span>
                    <select
                      value={item.uomId}
                      onChange={(event) => updateItem(index, 'uomId', event.target.value)}
                      required
                      disabled={!item.productId}
                      style={{
                        width: '100%',
                        height: 44,
                        border: '1px solid var(--color-border)',
                        borderRadius: 8,
                        padding: '0 12px',
                        boxSizing: 'border-box',
                        fontSize: 13,
                        backgroundColor: 'var(--color-background)',
                        color: 'var(--color-text-primary)',
                      }}
                    >
                      <option value="">{item.productId ? 'Select unit' : 'Select product first'}</option>
                      {receivingUoms.map((uom) => (
                        <option key={uom.id} value={uom.id}>
                          {uom.name}{baseUom ? ` (${uom.conversion_factor} ${baseUom.name})` : ''}
                        </option>
                      ))}
                    </select>
                    {availablePreview && (
                      <span style={{ display: 'block', marginTop: 6, fontSize: 12, color: 'var(--color-text-muted)' }}>
                        Available: {availablePreview}
                      </span>
                    )}
                  </label>

                  <label style={{ fontSize: 13, display: 'block' }}>
                    <span style={{ display: 'block', marginBottom: 6, fontWeight: 500 }}>Qty</span>
                    <input
                      type="number"
                      min={0.0001}
                      step="0.0001"
                      value={item.quantity}
                      onChange={(event) => updateItem(index, 'quantity', event.target.value)}
                      required
                      style={{
                        width: '100%',
                        height: 44,
                        border: '1px solid var(--color-border)',
                        borderRadius: 8,
                        padding: '0 12px',
                        boxSizing: 'border-box',
                        fontSize: 13,
                        backgroundColor: 'var(--color-background)',
                        color: 'var(--color-text-primary)',
                      }}
                    />
                    {transferPreview && selectedUom?.conversion_factor !== 1 && (
                      <span style={{ display: 'block', marginTop: 6, fontSize: 12, color: 'var(--color-text-muted)' }}>
                        Moves {transferPreview}
                      </span>
                    )}
                  </label>

                  <div>
                    {items.length > 1 ? (
                      <button
                        type="button"
                        className="btn-outline"
                        style={{ padding: '8px 16px', borderRadius: 8, fontSize: 13, height: 44 }}
                        onClick={() => removeItem(index)}
                      >
                        Remove
                      </button>
                    ) : (
                      <div style={{ height: 44 }} />
                    )}
                  </div>
                </div>
                )
              })}
            </div>

            <label style={{ fontSize: 13, display: 'block' }}>
              <span style={{ display: 'block', marginBottom: 6, fontWeight: 500 }}>Notes</span>
              <textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                rows={4}
                style={{
                  width: '100%',
                  border: '1px solid var(--color-border)',
                  borderRadius: 8,
                  padding: '10px 12px',
                  boxSizing: 'border-box',
                  fontSize: 13,
                  backgroundColor: 'var(--color-background)',
                  color: 'var(--color-text-primary)',
                  resize: 'vertical',
                }}
              />
            </label>

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

            {!routeTouchesManagedBranch && fromBranchId && toBranchId && (
              <div
                style={{
                  backgroundColor: 'var(--color-accent-light)',
                  border: '1px solid var(--color-accent)',
                  color: 'var(--color-accent)',
                  borderRadius: 8,
                  padding: '12px 14px',
                  fontSize: 13,
                }}
              >
                Select at least one branch you manage as the source or destination.
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
              <button
                type="submit"
                disabled={isPending || !canSubmit}
                className="btn-primary"
                style={{
                  flex: 1,
                  padding: '10px 20px',
                  borderRadius: 8,
                  opacity: isPending || !canSubmit ? 0.8 : 1,
                }}
                >
                  {isPending ? (
                    <span className="flex items-center justify-center gap-2">
                      <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                      </svg>
                    Initiating transfer...
                  </span>
                ) : (
                  'Initiate transfer'
                )}
              </button>
              <button
                type="button"
                className="btn-outline"
                style={{ flex: 1, padding: '10px 20px', borderRadius: 8 }}
                onClick={() => setOpen(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </form>
      </Modal>
    </>
  )
}
