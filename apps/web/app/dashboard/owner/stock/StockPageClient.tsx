'use client'
/**
 * Interactive stock dashboard client.
 *
 * Provides four stock workflows: current levels, supplier deliveries, delivery
 * approvals/arrival acknowledgements, and movement history. Mutations use
 * Server Actions and branch-scoped RPCs.
 */

import { startTransition, useEffect, useRef, useState, type FormEvent } from 'react'
import { useActionState } from 'react'
import { useRouter } from 'next/navigation'
import Modal from '../../../../components/ui/Modal'
import LoadingOverlay from '../../../../components/ui/LoadingOverlay'
import Toast from '../../../../components/ui/Toast'
import { Badge } from '../../../../components/ui/Badge'
import { useToast } from '../../../../lib/hooks/useToast'
import StockDeliveryActions from './StockDeliveryActions'
import DeliveryEditRequestActions from './DeliveryEditRequestActions'
import { recordSupplierDelivery, requestSupplierDeliveryEdit, updateLowStockThreshold } from './actions'
import type {
  BranchStockRow,
  BranchSummary as Branch,
  FormState,
  StockDeliveryEditRequestRow,
  StockDeliveryRow,
  StockMetrics,
  StockMovementRow,
  StockProductOption,
  StockUOMOption,
} from './types'

/**
 * Cost/expense row attached to a received product line.
 */
type DeliveryCostDraft = {
  id: string
  description: string
  amount: string
}

/**
 * Delivery row stored in local component state.
 */
type DeliveryItemDraft = {
  id: string
  productId: string
  uomId: string
  quantity: string
  costs: DeliveryCostDraft[]
  notes: string
}

/**
 * Existing delivery row being edited.
 */
type DeliveryEditItemDraft = DeliveryItemDraft & {
  deliveryItemId: string
}

/**
 * Visible stock tabs.
 */
type StockTab = 'levels' | 'delivery' | 'approvals' | 'history'

/**
 * Icon for SKU metrics.
 */
function SkuIcon() {
  return (
    <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="9" y1="9" x2="15" y2="9" />
      <line x1="9" y1="15" x2="15" y2="15" />
    </svg>
  )
}

/**
 * Icon for stock alert metrics.
 */
function AlertIcon() {
  return (
    <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  )
}

/**
 * Icon for stock metrics.
 */
function StockIcon() {
  return (
    <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path d="M5 12h14M12 5v14" />
    </svg>
  )
}

/**
 * Compact metric card used on the stock dashboard.
 */
function MetricCard({ label, value, icon, color }: { label: string; value: string; icon: React.ReactNode; color: string }) {
  return (
    <div
      style={{
        backgroundColor: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-card)',
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ color, opacity: 0.7 }}>{icon}</div>
        <span style={{ fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 500 }}>{label}</span>
      </div>
      <p style={{ fontSize: 28, fontWeight: 700, color, margin: 0 }}>{value}</p>
    </div>
  )
}

/**
 * Shared form input styling.
 */
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
 * Returns the stock health badge.
 */
function getStockStatus(row: BranchStockRow): { label: string; variant: 'danger' | 'warning' | 'success' | 'muted' } {
  const quantityOnHand = Number(row.base_quantity_on_hand ?? row.quantity_on_hand)
  const baseThreshold = getBaseThreshold(row)

  if (quantityOnHand === 0) return { label: 'Out of stock', variant: 'danger' }
  if (quantityOnHand <= Math.min(5, baseThreshold)) return { label: 'Critical', variant: 'danger' }
  if (quantityOnHand <= baseThreshold) return { label: 'Low stock', variant: 'warning' }
  return { label: 'Healthy', variant: 'success' }
}

/**
 * Finds the base UOM label for a stock row.
 */
function getBaseUOM(row: BranchStockRow): StockUOMOption | null {
  return row.uom_options.find((uom) => uom.is_base_uom || uom.is_base_unit || uom.conversion_factor === 1) ?? row.uom_options[0] ?? null
}

/**
 * Finds the preferred receiving UOM for stock display.
 */
function getDefaultReceivingUOM(row: BranchStockRow): StockUOMOption | null {
  const purchaseUoms = row.uom_options.filter((uom) => uom.is_purchase_uom)

  return purchaseUoms.find((uom) => uom.is_default_purchase_uom) ??
    [...purchaseUoms].sort((first, second) => second.conversion_factor - first.conversion_factor)[0] ??
    getBaseUOM(row)
}

/**
 * Converts the stored threshold from receiving UOM into base units.
 */
function getBaseThreshold(row: BranchStockRow): number {
  return Number(row.low_stock_threshold ?? 0) * (getDefaultReceivingUOM(row)?.conversion_factor ?? 1)
}

/**
 * Finds the preferred UOM for stock intake product options.
 */
function getDefaultProductUOM(product: StockProductOption | null): StockUOMOption | null {
  if (!product) {
    return null
  }

  const purchaseUoms = product.uom_options.filter((uom) => uom.is_purchase_uom)

  return purchaseUoms.find((uom) => uom.is_default_purchase_uom) ??
    [...purchaseUoms].sort((first, second) => second.conversion_factor - first.conversion_factor)[0] ??
    product.uom_options.find((uom) => uom.is_base_uom || uom.is_base_unit || uom.conversion_factor === 1) ??
    product.uom_options[0] ??
    null
}

/**
 * Finds the base UOM for a product option.
 */
function getProductBaseUOM(product: StockProductOption | null): StockUOMOption | null {
  if (!product) {
    return null
  }

  return product.uom_options.find((uom) => uom.is_base_uom || uom.is_base_unit || uom.conversion_factor === 1) ?? product.uom_options[0] ?? null
}

/**
 * Formats stock for operational display: receiving UOM first, exact base total second.
 */
function formatReceivingQuantity(
  baseQuantity: number,
  receivingUom: StockUOMOption | null,
  baseUom: StockUOMOption | null,
  suffix: string,
  options: { showZeroReceivingUom?: boolean } = {}
): { primary: string; secondary: string | null } {
  const formattedBaseQuantity = new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).format(baseQuantity)

  if (!receivingUom || !baseUom || receivingUom.conversion_factor <= 1) {
    return {
      primary: `${formattedBaseQuantity} ${baseUom?.name ?? receivingUom?.name ?? 'units'} ${suffix}`,
      secondary: null,
    }
  }

  const receivingQuantity = Math.floor(baseQuantity / receivingUom.conversion_factor)
  const remainingBaseQuantity = Math.round((baseQuantity - receivingQuantity * receivingUom.conversion_factor) * 10000) / 10000

  if (receivingQuantity <= 0 && !options.showZeroReceivingUom) {
    return {
      primary: `${formattedBaseQuantity} ${baseUom.name} ${suffix}`,
      secondary: null,
    }
  }

  const formattedReceivingQuantity = new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).format(receivingQuantity)
  const formattedRemainingBaseQuantity = new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).format(remainingBaseQuantity)
  const remainderText = remainingBaseQuantity > 0 || options.showZeroReceivingUom
    ? ` and ${formattedRemainingBaseQuantity} ${baseUom.name}`
    : ''

  return {
    primary: `${formattedReceivingQuantity} ${receivingUom.name}${remainderText} ${suffix}`,
    secondary: `(${formattedBaseQuantity} ${baseUom.name})`,
  }
}

