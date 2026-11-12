'use client'
/**
 * Client-side Products page wrapper.
 *
 * Handles search, product filtering, and rendering of product actions.
 */

import { Fragment, startTransition, useEffect, useMemo, useRef, useState } from 'react'
import { useActionState } from 'react'
import { useRouter } from 'next/navigation'
import { Card } from '../../../../components/ui/Card'
import { Badge } from '../../../../components/ui/Badge'
import { MetricCard } from '../../../../components/dashboard/MetricCard'
import SpreadsheetTools from '../../../../components/dashboard/SpreadsheetTools'
import LoadingOverlay from '../../../../components/ui/LoadingOverlay'
import Toast from '../../../../components/ui/Toast'
import { useToast } from '../../../../lib/hooks/useToast'
import AddProductForm from './AddProductForm'
import ProductRowActions from './ProductRowActions'
import EditProductModal from './EditProductModal'
import { importProducts } from './actions'
import { deleteUnusedUOMAction, updateUOMAction, type FormState as UOMFormState } from './uom-actions'
import type { UnitOfMeasure } from '../../../../lib/uom/server'

type ProductPricing = {
  base_price: string
  min_price: string
  max_price: string
}

type ProductPricePoint = {
  quantity_in_uom: string | number
  base_quantity?: string | number
  uom_id?: string | null
  max_discount_amount?: string | number
  price: string | number
}

type ProductPricingModel = {
  id: string
  branch_id: string | null
  pricing_method: 'fixed_price' | 'assisted_pack' | 'manual_quantity'
  rounding_rule: 'none' | 'nearest_5' | 'up_5' | 'down_5' | 'nearest_10'
  status: string
  product_price_points?: ProductPricePoint[] | null
}

type ProductUOMLink = {
  id: string
  uom_id: string
  is_purchase_uom: boolean
  is_sale_uom: boolean
  is_base_uom: boolean
  is_default_purchase_uom: boolean
  is_default_sale_uom: boolean
}

type Product = {
  id: string
  name: string
  sku: string
  category: string
  subcategory?: string | null
  brand_family?: string | null
  product_kind?: 'fixed_package' | 'measured_counted'
  unit: string
  description: string | null
  tracks_expiry?: boolean
  barcodes?: string[]
  is_active: boolean
  created_at: string
  product_pricing?: ProductPricing[] | null
  product_pricing_models?: ProductPricingModel[] | null
  product_uom_links?: ProductUOMLink[] | null
}

type ProductStockBreakdown = {
  productId: string
  branchId: string
  branchName: string
  quantityOnHand: number
  quantityReserved: number
  lowStockThreshold: number
}

type Props = {
  products: Product[]
  currency: string
  uoms?: UnitOfMeasure[]
  allUoms?: UnitOfMeasure[]
  branches?: Array<{ id: string; name: string }>
  readOnly?: boolean
  exportHref?: string
  productStocks?: ProductStockBreakdown[]
  assignedBranchCount?: number
  metrics: {
    totalProducts: number
    activeProducts: number
    categoriesCount: number
    averageBasePrice: number
  }
}

/**
 * Deduplicates units by id before rendering library cards.
 */
function dedupeUoms(uoms: UnitOfMeasure[]): UnitOfMeasure[] {
  const seen = new Set<string>()
  const unique: UnitOfMeasure[] = []

  uoms.forEach((uom) => {
    if (seen.has(uom.id)) {
      return
    }

    seen.add(uom.id)
    unique.push(uom)
  })

  return unique.sort((first, second) => {
    if (first.isActive !== second.isActive) return first.isActive ? -1 : 1
    return first.conversionFactor - second.conversionFactor || first.name.localeCompare(second.name)
  })
}

/**
 * Extracts deleted UOM id from action state payloads.
 */
function readUOMId(data: unknown): string | null {
  if (typeof data !== 'object' || data === null || !('uomId' in data)) return null
  const value = (data as { uomId?: unknown }).uomId
  return typeof value === 'string' ? value : null
}

type UOMEditDraft = {
  name: string
  abbreviation: string
  conversionFactor: string
  isBaseUnit: boolean
}

type ProductUOMSummary = {
  key: string
  label: string
  title: string
  variant: 'muted' | 'success' | 'warning'
}

const PRODUCTS_PAGE_SIZE = 50

/**
 * Visible unit library for permanent cleanup of unused units.
 */
function UnitLibrary({ uoms }: { uoms: UnitOfMeasure[] }) {
  const router = useRouter()
  const [visibleUoms, setVisibleUoms] = useState<UnitOfMeasure[]>(() => dedupeUoms(uoms))
  const [editingUnitId, setEditingUnitId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<UOMEditDraft | null>(null)
  const [deleteState, deleteAction, deletePending] = useActionState<UOMFormState, FormData>(deleteUnusedUOMAction, { success: false, error: null })
  const [updateState, updateActionHandler, updatePending] = useActionState<UOMFormState, FormData>(updateUOMAction, { success: false, error: null })
  const previousDeletePending = useRef(deletePending)
  const previousUpdatePending = useRef(updatePending)
  const { toast, toastState, dismiss } = useToast()

  useEffect(() => {
    const syncTimer = setTimeout(() => {
      setVisibleUoms(dedupeUoms(uoms))
    }, 0)

    return () => clearTimeout(syncTimer)
  }, [uoms])

  useEffect(() => {
    let refreshTimer: ReturnType<typeof setTimeout> | null = null

    if (previousDeletePending.current && !deletePending) {
      if (deleteState.success) {
        const deletedUomId = readUOMId(deleteState.data)
        toast.success('Unit permanently deleted')
        refreshTimer = setTimeout(() => {
          if (deletedUomId) {
            setVisibleUoms((current) => current.filter((uom) => uom.id !== deletedUomId))
          }
          router.refresh()
        }, 0)
      } else if (deleteState.error) {
        toast.error(deleteState.error)
      }
    }

    previousDeletePending.current = deletePending
    return () => {
      if (refreshTimer) clearTimeout(refreshTimer)
    }
  }, [deletePending, deleteState.data, deleteState.error, deleteState.success, router, toast])

  useEffect(() => {
    let refreshTimer: ReturnType<typeof setTimeout> | null = null

    if (previousUpdatePending.current && !updatePending) {
      if (updateState.success) {
        toast.success('Unit updated')
        setEditingUnitId(null)
        setEditDraft(null)
        refreshTimer = setTimeout(() => router.refresh(), 0)
      } else if (updateState.error) {
        toast.error(updateState.error)
      }
    }

    previousUpdatePending.current = updatePending
    return () => {
      if (refreshTimer) clearTimeout(refreshTimer)
    }
  }, [router, toast, updatePending, updateState.error, updateState.success])

  const startEdit = (unit: UnitOfMeasure) => {
    setEditingUnitId(unit.id)
    setEditDraft({
      name: unit.name,
      abbreviation: unit.abbreviation,
      conversionFactor: String(unit.conversionFactor),
      isBaseUnit: unit.isBaseUnit,
    })
  }

  const saveEdit = (unit: UnitOfMeasure) => {
    if (!editDraft) return

    const formData = new FormData()
    formData.set('uomId', unit.id)
    formData.set('name', editDraft.name)
    formData.set('abbreviation', editDraft.abbreviation)
    formData.set('conversionFactor', editDraft.conversionFactor)
    if (editDraft.isBaseUnit) {
      formData.set('isBaseUnit', 'on')
    }

    startTransition(() => {
      updateActionHandler(formData)
    })
  }

  const deleteUnit = (unit: UnitOfMeasure) => {
    const confirmed = window.confirm(
      `Permanently delete ${unit.name}? This only succeeds if the unit is not linked to products, sales, or deliveries.`
    )

    if (!confirmed) return

    const formData = new FormData()
    formData.set('uomId', unit.id)

    startTransition(() => {
      deleteAction(formData)
    })
  }

  const busy = deletePending || updatePending

  return (
    <Card padding="md">
      {busy && <LoadingOverlay message={updatePending ? 'Updating unit...' : 'Deleting unit...'} />}
      {toastState && <Toast message={toastState.message} type={toastState.type} onDismiss={dismiss} duration={toastState.duration} />}
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--color-text-primary)' }}>Units & packs</h2>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--color-text-muted)' }}>
              Review all units you have added. Permanent delete is allowed only for unused units.
            </p>
          </div>
          <Badge variant="muted">{visibleUoms.length} total</Badge>
        </div>

        {visibleUoms.length === 0 ? (
          <div style={{ border: '1px dashed var(--color-border)', borderRadius: 10, padding: 18, color: 'var(--color-text-muted)', fontSize: 13 }}>
            No units have been created yet.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {visibleUoms.map((unit) => {
              const isEditing = editingUnitId === unit.id && editDraft

              return (
                <div
                  key={`unit-library-${unit.id}`}
                  style={{
                    border: '1px solid var(--color-border)',
                    borderRadius: 12,
                    padding: 14,
                    backgroundColor: 'var(--color-background)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 12,
                  }}
                >
                  <div className="flex items-start justify-between gap-3">
                    {isEditing ? (
                      <div className="flex flex-col gap-2" style={{ flex: 1 }}>
                        <input
                          value={editDraft.name}
                          onChange={(event) => setEditDraft((current) => current ? { ...current, name: event.target.value } : current)}
                          placeholder="Unit name"
                          style={{ height: 38, borderRadius: 8, border: '1px solid var(--color-border)', padding: '0 10px', backgroundColor: 'var(--color-background)', color: 'var(--color-text-primary)' }}
                        />
                        <input
                          value={editDraft.abbreviation}
                          onChange={(event) => setEditDraft((current) => current ? { ...current, abbreviation: event.target.value } : current)}
                          placeholder="Abbreviation"
                          style={{ height: 38, borderRadius: 8, border: '1px solid var(--color-border)', padding: '0 10px', backgroundColor: 'var(--color-background)', color: 'var(--color-text-primary)' }}
                        />
                      </div>
                    ) : (
                      <div>
                        <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: 'var(--color-text-primary)' }}>{unit.name}</p>
                        <p style={{ margin: '3px 0 0', fontSize: 12, color: 'var(--color-text-muted)' }}>{unit.abbreviation}</p>
                      </div>
                    )}
                    <Badge variant={unit.isActive ? 'success' : 'muted'}>{unit.isActive ? 'Active' : 'Inactive'}</Badge>
                  </div>
                  {isEditing ? (
                    <>
                      <label className="flex flex-col gap-2" style={{ fontSize: 12, color: 'var(--color-text-primary)' }}>
                        Conversion factor
                        <input
                          type="number"
                          min="0.0001"
                          step="0.0001"
                          value={editDraft.conversionFactor}
                          onChange={(event) => setEditDraft((current) => current ? { ...current, conversionFactor: event.target.value } : current)}
                          style={{ height: 38, borderRadius: 8, border: '1px solid var(--color-border)', padding: '0 10px', backgroundColor: 'var(--color-background)', color: 'var(--color-text-primary)' }}
                        />
                      </label>
                      <label className="flex items-center gap-2" style={{ fontSize: 12, color: 'var(--color-text-primary)' }}>
                        <input
                          type="checkbox"
                          checked={editDraft.isBaseUnit}
                          onChange={(event) => setEditDraft((current) => current ? { ...current, isBaseUnit: event.target.checked } : current)}
                        />
                        Business base unit
                      </label>
                    </>
                  ) : (
                    <>
                      <div style={{ fontSize: 13, color: 'var(--color-text-primary)' }}>
                        1 {unit.name} = <strong>{unit.conversionFactor}</strong> base unit{unit.conversionFactor === 1 ? '' : 's'}
                      </div>
                      {unit.isBaseUnit && <Badge variant="warning">Business base unit</Badge>}
                    </>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {isEditing ? (
                      <>
                        <button
                          type="button"
                          className="btn-primary"
                          disabled={busy}
                          onClick={() => saveEdit(unit)}
                          style={{ padding: '8px 12px', borderRadius: 8, fontSize: 12 }}
                        >
                          Save unit
                        </button>
                        <button
                          type="button"
                          className="btn-outline"
                          disabled={busy}
                          onClick={() => {
                            setEditingUnitId(null)
                            setEditDraft(null)
                          }}
                          style={{ padding: '8px 12px', borderRadius: 8, fontSize: 12 }}
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="btn-outline"
                        disabled={busy}
                        onClick={() => startEdit(unit)}
                        style={{ padding: '8px 12px', borderRadius: 8, fontSize: 12 }}
                      >
                        Edit
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn-outline"
                      disabled={busy}
                      onClick={() => deleteUnit(unit)}
                      style={{ padding: '8px 12px', borderRadius: 8, fontSize: 12 }}
                    >
                      Delete permanently
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </Card>
  )
}

/**
 * Resolves the badge style for a branch stock value.
 */
function getStockBadgeVariant(stock: ProductStockBreakdown): 'success' | 'warning' | 'danger' {
  if (stock.quantityOnHand <= 0) {
    return 'danger'
  }

  if (stock.quantityOnHand <= stock.lowStockThreshold) {
    return 'warning'
  }

  return 'success'
}

/**
 * Builds compact labels for the UOMs currently linked to a product.
 */
function getProductUOMSummaries(product: Product, unitById: Map<string, UnitOfMeasure>): ProductUOMSummary[] {
  const links = product.product_uom_links ?? []

  if (links.length === 0) {
    return [{
      key: `${product.id}-legacy-unit`,
      label: product.unit || 'No UOM',
      title: 'Legacy/base unit',
      variant: 'muted',
    }]
  }

  return links
    .slice()
    .sort((first, second) => {
      if (first.is_base_uom !== second.is_base_uom) return first.is_base_uom ? -1 : 1
      if (first.is_default_sale_uom !== second.is_default_sale_uom) return first.is_default_sale_uom ? -1 : 1
      if (first.is_default_purchase_uom !== second.is_default_purchase_uom) return first.is_default_purchase_uom ? -1 : 1
      const firstUnit = unitById.get(first.uom_id)
      const secondUnit = unitById.get(second.uom_id)
      return (firstUnit?.conversionFactor ?? 1) - (secondUnit?.conversionFactor ?? 1)
    })
    .map((link) => {
      const unit = unitById.get(link.uom_id)
      const flags = [
        link.is_base_uom ? 'base' : null,
        link.is_purchase_uom ? 'buy' : null,
        link.is_sale_uom ? 'sell' : null,
        link.is_default_purchase_uom ? 'default buy' : null,
        link.is_default_sale_uom ? 'default sell' : null,
      ].filter((flag): flag is string => Boolean(flag))

      return {
        key: `${product.id}-${link.id}`,
        label: `${unit?.name ?? 'Unknown unit'}${unit ? ` (${unit.conversionFactor} base)` : ''}`,
        title: flags.join(', ') || 'Linked unit',
        variant: link.is_base_uom ? 'warning' : link.is_sale_uom ? 'success' : 'muted',
      }
    })
}

/**
 * Returns only the first few UOM labels for the compact table cell.
 */
function getCompactProductUOMSummaries(product: Product, unitById: Map<string, UnitOfMeasure>, limit = 3): ProductUOMSummary[] {
  return getProductUOMSummaries(product, unitById).slice(0, limit)
}

/**
 * Converts product kind into a short catalog label.
 */
function getProductKindLabel(kind: Product['product_kind']): string {
  return kind === 'measured_counted' ? 'Measured/countable' : 'Fixed item'
}

/**
 * Detects the hidden model used for direct prices on extra sale UOMs.
 */
function isFixedPriceWithUOMPrices(model: ProductPricingModel): boolean {
  const points = model.product_price_points ?? []

  return model.pricing_method === 'assisted_pack' &&
    model.rounding_rule === 'none' &&
    points.length > 0 &&
    points.every((point) => Number(point.quantity_in_uom) === 1)
}

/**
 * Builds only the pricing labels that apply to the product.
 */
function getProductPricingLabels(product: Product): Array<{ key: string; label: string; variant: 'muted' | 'success' | 'warning' }> {
  const labels: Array<{ key: string; label: string; variant: 'muted' | 'success' | 'warning' }> = []
  const hasFixedPrice = Boolean(product.product_pricing?.[0])
  const activeModels = getActivePricingModels(product)

  if (hasFixedPrice) {
    labels.push({ key: `${product.id}-fixed`, label: 'Fixed price', variant: 'muted' })
  }

  activeModels.forEach((model) => {
    if (isFixedPriceWithUOMPrices(model)) {
      labels.push({ key: `${product.id}-${model.id}-uom`, label: 'UOM prices', variant: 'success' })
      return
    }

    if (model.pricing_method === 'fixed_price' && hasFixedPrice) {
      return
    }

    labels.push({
      key: `${product.id}-${model.id}`,
      label: getPricingMethodLabel(model.pricing_method),
      variant: model.pricing_method === 'fixed_price' ? 'muted' : 'success',
    })
  })

  return labels.length > 0 ? labels : [{ key: `${product.id}-unpriced`, label: 'No price', variant: 'warning' }]
}

/**
 * Formats currency values consistently in the product catalog.
 */
function formatMoney(amount: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)
}

/**
 * Finds the primary active pricing model shown in compact catalog columns.
 */
function getPrimaryPricingModel(product: Product): ProductPricingModel | null {
  const activeModels = getActivePricingModels(product)

  return activeModels.find((model) => model.branch_id === null) ?? activeModels[0] ?? null
}

/**
 * Returns active pricing models in a stable display order.
 */
function getActivePricingModels(product: Product): ProductPricingModel[] {
  return (product.product_pricing_models ?? [])
    .filter((model) => model.status === 'approved' || model.status === 'pending_approval')
    .sort((first, second) => {
      if (first.branch_id === null && second.branch_id !== null) return -1
      if (first.branch_id !== null && second.branch_id === null) return 1
      return getPricingMethodLabel(first.pricing_method).localeCompare(getPricingMethodLabel(second.pricing_method))
    })
}

/**
 * Converts pricing method codes into owner/admin friendly labels.
 */
function getPricingMethodLabel(method: ProductPricingModel['pricing_method'] | undefined): string {
  if (method === 'assisted_pack') return 'System assisted'
  if (method === 'manual_quantity') return 'Manual quantity'
  return 'Fixed price'
}

/**
 * Explains whether pricing applies globally or to selected branches.
 */
function getPricingScopeLabel(product: Product, branches: Array<{ id: string; name: string }>): string {
  const activeModels = getActivePricingModels(product)

  if (activeModels.length === 0 || activeModels.some((model) => model.branch_id === null)) {
    return 'All branches'
  }

  const branchNames = activeModels
    .map((model) => branches.find((branch) => branch.id === model.branch_id)?.name)
    .filter((name): name is string => typeof name === 'string' && name.length > 0)

  if (branchNames.length === 0) {
    return `${activeModels.length} selected branch${activeModels.length === 1 ? '' : 'es'}`
  }

  return branchNames.length <= 2 ? branchNames.join(', ') : `${branchNames.slice(0, 2).join(', ')} +${branchNames.length - 2}`
}

/**
 * Formats the scope for a single pricing model.
 */
function getSinglePricingScopeLabel(model: ProductPricingModel, branches: Array<{ id: string; name: string }>): string {
  if (!model.branch_id) return 'All branches'
  return branches.find((branch) => branch.id === model.branch_id)?.name ?? 'Selected branch'
}

/**
 * Formats pack/manual price points for display in the catalog table.
 */
function formatPricePoints(model: ProductPricingModel | null, currency: string): string {
  const points = model?.product_price_points ?? []

  if (model?.pricing_method === 'fixed_price' || points.length === 0) {
    return '-'
  }

  return points
    .slice(0, 3)
    .map((point) => `${Number(point.quantity_in_uom)} = ${formatMoney(Number(point.price), currency)}`)
    .join(', ')
}

/**
 * Formats every available pricing option for a product.
 */
function formatPricingOptions(product: Product, currency: string, branches: Array<{ id: string; name: string }>, unitById: Map<string, UnitOfMeasure>): string {
  const options: string[] = []
  const fixedPricing = product.product_pricing?.[0]

  if (fixedPricing) {
    options.push(`Fixed/base: ${formatMoney(Number(fixedPricing.base_price), currency)}`)
  }

  getActivePricingModels(product).forEach((model) => {
    if (model.pricing_method === 'fixed_price') {
      return
    }

    const points = (model.product_price_points ?? [])
      .slice()
      .sort((first, second) => Number(first.base_quantity ?? first.quantity_in_uom) - Number(second.base_quantity ?? second.quantity_in_uom))

    if (points.length === 0) {
      options.push(`${getPricingMethodLabel(model.pricing_method)} (${getSinglePricingScopeLabel(model, branches)}): no prices`)
      return
    }

    const formattedPoints = points
      .slice(0, 5)
      .map((point) => {
        const baseQuantity = Number(point.base_quantity ?? point.quantity_in_uom)
        const displayQuantity = Number(point.quantity_in_uom)
        const pointUnit = point.uom_id ? unitById.get(point.uom_id) : null
        const unitLabel = pointUnit?.name ?? 'unit'
        const quantityLabel = baseQuantity === displayQuantity
          ? `${displayQuantity} ${unitLabel}`
          : `${displayQuantity} ${unitLabel} (${baseQuantity} base)`
        const discountAmount = Number(point.max_discount_amount ?? 0)
        const discountLabel = discountAmount > 0 ? `, max discount ${formatMoney(discountAmount, currency)}` : ''
        return `${quantityLabel} = ${formatMoney(Number(point.price), currency)}${discountLabel}`
      })
      .join(', ')

    options.push(`${getPricingMethodLabel(model.pricing_method)} (${getSinglePricingScopeLabel(model, branches)}): ${formattedPoints}`)
  })

  return options.length > 0 ? options.join(' | ') : '-'
}

/**
 * Product catalog client used by owner and admin dashboards.
 */
export default function ProductsPageClient({
  products,
  currency,
  uoms = [],
  allUoms = uoms,
  branches = [],
  readOnly = false,
  exportHref: exportHrefProp,
  productStocks = [],
  assignedBranchCount = 0,
  metrics,
}: Props) {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<'all' | 'active' | 'inactive'>('all')
  const [category, setCategory] = useState('all')
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [isEditOpen, setIsEditOpen] = useState(false)
  const [expandedProductIds, setExpandedProductIds] = useState<Set<string>>(() => new Set())
  const [visibleProductCount, setVisibleProductCount] = useState(PRODUCTS_PAGE_SIZE)
  const showStockBreakdown = readOnly

  const unitById = useMemo(() => {
    return new Map(allUoms.map((unit) => [unit.id, unit]))
  }, [allUoms])

  const categories = useMemo(() => {
    return Array.from(new Set(products.map((product) => product.category))).sort((a, b) => a.localeCompare(b))
  }, [products])

  const stocksByProduct = useMemo(() => {
    const groupedStocks = new Map<string, ProductStockBreakdown[]>()

    productStocks.forEach((stock) => {
      const currentStocks = groupedStocks.get(stock.productId) ?? []
      groupedStocks.set(stock.productId, [...currentStocks, stock])
    })

    return groupedStocks
  }, [productStocks])

  const filteredProducts = useMemo(() => {
    const normalized = search.trim().toLowerCase()

    return products.filter((product) => {
      const matchesSearch = normalized
        ? (
        product.name.toLowerCase().includes(normalized) ||
        product.sku.toLowerCase().includes(normalized)
      )
        : true
      const matchesStatus =
        status === 'all' ? true : status === 'active' ? product.is_active : !product.is_active
      const matchesCategory = category === 'all' ? true : product.category === category

      return matchesSearch && matchesStatus && matchesCategory
    })
  }, [category, products, search, status])

  useEffect(() => {
    setVisibleProductCount(PRODUCTS_PAGE_SIZE)
    setExpandedProductIds(new Set())
  }, [category, search, status])

  const visibleProducts = filteredProducts.slice(0, visibleProductCount)
  const hasMoreProducts = visibleProductCount < filteredProducts.length
  const visibleColumnCount = 9 + (showStockBreakdown ? 1 : 0)

  const exportParams = new URLSearchParams()
  if (search.trim()) exportParams.set('q', search.trim())
  if (status !== 'all') exportParams.set('status', status)
  if (category !== 'all') exportParams.set('category', category)
  const exportHref =
    exportHrefProp ?? `/dashboard/owner/products/export${exportParams.toString() ? `?${exportParams.toString()}` : ''}`

  const openEditModal = (product: Product) => {
    setSelectedProduct(product)
    setIsEditOpen(true)
  }

  const toggleProductDetails = (productId: string) => {
    setExpandedProductIds((current) => {
      const next = new Set(current)

      if (next.has(productId)) {
        next.delete(productId)
      } else {
        next.add(productId)
      }

      return next
    })
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1
            className="font-bold"
            style={{ fontSize: '22px', color: 'var(--color-text-primary)', letterSpacing: '-0.3px' }}
          >
            Products
          </h1>
          <p style={{ fontSize: '14px', color: 'var(--color-text-muted)', marginTop: '4px' }}>
            {readOnly ? 'Review the product catalog and pricing boundaries.' : 'Manage your product catalog and pricing boundaries.'}
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          {!readOnly && (
            <SpreadsheetTools
              entityLabel="Products"
              exportHref={exportHref}
              templateHref="/dashboard/owner/products/template"
              importAction={importProducts}
            />
          )}
          <div style={{ minWidth: '260px' }}>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by name or SKU"
              style={{
                width: '100%',
                height: 44,
                borderRadius: 8,
                border: '1px solid var(--color-border)',
                padding: '0 14px',
                backgroundColor: 'var(--color-background)',
                color: 'var(--color-text-primary)',
              }}
            />
          </div>
          {!readOnly && <AddProductForm currency={currency} uoms={uoms} branches={branches} />}
        </div>
      </div>

      <Card padding="md">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <label className="flex flex-col gap-2" style={{ fontSize: 13, color: 'var(--color-text-primary)' }}>
            Status
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value as 'all' | 'active' | 'inactive')}
              style={{
                height: 44,
                borderRadius: 8,
                border: '1px solid var(--color-border)',
                padding: '0 14px',
                backgroundColor: 'var(--color-background)',
                color: 'var(--color-text-primary)',
              }}
            >
              <option value="all">All statuses</option>
              <option value="active">Active only</option>
              <option value="inactive">Inactive only</option>
            </select>
          </label>
          <label className="flex flex-col gap-2" style={{ fontSize: 13, color: 'var(--color-text-primary)' }}>
            Category
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              style={{
                height: 44,
                borderRadius: 8,
                border: '1px solid var(--color-border)',
                padding: '0 14px',
                backgroundColor: 'var(--color-background)',
                color: 'var(--color-text-primary)',
              }}
            >
              <option value="all">All categories</option>
              {categories.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-end">
            <button
              type="button"
              className="btn-outline"
              style={{ padding: '8px 16px', borderRadius: 8 }}
              onClick={() => {
                setSearch('')
                setStatus('all')
                setCategory('all')
              }}
            >
              Clear filters
            </button>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <MetricCard label="Total products" value={String(metrics.totalProducts)} />
        <MetricCard label="Active products" value={String(metrics.activeProducts)} />
        <MetricCard label="Categories" value={String(metrics.categoriesCount)} />
        {readOnly && <MetricCard label="Assigned branches" value={String(assignedBranchCount)} />}
        <MetricCard
          label="Average base price"
          value={new Intl.NumberFormat(undefined, {
            style: 'currency',
            currency,
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          }).format(metrics.averageBasePrice)}
        />
      </div>

      {!readOnly && <UnitLibrary uoms={allUoms} />}

      {filteredProducts.length === 0 ? (
        <div
          className="flex flex-col items-center justify-center gap-5 rounded-xl border border-dashed"
          style={{ borderColor: 'var(--color-border)', padding: '48px', backgroundColor: 'var(--color-background)' }}
        >
          <div
            className="rounded-2xl"
            style={{ width: '84px', height: '84px', display: 'grid', placeItems: 'center', backgroundColor: 'var(--color-primary-light)', color: 'var(--color-primary)' }}
          >
            <svg width="36" height="36" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M3 9h18" />
              <path d="M6 5h12" />
              <path d="M6 19h12" />
            </svg>
          </div>
          <div className="text-center">
            <h2 style={{ fontSize: '20px', fontWeight: 600, color: 'var(--color-text-primary)', margin: 0 }}>
              No products found
            </h2>
            <p style={{ fontSize: '14px', color: 'var(--color-text-muted)', marginTop: 8 }}>
              {readOnly ? 'Adjust your search to find a product.' : 'Add your first product or adjust your search.'}
            </p>
          </div>
          {!readOnly && <AddProductForm currency={currency} uoms={uoms} branches={branches} />}
        </div>
      ) : (
        <Card>
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between" style={{ padding: '12px 12px 0' }}>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)' }}>
              Showing {visibleProducts.length} of {filteredProducts.length} product{filteredProducts.length === 1 ? '' : 's'}
            </p>
            {hasMoreProducts && (
              <button
                type="button"
                className="btn-outline"
                style={{ padding: '7px 14px', borderRadius: 8, fontSize: 12 }}
                onClick={() => setVisibleProductCount((current) => current + PRODUCTS_PAGE_SIZE)}
              >
                Show more
              </button>
            )}
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderSpacing: 0 }}>
              <thead>
                <tr style={{ textAlign: 'left' }}>
                  {[
                    'Name',
                    'SKU',
                    'Category',
                    'UOMs',
                    'Product type',
                    'Pricing',
                    'Base price',
                    ...(showStockBreakdown ? ['Assigned branch stock'] : []),
                    'Status',
                    readOnly ? 'Details' : 'Actions',
                  ].map((heading) => (
                    <th key={heading} style={{ padding: '12px', fontSize: '12px', color: 'var(--color-text-muted)' }}>
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleProducts.map((product, index) => {
                  const pricing = product.product_pricing?.[0]
                  const baseValue = pricing ? Number(pricing.base_price) : 0
                  const minValue = pricing ? Number(pricing.min_price) : 0
                  const maxValue = pricing ? Number(pricing.max_price) : 0
                  const uomSummaries = getProductUOMSummaries(product, unitById)
                  const compactUomSummaries = getCompactProductUOMSummaries(product, unitById)
                  const pricingLabels = getProductPricingLabels(product)
                  const branchStocks = stocksByProduct.get(product.id) ?? []
                  const expanded = expandedProductIds.has(product.id)

                  return (
                    <Fragment key={product.id}>
                    <tr style={{ backgroundColor: index % 2 === 0 ? 'var(--color-background)' : 'var(--color-surface)' }}>
                      <td style={{ padding: '12px', fontSize: '13px', color: 'var(--color-text-primary)', minWidth: 180 }}>
                        <strong>{product.name}</strong>
                        <span style={{ display: 'block', marginTop: 4, fontSize: 12, color: 'var(--color-text-muted)' }}>
                          {product.brand_family || product.subcategory || product.unit || 'No family set'}
                        </span>
                      </td>
                      <td style={{ padding: '12px', fontSize: '13px', color: 'var(--color-text-primary)' }}>{product.sku}</td>
                      <td style={{ padding: '12px', fontSize: '13px', color: 'var(--color-text-primary)' }}>{product.category}</td>
                      <td style={{ padding: '12px', fontSize: '13px', color: 'var(--color-text-primary)', minWidth: 260 }}>
                        <div className="flex flex-wrap gap-2">
                          {compactUomSummaries.map((summary) => (
                            <Badge key={summary.key} variant={summary.variant}>
                              {summary.label}
                            </Badge>
                          ))}
                          {uomSummaries.length > compactUomSummaries.length && (
                            <Badge variant="muted">+{uomSummaries.length - compactUomSummaries.length} more</Badge>
                          )}
                        </div>
                      </td>
                      <td style={{ padding: '12px' }}>
                        <Badge variant={product.product_kind === 'measured_counted' ? 'success' : 'muted'}>
                          {getProductKindLabel(product.product_kind)}
                        </Badge>
                      </td>
                      <td style={{ padding: '12px', fontSize: '13px', color: 'var(--color-text-primary)' }}>
                        <div className="flex flex-wrap gap-2">
                          {pricingLabels.slice(0, 3).map((label) => (
                            <Badge key={label.key} variant={label.variant}>{label.label}</Badge>
                          ))}
                          {pricingLabels.length > 3 && <Badge variant="muted">+{pricingLabels.length - 3}</Badge>}
                        </div>
                      </td>
                      <td style={{ padding: '12px', fontSize: '13px', color: 'var(--color-text-primary)' }}>
                        {pricing ? formatMoney(baseValue, currency) : '-'}
                      </td>
                      {showStockBreakdown && (
                        <td style={{ padding: '12px', minWidth: '240px' }}>
                          {branchStocks.length > 0 ? (
                            <div className="flex flex-wrap gap-2">
                              {branchStocks.slice(0, 2).map((stock) => (
                                <Badge key={`${stock.productId}-${stock.branchId}`} variant={getStockBadgeVariant(stock)}>
                                  {stock.branchName}: {stock.quantityOnHand}
                                </Badge>
                              ))}
                              {branchStocks.length > 2 && <Badge variant="muted">+{branchStocks.length - 2}</Badge>}
                            </div>
                          ) : (
                            <span style={{ fontSize: '13px', color: 'var(--color-text-muted)' }}>
                              No stock in assigned branches
                            </span>
                          )}
                        </td>
                      )}
                      <td style={{ padding: '12px' }}>
                        <Badge variant={product.is_active ? 'success' : 'muted'}>{product.is_active ? 'Active' : 'Inactive'}</Badge>
                      </td>
                      <td style={{ padding: '12px' }}>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            className="btn-outline"
                            style={{ padding: '7px 12px', borderRadius: 8, fontSize: 12 }}
                            onClick={() => toggleProductDetails(product.id)}
                          >
                            {expanded ? 'Hide details' : 'See more'}
                          </button>
                          {!readOnly && (
                          <ProductRowActions
                            productId={product.id}
                            productName={product.name}
                            isActive={product.is_active}
                            onEdit={() => openEditModal(product)}
                          />
                          )}
                        </div>
                      </td>
                    </tr>
                    {expanded && (
                      <tr style={{ backgroundColor: index % 2 === 0 ? 'var(--color-background)' : 'var(--color-surface)' }}>
                        <td colSpan={visibleColumnCount} style={{ padding: '0 12px 14px' }}>
                          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3" style={{ border: '1px solid var(--color-border)', borderRadius: 12, padding: 14, backgroundColor: 'var(--color-surface)' }}>
                            <div>
                              <p style={{ margin: '0 0 8px', fontSize: 12, fontWeight: 800, color: 'var(--color-text-muted)' }}>Product details</p>
                              <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-primary)' }}>Subcategory: {product.subcategory || '-'}</p>
                              <p style={{ margin: '5px 0 0', fontSize: 13, color: 'var(--color-text-primary)' }}>Family: {product.brand_family || '-'}</p>
                              <p style={{ margin: '5px 0 0', fontSize: 13, color: 'var(--color-text-primary)' }}>Description: {product.description || '-'}</p>
                            </div>
                            <div>
                              <p style={{ margin: '0 0 8px', fontSize: 12, fontWeight: 800, color: 'var(--color-text-muted)' }}>All UOMs</p>
                              <div className="flex flex-wrap gap-2">
                                {uomSummaries.map((summary) => (
                                  <Badge key={`detail-${summary.key}`} variant={summary.variant}>
                                    {summary.label}
                                    <span style={{ display: 'block', fontSize: 10, opacity: 0.8 }}>{summary.title}</span>
                                  </Badge>
                                ))}
                              </div>
                            </div>
                            <div>
                              <p style={{ margin: '0 0 8px', fontSize: 12, fontWeight: 800, color: 'var(--color-text-muted)' }}>Pricing details</p>
                              <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-primary)' }}>Applies to: {getPricingScopeLabel(product, branches)}</p>
                              <p style={{ margin: '5px 0 0', fontSize: 13, color: 'var(--color-text-primary)' }}>
                                Base/min/max: {pricing ? `${formatMoney(baseValue, currency)} / ${formatMoney(minValue, currency)} / ${formatMoney(maxValue, currency)}` : '-'}
                              </p>
                              <p style={{ margin: '5px 0 0', fontSize: 13, color: 'var(--color-text-primary)' }}>
                                Options: {formatPricingOptions(product, currency, branches, unitById)}
                              </p>
                            </div>
                            {showStockBreakdown && (
                              <div style={{ gridColumn: '1 / -1' }}>
                                <p style={{ margin: '0 0 8px', fontSize: 12, fontWeight: 800, color: 'var(--color-text-muted)' }}>Assigned branch stock</p>
                                {branchStocks.length > 0 ? (
                                  <div className="flex flex-wrap gap-2">
                                    {branchStocks.map((stock) => (
                                      <Badge key={`detail-${stock.productId}-${stock.branchId}`} variant={getStockBadgeVariant(stock)}>
                                        {stock.branchName}: {stock.quantityOnHand}
                                        {stock.quantityReserved > 0 ? ` (${stock.quantityReserved} reserved)` : ''}
                                      </Badge>
                                    ))}
                                  </div>
                                ) : (
                                  <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)' }}>No stock in assigned branches</p>
                                )}
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
          {hasMoreProducts && (
            <div className="flex justify-center" style={{ padding: '14px 12px' }}>
              <button
                type="button"
                className="btn-outline"
                style={{ padding: '8px 18px', borderRadius: 8 }}
                onClick={() => setVisibleProductCount((current) => current + PRODUCTS_PAGE_SIZE)}
              >
                Show more products
              </button>
            </div>
          )}
        </Card>
      )}

      {!readOnly && (
        <EditProductModal
          currency={currency}
          product={selectedProduct}
          uoms={uoms}
          branches={branches}
          isOpen={isEditOpen}
          onClose={() => setIsEditOpen(false)}
        />
      )}
    </div>
  )
}