/**
 * Formats threshold in receiving UOM and base units for clarity.
 */
function formatThreshold(row: BranchStockRow, baseUom: StockUOMOption | null): { primary: string; secondary: string | null } {
  const receivingUom = getDefaultReceivingUOM(row)
  const threshold = Number(row.low_stock_threshold ?? 0)
  const baseThreshold = getBaseThreshold(row)

  if (!receivingUom || !baseUom) {
    return {
      primary: new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).format(threshold),
      secondary: null,
    }
  }

  return {
    primary: `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).format(threshold)} ${receivingUom.name}`,
    secondary: receivingUom.conversion_factor === 1
      ? null
      : `(${new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).format(baseThreshold)} ${baseUom.name})`,
  }
}

/**
 * Formats movement history labels.
 */
function formatMovementType(type: StockMovementRow['movement_type']) {
  if (type === 'supplier_delivery') return 'Supplier delivery'
  if (type === 'transfer_in') return 'Transfer in'
  if (type === 'transfer_out') return 'Transfer out'
  if (type === 'sale_deduction') return 'Sale deduction'
  if (type === 'recovery_sale') return 'Recovery sale'
  if (type === 'inventory_loss') return 'Inventory loss'
  return 'Manual adjustment'
}

/**
 * Formats timestamps for movement history.
 */
function formatDateTime(isoDate: string) {
  return new Date(isoDate).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Stock dashboard client component.
 */
export default function StockPageClient({
  rows,
  metrics,
  branches,
  products,
  movements,
  deliveries,
  deliveryEditRequests,
  role,
}: {
  role: 'owner' | 'admin'
  rows: BranchStockRow[]
  metrics: StockMetrics
  branches: Branch[]
  products: StockProductOption[]
  movements: StockMovementRow[]
  deliveries: StockDeliveryRow[]
  deliveryEditRequests: StockDeliveryEditRequestRow[]
}) {
  const router = useRouter()
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<StockTab>('levels')
  const [thresholdOpen, setThresholdOpen] = useState(false)
  const [selectedStock, setSelectedStock] = useState<BranchStockRow | null>(null)
  const [threshold, setThreshold] = useState('')
  const [deliveryEditOpen, setDeliveryEditOpen] = useState(false)
  const [editingDelivery, setEditingDelivery] = useState<StockDeliveryRow | null>(null)
  const [editSupplierName, setEditSupplierName] = useState('')
  const [editReferenceCode, setEditReferenceCode] = useState('')
  const [editReason, setEditReason] = useState('')
  const [editDeliveryItems, setEditDeliveryItems] = useState<DeliveryEditItemDraft[]>([])
  const [deliveryBranchId, setDeliveryBranchId] = useState(branches[0]?.id ?? '')
  const [supplierName, setSupplierName] = useState('')
  const [referenceCode, setReferenceCode] = useState('')
  const createDeliveryItem = (id: string): DeliveryItemDraft => ({
    id,
    productId: products[0]?.id ?? '',
    uomId: getDefaultProductUOM(products[0] ?? null)?.id ?? '',
    quantity: '',
    costs: [],
    notes: '',
  })
  const [deliveryItems, setDeliveryItems] = useState<DeliveryItemDraft[]>([
    createDeliveryItem('item-0'),
  ])

  const { toast, toastState, dismiss } = useToast()
  const [deliveryState, deliveryAction, deliveryPending] = useActionState<FormState, FormData>(recordSupplierDelivery, {
    success: false,
    error: null,
  })
  const [thresholdState, thresholdAction, thresholdPending] = useActionState<FormState, FormData>(updateLowStockThreshold, {
    success: false,
    error: null,
  })
  const [deliveryEditState, deliveryEditAction, deliveryEditPending] = useActionState<FormState, FormData>(requestSupplierDeliveryEdit, {
    success: false,
    error: null,
  })
  const previousDeliveryPending = useRef(deliveryPending)
  const previousThresholdPending = useRef(thresholdPending)
  const previousDeliveryEditPending = useRef(deliveryEditPending)

  /**
   * Handles delivery success/error side effects.
   */
  useEffect(() => {
    let resetTimer: ReturnType<typeof setTimeout> | null = null

    if (previousDeliveryPending.current && !deliveryPending) {
      if (deliveryState.success) {
        toast.success('Supplier delivery recorded')
        resetTimer = setTimeout(() => {
          setSupplierName('')
          setReferenceCode('')
          setDeliveryItems([createDeliveryItem('item-0')])
          router.refresh()
        }, 0)
      } else if (deliveryState.error) {
        toast.error(deliveryState.error)
      }
    }

    previousDeliveryPending.current = deliveryPending
    return () => {
      if (resetTimer) clearTimeout(resetTimer)
    }
  }, [deliveryPending, deliveryState.error, deliveryState.success, products, router, toast])

  /**
   * Handles threshold success/error side effects.
   */
  useEffect(() => {
    let resetTimer: ReturnType<typeof setTimeout> | null = null

    if (previousThresholdPending.current && !thresholdPending) {
      if (thresholdState.success) {
        toast.success('Low-stock threshold updated')
        resetTimer = setTimeout(() => {
          setThresholdOpen(false)
          setSelectedStock(null)
          setThreshold('')
          router.refresh()
        }, 0)
      } else if (thresholdState.error) {
        toast.error(thresholdState.error)
      }
    }

    previousThresholdPending.current = thresholdPending
    return () => {
      if (resetTimer) clearTimeout(resetTimer)
    }
  }, [router, thresholdPending, thresholdState.error, thresholdState.success, toast])

  /**
   * Handles delivery edit success/error side effects.
   */
  useEffect(() => {
    let resetTimer: ReturnType<typeof setTimeout> | null = null

    if (previousDeliveryEditPending.current && !deliveryEditPending) {
      if (deliveryEditState.success) {
        toast.success(role === 'owner' ? 'Delivery updated' : 'Delivery edit sent for owner approval')
        resetTimer = setTimeout(() => {
          setDeliveryEditOpen(false)
          setEditingDelivery(null)
          setEditSupplierName('')
          setEditReferenceCode('')
          setEditReason('')
          setEditDeliveryItems([])
          router.refresh()
        }, 0)
      } else if (deliveryEditState.error) {
        toast.error(deliveryEditState.error)
      }
    }

    previousDeliveryEditPending.current = deliveryEditPending
    return () => {
      if (resetTimer) clearTimeout(resetTimer)
    }
  }, [deliveryEditPending, deliveryEditState.error, deliveryEditState.success, role, router, toast])

  const filteredRows = selectedBranch ? rows.filter((row) => row.branch_id === selectedBranch) : rows
  const filteredMovements = selectedBranch ? movements.filter((movement) => movement.branch_id === selectedBranch) : movements
  const filteredDeliveries = selectedBranch ? deliveries.filter((delivery) => delivery.branch_id === selectedBranch) : deliveries
  const filteredDeliveryEditRequests = selectedBranch
    ? deliveryEditRequests.filter((request) => request.branch_id === selectedBranch)
    : deliveryEditRequests

  /**
   * Opens the threshold update modal for a stock row.
   */
  const openThresholdModal = (row: BranchStockRow) => {
    setSelectedStock(row)
    setThreshold(String(row.low_stock_threshold))
    setThresholdOpen(true)
  }

  /**
   * Updates one delivery item draft.
   */
  const updateDeliveryItem = (id: string, patch: Partial<DeliveryItemDraft>) => {
    setDeliveryItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  }

  /**
   * Adds another delivery product row.
   */
  const addDeliveryItem = () => {
    setDeliveryItems((current) => [
      ...current,
      createDeliveryItem(`item-${current.length}`),
    ])
  }

  /**
   * Removes one delivery product row.
   */
  const removeDeliveryItem = (id: string) => {
    setDeliveryItems((current) => (current.length === 1 ? current : current.filter((item) => item.id !== id)))
  }

  /**
   * Adds one cost/expense row to a delivery item.
   */
  const addDeliveryCost = (itemId: string) => {
    setDeliveryItems((current) =>
      current.map((item) =>
        item.id === itemId
          ? {
              ...item,
              costs: [
                ...item.costs,
                {
                  id: `cost-${item.costs.length}-${Date.now()}`,
                  description: '',
                  amount: '',
                },
              ],
            }
          : item
      )
    )
  }

  /**
   * Updates a single delivery cost row.
   */
  const updateDeliveryCost = (itemId: string, costId: string, patch: Partial<DeliveryCostDraft>) => {
    setDeliveryItems((current) =>
      current.map((item) =>
        item.id === itemId
          ? {
              ...item,
              costs: item.costs.map((cost) => (cost.id === costId ? { ...cost, ...patch } : cost)),
            }
          : item
      )
    )
  }

  /**
   * Removes a cost row from a delivery item.
   */
  const removeDeliveryCost = (itemId: string, costId: string) => {
    setDeliveryItems((current) =>
      current.map((item) =>
        item.id === itemId
          ? {
              ...item,
              costs: item.costs.filter((cost) => cost.id !== costId),
            }
          : item
      )
    )
  }

  /**
   * Opens the delivery edit modal with existing delivery line values.
   */
  const openDeliveryEditModal = (delivery: StockDeliveryRow) => {
    setEditingDelivery(delivery)
    setEditSupplierName(delivery.supplier_name)
    setEditReferenceCode(delivery.reference_code ?? '')
    setEditReason('')
    setEditDeliveryItems(
      delivery.items.map((item, index) => ({
        id: `edit-${item.id}-${index}`,
        deliveryItemId: item.id,
        productId: item.product_id,
        uomId: item.uom_id ?? '',
        quantity: String(item.quantity_in_uom ?? item.base_quantity_received ?? item.base_quantity_expected),
        costs: item.costs.length > 0
          ? item.costs.map((cost) => ({
              id: cost.id,
              description: cost.description,
              amount: String(cost.amount),
            }))
          : item.total_cost && item.total_cost > 0
            ? [{ id: `cost-${item.id}`, description: 'Stock expense', amount: String(item.total_cost) }]
            : [],
        notes: item.notes ?? '',
      }))
    )
    setDeliveryEditOpen(true)
  }

  /**
   * Updates one delivery edit draft item.
   */
  const updateEditDeliveryItem = (id: string, patch: Partial<DeliveryEditItemDraft>) => {
    setEditDeliveryItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  }

  /**
   * Adds one cost/expense row to an edited delivery item.
   */
  const addEditDeliveryCost = (itemId: string) => {
    setEditDeliveryItems((current) =>
      current.map((item) =>
        item.id === itemId
          ? {
              ...item,
              costs: [
                ...item.costs,
                {
                  id: `edit-cost-${item.costs.length}-${Date.now()}`,
                  description: '',
                  amount: '',
                },
              ],
            }
          : item
      )
    )
  }

  /**
   * Updates one cost row on an edited delivery item.
   */
  const updateEditDeliveryCost = (itemId: string, costId: string, patch: Partial<DeliveryCostDraft>) => {
    setEditDeliveryItems((current) =>
      current.map((item) =>
        item.id === itemId
          ? {
              ...item,
              costs: item.costs.map((cost) => (cost.id === costId ? { ...cost, ...patch } : cost)),
            }
          : item
      )
    )
  }

  /**
   * Removes a cost row from an edited delivery item.
   */
  const removeEditDeliveryCost = (itemId: string, costId: string) => {
    setEditDeliveryItems((current) =>
      current.map((item) =>
        item.id === itemId
          ? {
              ...item,
              costs: item.costs.filter((cost) => cost.id !== costId),
            }
          : item
      )
    )
  }

  /**
   * Submits a supplier delivery.
   */
  const onDeliverySubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const formData = new FormData()
    formData.set('branchId', deliveryBranchId)
    formData.set('supplierName', supplierName)
    formData.set('referenceCode', referenceCode)
    formData.set('itemsCount', String(deliveryItems.length))
    deliveryItems.forEach((item, index) => {
      const totalCost = item.costs.reduce((sum, cost) => {
        const amount = Number(cost.amount)
        return Number.isFinite(amount) && amount > 0 ? sum + amount : sum
      }, 0)

      formData.set(`productId_${index}`, item.productId)
      formData.set(`uomId_${index}`, item.uomId)
      formData.set(`quantity_${index}`, item.quantity)
      formData.set(`unitCost_${index}`, totalCost > 0 ? String(totalCost) : '')
      formData.set(`costCount_${index}`, String(item.costs.length))
      item.costs.forEach((cost, costIndex) => {
        formData.set(`costDescription_${index}_${costIndex}`, cost.description)
        formData.set(`costAmount_${index}_${costIndex}`, cost.amount)
      })
      formData.set(`notes_${index}`, item.notes)
    })

    startTransition(() => {
      deliveryAction(formData)
    })
  }

  /**
   * Submits a threshold update.
   */
  const onThresholdSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!selectedStock) return

    const formData = new FormData()
    formData.set('stockId', selectedStock.id)
    formData.set('branchId', selectedStock.branch_id)
    formData.set('threshold', threshold)

    startTransition(() => {
      thresholdAction(formData)
    })
  }

  /**
   * Submits an existing supplier delivery edit or approval request.
   */
  const onDeliveryEditSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!editingDelivery) return

    const formData = new FormData()

    formData.set('deliveryId', editingDelivery.id)
    formData.set('branchId', editingDelivery.branch_id)
    formData.set('supplierName', editSupplierName)
    formData.set('referenceCode', editReferenceCode)
    formData.set('reason', editReason)
    formData.set('itemsCount', String(editDeliveryItems.length))
    editDeliveryItems.forEach((item, index) => {
      const totalCost = item.costs.reduce((sum, cost) => {
        const amount = Number(cost.amount)
        return Number.isFinite(amount) && amount > 0 ? sum + amount : sum
      }, 0)

      formData.set(`deliveryItemId_${index}`, item.deliveryItemId)
      formData.set(`productId_${index}`, item.productId)
      formData.set(`uomId_${index}`, item.uomId)
      formData.set(`quantity_${index}`, item.quantity)
      formData.set(`unitCost_${index}`, totalCost > 0 ? String(totalCost) : '')
      formData.set(`costCount_${index}`, String(item.costs.length))
      item.costs.forEach((cost, costIndex) => {
        formData.set(`costDescription_${index}_${costIndex}`, cost.description)
        formData.set(`costAmount_${index}_${costIndex}`, cost.amount)
      })
      formData.set(`notes_${index}`, item.notes)
    })

    startTransition(() => {
      deliveryEditAction(formData)
    })
  }

  return (
    <>
      {(deliveryPending || thresholdPending || deliveryEditPending) && (
        <LoadingOverlay
          message={
            deliveryPending
              ? 'Recording supplier delivery...'
              : deliveryEditPending
                ? 'Submitting delivery edit...'
                : 'Updating threshold...'
          }
        />
      )}
      {toastState && <Toast message={toastState.message} type={toastState.type} onDismiss={dismiss} duration={toastState.duration} />}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard label="Total SKUs" value={metrics.totalSkus.toString()} icon={<SkuIcon />} color="var(--color-text-primary)" />
        <MetricCard label="Low stock items" value={metrics.lowStockCount.toString()} icon={<AlertIcon />} color="var(--color-accent)" />
        <MetricCard label="Out of stock" value={metrics.outOfStockCount.toString()} icon={<StockIcon />} color="var(--color-danger)" />
        <MetricCard label="Branches with alerts" value={metrics.branchesWithAlerts.toString()} icon={<AlertIcon />} color="var(--color-accent)" />
      </div>

      <div className="flex flex-wrap gap-2">
        {([
          ['levels', 'Current levels'],
          ['delivery', 'Supplier delivery'],
          ['approvals', 'Deliveries & approvals'],
          ['history', 'Movement history'],
        ] as Array<[StockTab, string]>).map(([tab, label]) => (
          <button
            key={tab}
            type="button"
            className={activeTab === tab ? 'btn-primary' : 'btn-outline'}
            style={{ padding: '8px 16px', borderRadius: 8 }}
            onClick={() => setActiveTab(tab)}
          >
            {label}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 2, borderBottom: '1px solid var(--color-border)', overflowX: 'auto' }}>
        <button
          type="button"
          onClick={() => setSelectedBranch(null)}
          style={{
            padding: '12px 16px',
            fontSize: 13,
            fontWeight: selectedBranch === null ? 600 : 500,
            color: selectedBranch === null ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
            borderBottom: selectedBranch === null ? '2px solid var(--color-primary)' : 'none',
            background: 'transparent',
            borderTop: 'none',
            borderLeft: 'none',
            borderRight: 'none',
            cursor: 'pointer',
          }}
        >
          All
        </button>
        {branches.map((branch) => (
          <button
            key={branch.id}
            type="button"
            onClick={() => {
              setSelectedBranch(branch.id)
              setDeliveryBranchId(branch.id)
            }}
            style={{
              padding: '12px 16px',
              fontSize: 13,
              fontWeight: selectedBranch === branch.id ? 600 : 500,
              color: selectedBranch === branch.id ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
              borderBottom: selectedBranch === branch.id ? '2px solid var(--color-primary)' : 'none',
              background: 'transparent',
              borderTop: 'none',
              borderLeft: 'none',
              borderRight: 'none',
              cursor: 'pointer',
            }}
          >
            {branch.name}
          </button>
        ))}
      </div>

      {activeTab === 'levels' && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                {['Product', 'SKU', 'Branch', 'On hand', 'Reserved', 'Threshold', 'Status', 'Action'].map((heading) => (
                  <th key={heading} style={{ padding: '12px', textAlign: 'left', fontWeight: 600, color: 'var(--color-text-muted)' }}>
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ padding: '20px 12px', textAlign: 'center', color: 'var(--color-text-muted)' }}>
                    No stock records found.
                  </td>
                </tr>
              ) : (
                filteredRows.map((row) => {
                  const status = getStockStatus(row)
                  const baseUom = getBaseUOM(row)
                  const receivingUom = getDefaultReceivingUOM(row)
                  const baseOnHand = Number(row.base_quantity_on_hand ?? row.quantity_on_hand)
                  const baseReserved = Number(row.base_quantity_reserved ?? row.quantity_reserved ?? 0)
                  const onHandDisplay = formatReceivingQuantity(baseOnHand, receivingUom, baseUom, 'remaining')
                  const reservedDisplay = formatReceivingQuantity(baseReserved, receivingUom, baseUom, 'reserved', {
                    showZeroReceivingUom: true,
                  })
                  const thresholdDisplay = formatThreshold(row, baseUom)

                  return (
                    <tr key={row.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                      <td style={{ padding: 12, color: 'var(--color-text-primary)', fontWeight: 500 }}>{row.products?.[0]?.name ?? '-'}</td>
                      <td style={{ padding: 12, color: 'var(--color-text-muted)' }}>{row.products?.[0]?.sku ?? '-'}</td>
                      <td style={{ padding: 12, color: 'var(--color-text-primary)' }}>{row.branches?.[0]?.name ?? '-'}</td>
                      <td style={{ padding: 12, minWidth: 220 }}>
                        <div className="flex flex-col gap-2">
                          <span style={{ color: 'var(--color-text-primary)', fontWeight: 700 }}>
                            {onHandDisplay.primary}
                          </span>
                          {onHandDisplay.secondary && (
                            <span style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>
                              {onHandDisplay.secondary}
                            </span>
                          )}
                        </div>
                      </td>
                      <td style={{ padding: 12, textAlign: 'center', color: 'var(--color-text-muted)' }}>
                        <span style={{ display: 'block', color: 'var(--color-text-primary)', fontWeight: 600 }}>
                          {reservedDisplay.primary}
                        </span>
                        {reservedDisplay.secondary && (
                          <span style={{ display: 'block', fontSize: 12, marginTop: 3 }}>
                            {reservedDisplay.secondary}
                          </span>
                        )}
                      </td>
                      <td style={{ padding: 12, textAlign: 'center', color: 'var(--color-text-muted)' }}>
                        <span style={{ display: 'block', color: 'var(--color-text-primary)', fontWeight: 600 }}>
                          {thresholdDisplay.primary}
                        </span>
                        {thresholdDisplay.secondary && (
                          <span style={{ display: 'block', fontSize: 12, marginTop: 3 }}>
                            {thresholdDisplay.secondary}
                          </span>
                        )}
                      </td>
                      <td style={{ padding: 12 }}>
                        <Badge variant={status.variant}>{status.label}</Badge>
                      </td>
                      <td style={{ padding: 12 }}>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            className="btn-outline"
                            onClick={() => openThresholdModal(row)}
                            style={{ padding: '5px 14px', borderRadius: 8, fontSize: 12 }}
                          >
                            Set threshold
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'delivery' && (
        <form onSubmit={onDeliverySubmit}>
          <div className="flex flex-col gap-4 rounded-xl" style={{ border: '1px solid var(--color-border)', padding: 20, backgroundColor: 'var(--color-surface)' }}>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <label style={{ fontSize: 13 }}>
                <span style={{ display: 'block', marginBottom: 6, fontWeight: 500, color: 'var(--color-text-primary)' }}>Branch</span>
                <select value={deliveryBranchId} onChange={(event) => setDeliveryBranchId(event.target.value)} required style={inputStyle}>
                  <option value="">Select branch</option>
                  {branches.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.name}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ fontSize: 13 }}>
                <span style={{ display: 'block', marginBottom: 6, fontWeight: 500, color: 'var(--color-text-primary)' }}>Supplier</span>
                <input value={supplierName} onChange={(event) => setSupplierName(event.target.value)} required style={inputStyle} />
              </label>
              <label style={{ fontSize: 13 }}>
                <span style={{ display: 'block', marginBottom: 6, fontWeight: 500, color: 'var(--color-text-primary)' }}>Reference</span>
                <input value={referenceCode} onChange={(event) => setReferenceCode(event.target.value)} style={inputStyle} />
              </label>
            </div>

            <div className="flex flex-col gap-3">
              {deliveryItems.map((item, index) => {
                const selectedProduct = products.find((product) => product.id === item.productId) ?? null
                const receivingUoms = (selectedProduct?.uom_options ?? []).filter((uom) => uom.is_purchase_uom)
                const selectedUom = selectedProduct?.uom_options.find((uom) => uom.id === item.uomId) ?? getDefaultProductUOM(selectedProduct)
                const baseUom = getProductBaseUOM(selectedProduct)
                const quantity = Number(item.quantity)
                const totalLineCost = item.costs.reduce((sum, cost) => {
                  const amount = Number(cost.amount)
                  return Number.isFinite(amount) && amount > 0 ? sum + amount : sum
                }, 0)
                const baseQuantity = selectedUom && Number.isFinite(quantity) && quantity > 0
                  ? quantity * selectedUom.conversion_factor
                  : 0
                const basePreview = selectedUom && baseUom && Number.isFinite(quantity) && quantity > 0
                  ? `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).format(quantity)} ${selectedUom.name} = ${new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).format(quantity * selectedUom.conversion_factor)} ${baseUom.name}`
                  : null
                const costPreview = selectedUom && baseUom && Number.isFinite(quantity) && quantity > 0 && baseQuantity > 0 && totalLineCost > 0
                  ? `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).format(totalLineCost / quantity)} per ${selectedUom.name}; ${new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).format(totalLineCost / baseQuantity)} per ${baseUom.name}`
                  : null

                return (
                <div key={item.id} className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-12 gap-3">
                  <label style={{ fontSize: 13 }}>
                    <span style={{ display: 'block', marginBottom: 6, fontWeight: 500, color: 'var(--color-text-primary)' }}>Product</span>
                    <select
                      value={item.productId}
                      onChange={(event) => {
                        const nextProduct = products.find((product) => product.id === event.target.value) ?? null
                        updateDeliveryItem(item.id, {
                          productId: event.target.value,
                          uomId: getDefaultProductUOM(nextProduct)?.id ?? '',
                        })
                      }}
                      required
                      style={inputStyle}
                    >
                      <option value="">Select product</option>
                      {products.map((product) => (
                        <option key={product.id} value={product.id}>
                          {product.name}{product.sku ? ` - ${product.sku}` : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label style={{ fontSize: 13 }}>
                    <span style={{ display: 'block', marginBottom: 6, fontWeight: 500, color: 'var(--color-text-primary)' }}>Receive as</span>
                    <select value={item.uomId} onChange={(event) => updateDeliveryItem(item.id, { uomId: event.target.value })} required style={inputStyle}>
                      <option value="">Select stock unit</option>
                      {receivingUoms.map((uom) => (
                        <option key={uom.id} value={uom.id}>
                          {uom.name}{baseUom ? ` (${uom.conversion_factor} ${baseUom.name})` : ''}
                        </option>
                      ))}
                    </select>
                    {basePreview && (
                      <span style={{ display: 'block', marginTop: 6, color: 'var(--color-text-muted)', fontSize: 12 }}>
                        Adds {basePreview} to stock
                      </span>
                    )}
                  </label>
                  <label style={{ fontSize: 13 }}>
                    <span style={{ display: 'block', marginBottom: 6, fontWeight: 500, color: 'var(--color-text-primary)' }}>Quantity</span>
                    <input type="number" min={0.0001} step="0.0001" value={item.quantity} onChange={(event) => updateDeliveryItem(item.id, { quantity: event.target.value })} required style={inputStyle} />
                  </label>
                  <div className="md:col-span-2 xl:col-span-4" style={{ fontSize: 13 }}>
                    <span style={{ display: 'block', marginBottom: 6, fontWeight: 500, color: 'var(--color-text-primary)' }}>Costs / expenses</span>
                    {item.costs.length > 0 ? (
                      <div className="flex flex-col gap-2">
                        {item.costs.map((cost) => (
                          <div key={cost.id} className="grid grid-cols-1 sm:grid-cols-[minmax(220px,1fr)_120px_auto] gap-2">
                            <input
                              value={cost.description}
                              onChange={(event) => updateDeliveryCost(item.id, cost.id, { description: event.target.value })}
                              placeholder="Describe cost, e.g. Transport"
                              style={{ ...inputStyle, height: 38 }}
                            />
                            <input
                              type="number"
                              min={0}
                              step="0.01"
                              value={cost.amount}
                              onChange={(event) => updateDeliveryCost(item.id, cost.id, { amount: event.target.value })}
                              placeholder="Amount"
                              style={{ ...inputStyle, height: 38 }}
                            />
                            <button
                              type="button"
                              className="btn-outline"
                              onClick={() => removeDeliveryCost(item.id, cost.id)}
                              style={{ height: 38, padding: '0 10px', borderRadius: 8 }}
                            >
                              X
                            </button>
                          </div>
                        ))}
                        <button
                          type="button"
                          className="btn-outline"
                          onClick={() => addDeliveryCost(item.id)}
                          style={{ height: 38, borderRadius: 8 }}
                        >
                          Add another cost
                        </button>
                        <span style={{ display: 'block', color: 'var(--color-text-muted)', fontSize: 12 }}>
                          Total cost for this line: {new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(totalLineCost)}
                        </span>
                        {costPreview && (
                          <span style={{ display: 'block', color: 'var(--color-text-muted)', fontSize: 12 }}>
                            Cost basis: {costPreview}
                          </span>
                        )}
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="btn-outline"
                        onClick={() => addDeliveryCost(item.id)}
                        style={{ width: '100%', height: 44, borderRadius: 8 }}
                      >
                        Add cost/expense
                      </button>
                    )}
                  </div>
                  <label className="md:col-span-2 xl:col-span-11 xl:row-start-2" style={{ fontSize: 13 }}>
                    <span style={{ display: 'block', marginBottom: 6, fontWeight: 500, color: 'var(--color-text-primary)' }}>Notes</span>
                    <input value={item.notes} onChange={(event) => updateDeliveryItem(item.id, { notes: event.target.value })} style={inputStyle} />
                  </label>
                  <div className="flex items-end xl:col-span-1 xl:row-start-2">
                    <button type="button" className="btn-outline" onClick={() => removeDeliveryItem(item.id)} style={{ padding: '8px 16px', borderRadius: 8 }} disabled={index === 0 && deliveryItems.length === 1}>
                      Remove
                    </button>
                  </div>
                </div>
                )
              })}
            </div>

            {deliveryState.error && <p style={{ fontSize: 13, color: 'var(--color-danger)', margin: 0 }}>{deliveryState.error}</p>}

            <div className="flex flex-col gap-3 sm:flex-row sm:justify-between">
              <button type="button" className="btn-outline" onClick={addDeliveryItem} style={{ padding: '8px 16px', borderRadius: 8 }}>
                Add product
              </button>
              <button type="submit" className="btn-primary" disabled={deliveryPending} style={{ padding: '10px 20px', borderRadius: 8, opacity: deliveryPending ? 0.8 : 1 }}>
                {deliveryPending ? 'Recording delivery...' : 'Record delivery'}
              </button>
            </div>
          </div>
        </form>
      )}
      {activeTab === 'approvals' && (
        <div className="flex flex-col gap-6">
          <div style={{ overflowX: 'auto' }}>
            <h2 style={{ margin: '0 0 10px', fontSize: 16, fontWeight: 700, color: 'var(--color-text-primary)' }}>Supplier deliveries</h2>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                  {['Date', 'Branch', 'Supplier', 'Reference', 'Items', 'Total units', 'Status', 'Action'].map((heading) => (
                    <th key={heading} style={{ padding: 12, textAlign: 'left', color: 'var(--color-text-muted)', fontSize: 12 }}>
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredDeliveries.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ padding: 20, textAlign: 'center', color: 'var(--color-text-muted)' }}>
                      No supplier deliveries found yet.
                    </td>
                  </tr>
                ) : (
                  filteredDeliveries.map((delivery, index) => (
                    <tr key={delivery.id} style={{ backgroundColor: index % 2 === 0 ? 'var(--color-background)' : 'var(--color-surface)' }}>
                      <td style={{ padding: 12, color: 'var(--color-text-primary)' }}>{formatDateTime(delivery.recorded_at)}</td>
                      <td style={{ padding: 12, color: 'var(--color-text-primary)' }}>{delivery.branch_name}</td>
                      <td style={{ padding: 12, color: 'var(--color-text-primary)', fontWeight: 600 }}>{delivery.supplier_name}</td>
                      <td style={{ padding: 12, color: 'var(--color-text-muted)' }}>{delivery.reference_code ?? '-'}</td>
                      <td style={{ padding: 12, color: 'var(--color-text-primary)', textAlign: 'center' }}>{delivery.item_count}</td>
                      <td style={{ padding: 12, color: 'var(--color-text-primary)', textAlign: 'center', fontWeight: 700 }}>{delivery.total_expected}</td>
                      <td style={{ padding: 12 }}>
                        <Badge variant={delivery.status === 'received' ? 'success' : delivery.status === 'approved' ? 'warning' : 'muted'}>
                          {delivery.status === 'received'
                            ? 'Received'
                            : delivery.status === 'approved'
                              ? 'Awaiting arrival'
                              : delivery.status === 'pending_approval'
                                ? 'Pending owner approval'
                                : delivery.status}
                        </Badge>
                      </td>
                      <td style={{ padding: 12 }}>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            className="btn-outline"
                            onClick={() => openDeliveryEditModal(delivery)}
                            style={{ padding: '5px 12px', borderRadius: 8, fontSize: 12 }}
                          >
                            Edit delivery
                          </button>
                          <StockDeliveryActions delivery={delivery} />
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <h2 style={{ margin: '0 0 10px', fontSize: 16, fontWeight: 700, color: 'var(--color-text-primary)' }}>Delivery edit requests</h2>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                  {['Date', 'Supplier', 'Branch', 'Reference', 'Requested by', 'Reason', 'Action'].map((heading) => (
                    <th key={heading} style={{ padding: 12, textAlign: 'left', color: 'var(--color-text-muted)', fontSize: 12 }}>
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredDeliveryEditRequests.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ padding: 20, textAlign: 'center', color: 'var(--color-text-muted)' }}>
                      No delivery edit requests are waiting for owner approval.
                    </td>
                  </tr>
                ) : (
                  filteredDeliveryEditRequests.map((request, index) => (
                    <tr key={request.id} style={{ backgroundColor: index % 2 === 0 ? 'var(--color-background)' : 'var(--color-surface)' }}>
                      <td style={{ padding: 12, color: 'var(--color-text-primary)' }}>{formatDateTime(request.requested_at)}</td>
                      <td style={{ padding: 12, color: 'var(--color-text-primary)', fontWeight: 600 }}>{request.supplier_name}</td>
                      <td style={{ padding: 12, color: 'var(--color-text-primary)' }}>{request.branch_name}</td>
                      <td style={{ padding: 12, color: 'var(--color-text-muted)' }}>{request.reference_code ?? '-'}</td>
                      <td style={{ padding: 12, color: 'var(--color-text-muted)' }}>{request.requested_by_name}</td>
                      <td style={{ padding: 12, color: 'var(--color-text-muted)' }}>{request.reason ?? '-'}</td>
                      <td style={{ padding: 12 }}>
                        {role === 'owner' ? (
                          <DeliveryEditRequestActions request={request} />
                        ) : (
                          <Badge variant="warning">Pending owner approval</Badge>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'history' && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                {['Date', 'Type', 'Product', 'Branch', 'Qty', 'Actor', 'Reference'].map((heading) => (
                  <th key={heading} style={{ padding: 12, textAlign: 'left', color: 'var(--color-text-muted)', fontSize: 12 }}>
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredMovements.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: 20, textAlign: 'center', color: 'var(--color-text-muted)' }}>
                    No movement history found.
                  </td>
                </tr>
              ) : (
                filteredMovements.map((movement, index) => (
                  <tr key={movement.movement_id} style={{ backgroundColor: index % 2 === 0 ? 'var(--color-background)' : 'var(--color-surface)' }}>
                    <td style={{ padding: 12, color: 'var(--color-text-primary)' }}>{formatDateTime(movement.created_at)}</td>
                    <td style={{ padding: 12, color: 'var(--color-text-primary)' }}>{formatMovementType(movement.movement_type)}</td>
                    <td style={{ padding: 12, color: 'var(--color-text-primary)' }}>{movement.product_name}</td>
                    <td style={{ padding: 12, color: 'var(--color-text-primary)' }}>{movement.branch_name}</td>
                    <td style={{ padding: 12, color: movement.quantity < 0 ? 'var(--color-danger)' : 'var(--color-success)', fontWeight: 700 }}>
                      {movement.quantity > 0 ? `+${movement.quantity}` : movement.quantity}
                    </td>
                    <td style={{ padding: 12, color: 'var(--color-text-muted)' }}>{movement.actor_name ?? '-'}</td>
                    <td style={{ padding: 12, color: 'var(--color-text-muted)' }}>{movement.reference_label ?? '-'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      <Modal isOpen={deliveryEditOpen} title={role === 'owner' ? 'Edit supplier delivery' : 'Request delivery edit'} onClose={() => setDeliveryEditOpen(false)}>
        <form onSubmit={onDeliveryEditSubmit}>
          <div className="flex flex-col gap-4">
            <div>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: 'var(--color-text-primary)' }}>
                {editingDelivery?.branch_name ?? 'Branch delivery'}
              </p>
              <p style={{ marginTop: 4, fontSize: 12, color: 'var(--color-text-muted)' }}>
                Edit the delivery record that stock came from. Received deliveries will adjust branch stock by the quantity difference.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label style={{ fontSize: 13 }}>
                <span style={{ display: 'block', marginBottom: 6, fontWeight: 500, color: 'var(--color-text-primary)' }}>Supplier</span>
                <input value={editSupplierName} onChange={(event) => setEditSupplierName(event.target.value)} required style={inputStyle} />
              </label>
              <label style={{ fontSize: 13 }}>
                <span style={{ display: 'block', marginBottom: 6, fontWeight: 500, color: 'var(--color-text-primary)' }}>Reference</span>
                <input value={editReferenceCode} onChange={(event) => setEditReferenceCode(event.target.value)} style={inputStyle} />
              </label>
            </div>

            <div className="flex flex-col gap-4">
              {editDeliveryItems.map((item, index) => {
                const selectedProduct = products.find((product) => product.id === item.productId) ?? null
                const receivingUoms = (selectedProduct?.uom_options ?? []).filter((uom) => uom.is_purchase_uom)
                const selectedUom = selectedProduct?.uom_options.find((uom) => uom.id === item.uomId) ?? getDefaultProductUOM(selectedProduct)
                const baseUom = getProductBaseUOM(selectedProduct)
                const quantity = Number(item.quantity)
                const totalLineCost = item.costs.reduce((sum, cost) => {
                  const amount = Number(cost.amount)
                  return Number.isFinite(amount) && amount > 0 ? sum + amount : sum
                }, 0)
                const baseQuantity = selectedUom && Number.isFinite(quantity) && quantity > 0
                  ? quantity * selectedUom.conversion_factor
                  : 0
                const basePreview = selectedUom && baseUom && Number.isFinite(quantity) && quantity > 0
                  ? `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).format(quantity)} ${selectedUom.name} = ${new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).format(quantity * selectedUom.conversion_factor)} ${baseUom.name}`
                  : null
                const costPreview = selectedUom && baseUom && Number.isFinite(quantity) && quantity > 0 && baseQuantity > 0 && totalLineCost > 0
                  ? `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).format(totalLineCost / quantity)} per ${selectedUom.name}; ${new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).format(totalLineCost / baseQuantity)} per ${baseUom.name}`
                  : null

                return (
                  <div
                    key={item.id}
                    className="flex flex-col gap-4 rounded-xl"
                    style={{
                      border: '1px solid var(--color-border)',
                      backgroundColor: 'var(--color-background)',
                      padding: 14,
                    }}
                  >
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <span style={{ display: 'block', fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 600 }}>
                          Item {index + 1}
                        </span>
                        <p style={{ margin: 0, color: 'var(--color-text-primary)', fontWeight: 700, fontSize: 14 }}>
                          {selectedProduct?.name ?? 'Unknown product'}
                        </p>
                      </div>
                      {selectedProduct?.sku && (
                        <span style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>
                          SKU: {selectedProduct.sku}
                        </span>
                      )}
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <label style={{ fontSize: 13 }}>
                        <span style={{ display: 'block', marginBottom: 6, fontWeight: 500, color: 'var(--color-text-primary)' }}>Received as</span>
                        <select value={item.uomId} onChange={(event) => updateEditDeliveryItem(item.id, { uomId: event.target.value })} required style={inputStyle}>
                          <option value="">Select stock unit</option>
                          {receivingUoms.map((uom) => (
                            <option key={uom.id} value={uom.id}>
                              {uom.name}{baseUom ? ` (${uom.conversion_factor} ${baseUom.name})` : ''}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label style={{ fontSize: 13 }}>
                        <span style={{ display: 'block', marginBottom: 6, fontWeight: 500, color: 'var(--color-text-primary)' }}>Quantity</span>
                        <input type="number" min={0.0001} step="0.0001" value={item.quantity} onChange={(event) => updateEditDeliveryItem(item.id, { quantity: event.target.value })} required style={inputStyle} />
                      </label>
                    </div>

                    {basePreview && (
                      <div
                        style={{
                          border: '1px solid var(--color-border)',
                          borderRadius: 10,
                          padding: '8px 10px',
                          color: 'var(--color-text-muted)',
                          fontSize: 12,
                          backgroundColor: 'var(--color-surface)',
                        }}
                      >
                        Stock value: {basePreview}
                      </div>
                    )}

                    <div className="flex flex-col gap-2" style={{ fontSize: 13 }}>
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <span style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>Costs / expenses</span>
                        <button type="button" className="btn-outline" onClick={() => addEditDeliveryCost(item.id)} style={{ minHeight: 36, padding: '0 12px', borderRadius: 8 }}>
                          {item.costs.length > 0 ? 'Add another cost' : 'Add cost/expense'}
                        </button>
                      </div>

                      {item.costs.length > 0 && (
                        <div className="flex flex-col gap-2">
                          {item.costs.map((cost) => (
                            <div
                              key={cost.id}
                              className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_140px_auto]"
                              style={{ alignItems: 'center' }}
                            >
                              <input
                                value={cost.description}
                                onChange={(event) => updateEditDeliveryCost(item.id, cost.id, { description: event.target.value })}
                                placeholder="Describe cost, e.g. Transport"
                                style={{ ...inputStyle, height: 40 }}
                              />
                              <input
                                type="number"
                                min={0}
                                step="0.01"
                                value={cost.amount}
                                onChange={(event) => updateEditDeliveryCost(item.id, cost.id, { amount: event.target.value })}
                                placeholder="Amount"
                                style={{ ...inputStyle, height: 40 }}
                              />
                              <button
                                type="button"
                                className="btn-outline"
                                onClick={() => removeEditDeliveryCost(item.id, cost.id)}
                                style={{ height: 40, padding: '0 12px', borderRadius: 8 }}
                              >
                                Remove
                              </button>
                            </div>
                          ))}
                        </div>
                      )}

                      <div className="flex flex-col gap-1" style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>
                        <span>Total cost for this line: {new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(totalLineCost)}</span>
                        {costPreview && <span>Cost basis: {costPreview}</span>}
                      </div>
                    </div>

                    <label style={{ fontSize: 13 }}>
                      <span style={{ display: 'block', marginBottom: 6, fontWeight: 500, color: 'var(--color-text-primary)' }}>Notes</span>
                      <textarea
                        value={item.notes}
                        onChange={(event) => updateEditDeliveryItem(item.id, { notes: event.target.value })}
                        rows={2}
                        style={{
                          ...inputStyle,
                          minHeight: 72,
                          height: 'auto',
                          paddingTop: 10,
                          resize: 'vertical',
                        }}
                      />
                    </label>
                  </div>
                )
              })}
            </div>

            <label style={{ fontSize: 13 }}>
              <span style={{ display: 'block', marginBottom: 6, fontWeight: 500, color: 'var(--color-text-primary)' }}>
                Reason {role === 'admin' ? '(sent to owner)' : '(audit note)'}
              </span>
              <input value={editReason} onChange={(event) => setEditReason(event.target.value)} style={inputStyle} />
            </label>

            {role === 'admin' && (
              <p style={{ margin: 0, fontSize: 12, color: 'var(--color-text-muted)' }}>
                Admin edits will not change the delivery or stock until the owner approves them.
              </p>
            )}

            {deliveryEditState.error && <p style={{ fontSize: 13, color: 'var(--color-danger)', margin: 0 }}>{deliveryEditState.error}</p>}

            <div style={{ display: 'flex', gap: 10 }}>
              <button type="submit" disabled={deliveryEditPending} className="btn-primary" style={{ flex: 1, padding: '10px 20px', borderRadius: 8 }}>
                {deliveryEditPending ? 'Submitting...' : role === 'owner' ? 'Update delivery' : 'Send for approval'}
              </button>
              <button type="button" onClick={() => setDeliveryEditOpen(false)} className="btn-outline" style={{ flex: 1, padding: '10px 20px', borderRadius: 8 }}>
                Cancel
              </button>
            </div>
          </div>
        </form>
      </Modal>

      <Modal isOpen={thresholdOpen} title="Update low-stock threshold" onClose={() => setThresholdOpen(false)}>
        <form onSubmit={onThresholdSubmit}>
          <div className="flex flex-col gap-4">
            <div>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)' }}>{selectedStock?.products?.[0]?.name ?? 'Product'}</p>
              <p style={{ marginTop: 4, fontSize: 12, color: 'var(--color-text-muted)' }}>{selectedStock?.branches?.[0]?.name ?? 'Branch'}</p>
            </div>
            <label style={{ fontSize: 13 }}>
              <span style={{ display: 'block', marginBottom: 6, fontWeight: 500, color: 'var(--color-text-primary)' }}>Threshold</span>
              <input type="number" min={0} value={threshold} onChange={(event) => setThreshold(event.target.value)} required style={inputStyle} />
              {selectedStock && (() => {
                const receivingUom = getDefaultReceivingUOM(selectedStock)
                const baseUom = getBaseUOM(selectedStock)
                const thresholdValue = Number(threshold)
                const baseThreshold = Number.isFinite(thresholdValue) ? thresholdValue * (receivingUom?.conversion_factor ?? 1) : 0

                if (!receivingUom || !baseUom || !Number.isFinite(thresholdValue)) {
                  return null
                }

                return (
                  <span style={{ display: 'block', marginTop: 6, color: 'var(--color-text-muted)', fontSize: 12 }}>
                    Alert when stock is at or below {thresholdValue.toLocaleString(undefined, { maximumFractionDigits: 4 })} {receivingUom.name}
                    {receivingUom.conversion_factor !== 1 ? ` (${baseThreshold.toLocaleString(undefined, { maximumFractionDigits: 4 })} ${baseUom.name})` : ''}.
                  </span>
                )
              })()}
            </label>
            {thresholdState.error && <p style={{ fontSize: 13, color: 'var(--color-danger)', margin: 0 }}>{thresholdState.error}</p>}
            <div style={{ display: 'flex', gap: 10 }}>
              <button type="submit" disabled={thresholdPending} className="btn-primary" style={{ flex: 1, padding: '10px 20px', borderRadius: 8 }}>
                {thresholdPending ? 'Updating...' : 'Update threshold'}
              </button>
              <button type="button" onClick={() => setThresholdOpen(false)} className="btn-outline" style={{ flex: 1, padding: '10px 20px', borderRadius: 8 }}>
                Cancel
              </button>
            </div>
          </div>
        </form>
      </Modal>
    </>
  )
}
