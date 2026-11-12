'use client'
/**
 * Client-side modal for updating an existing product.
 *
 * Keeps legacy product/pricing edits working while exposing the newer product
 * classification, UOM, branch scope, and pack/manual pricing model fields.
 */

import { startTransition, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useActionState } from 'react'
import { useRouter } from 'next/navigation'
import Modal from '../../../../components/ui/Modal'
import Toast from '../../../../components/ui/Toast'
import LoadingOverlay from '../../../../components/ui/LoadingOverlay'
import { useToast } from '../../../../lib/hooks/useToast'
import { conversionPreview } from '../../../../lib/uom/utils'
import type { UnitOfMeasure } from '../../../../lib/uom/server'
import { updateProduct, type FormState } from './actions'
import { addUOMAction, deactivateUnusedUOMAction, type FormState as UOMFormState } from './uom-actions'

/**
 * Branch option used for branch-specific pricing.
 */
type BranchOption = {
  id: string
  name: string
}

/**
 * Legacy pricing row still used by overview cards and older products.
 */
type ProductPricing = {
  base_price: string
  min_price: string
  max_price: string
}

/**
 * Price point row attached to a product pricing model.
 */
type ProductPricePoint = {
  quantity_in_uom: string | number
  uom_id?: string | null
  max_discount_amount?: string | number
  price: string | number
}

/**
 * Product/UOM assignment row used to hydrate linked purchase and sale units.
 */
type ProductUOMLink = {
  id: string
  uom_id: string
  is_purchase_uom?: boolean
  is_sale_uom?: boolean
  is_base_uom: boolean
  is_default_purchase_uom: boolean
  is_default_sale_uom: boolean
}

/**
 * Product pricing model row used to hydrate the edit form.
 */
type ProductPricingModel = {
  id: string
  branch_id: string | null
  pricing_method: PricingMethod
  rounding_rule: RoundingRule
  status: string
  product_price_points?: ProductPricePoint[] | null
}

/**
 * Product shape accepted by the edit modal.
 */
type Product = {
  id: string
  name: string
  sku: string
  category: string
  subcategory?: string | null
  brand_family?: string | null
  product_kind?: ProductKind
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

/**
 * Props for the edit modal.
 */
type Props = {
  product: Product | null
  currency: string
  uoms: UnitOfMeasure[]
  branches: BranchOption[]
  isOpen: boolean
  onClose: () => void
}

/**
 * Product kind controls product setup and recommended pricing flow.
 */
type ProductKind = 'fixed_package' | 'measured_counted'

/**
 * Supported pricing model types.
 */
type PricingMethod = 'fixed_price' | 'assisted_pack' | 'manual_quantity'

/**
 * Supported assisted-pricing rounding rules.
 */
type RoundingRule = 'none' | 'nearest_5' | 'up_5' | 'down_5' | 'nearest_10'

/**
 * Draft price point used by the form.
 */
type PricePointDraft = {
  id: string
  uomId: string
  quantity: string
  price: string
  maxDiscount: string
}

/**
 * Shared input style matching the dashboard forms.
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
 * Formats currency values for assisted pricing previews.
 */
function formatMoney(value: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(value)
}

/**
 * Rounds assisted prices according to the selected retail rule.
 */
function roundPrice(value: number, rule: RoundingRule): number {
  if (rule === 'none') return Number(value.toFixed(2))
  if (rule === 'up_5') return Math.ceil(value / 5) * 5
  if (rule === 'down_5') return Math.floor(value / 5) * 5
  if (rule === 'nearest_10') return Math.round(value / 10) * 10
  return Math.round(value / 5) * 5
}

/**
 * Calculates assisted pricing from the nearest lower approved pack.
 */
function calculateAssistedPrice(quantity: number, points: PricePointDraft[], roundingRule: RoundingRule): number | null {
  const sortedPoints = points
    .map((point) => ({
      quantity: Number(point.quantity),
      price: Number(point.price),
    }))
    .filter((point) => Number.isFinite(point.quantity) && point.quantity > 0 && Number.isFinite(point.price) && point.price >= 0)
    .sort((first, second) => first.quantity - second.quantity)

  if (sortedPoints.length === 0) return null

  const exactPoint = sortedPoints.find((point) => point.quantity === quantity)

  if (exactPoint) {
    return exactPoint.price
  }

  const basis = [...sortedPoints].reverse().find((point) => point.quantity < quantity) ?? sortedPoints[0]
  return roundPrice(quantity * (basis.price / basis.quantity), roundingRule)
}

/**
 * Resolves the preferred pricing model for form hydration.
 */
function getPrimaryPricingModel(product: Product): ProductPricingModel | null {
  const activeModels = (product.product_pricing_models ?? []).filter((model) => model.status === 'approved' || model.status === 'pending_approval')
  return activeModels.find((model) => model.branch_id === null) ?? activeModels[0] ?? null
}

/**
 * Detects the hidden model we use to store direct prices for extra sale UOMs.
 */
function isFixedPriceWithUOMPrices(model: ProductPricingModel | null): boolean {
  const points = model?.product_price_points ?? []

  return Boolean(
    model &&
      model.pricing_method === 'assisted_pack' &&
      model.rounding_rule === 'none' &&
      points.length > 0 &&
      points.every((point) => Number(point.quantity_in_uom) === 1)
  )
}

/**
 * Extracts a newly created UOM id from the server action payload.
 */
function readCreatedUOMId(data: unknown): string | null {
  if (typeof data !== 'object' || data === null || !('uomId' in data)) return null
  const value = (data as { uomId?: unknown }).uomId
  return typeof value === 'string' ? value : null
}

/**
 * Removes duplicate UOM rows that can appear after local create + server refresh.
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

  return unique.sort((first, second) => first.conversionFactor - second.conversionFactor || first.name.localeCompare(second.name))
}

/**
 * Client-side edit modal for existing products.
 */
export default function EditProductModal({ product, currency, uoms, branches, isOpen, onClose }: Props) {
  const router = useRouter()
  const [createUnitOpen, setCreateUnitOpen] = useState(false)
  const [availableUoms, setAvailableUoms] = useState<UnitOfMeasure[]>(dedupeUoms(uoms))
  const [productKind, setProductKind] = useState<ProductKind>('fixed_package')
  const [name, setName] = useState('')
  const [sku, setSku] = useState('')
  const [barcodes, setBarcodes] = useState('')
  const [category, setCategory] = useState('')
  const [subcategory, setSubcategory] = useState('')
  const [brandFamily, setBrandFamily] = useState('')
  const [unit, setUnit] = useState('')
  const [description, setDescription] = useState('')
  const [tracksExpiry, setTracksExpiry] = useState(false)
  const [selectedBaseUomId, setSelectedBaseUomId] = useState('')
  const [purchaseUomIds, setPurchaseUomIds] = useState<string[]>([])
  const [saleUomIds, setSaleUomIds] = useState<string[]>([])
  const [defaultPurchaseUomId, setDefaultPurchaseUomId] = useState('')
  const [defaultSaleUomId, setDefaultSaleUomId] = useState('')
  const [basePrice, setBasePrice] = useState('')
  const [minPrice, setMinPrice] = useState('')
  const [maxPrice, setMaxPrice] = useState('')
  const [uomToAddId, setUomToAddId] = useState('')
  const [uomPriceById, setUomPriceById] = useState<Record<string, string>>({})
  const [uomDiscountById, setUomDiscountById] = useState<Record<string, string>>({})
  const [pricingMethod, setPricingMethod] = useState<PricingMethod>('fixed_price')
  const [roundingRule, setRoundingRule] = useState<RoundingRule>('nearest_5')
  const [pricingBranchScope, setPricingBranchScope] = useState<'all' | 'branch'>('all')
  const [pricingBranchIds, setPricingBranchIds] = useState<string[]>([])
  const [pricePoints, setPricePoints] = useState<PricePointDraft[]>([{ id: 'point-0', uomId: '', quantity: '1', price: '', maxDiscount: '0' }])
  const [newUnitName, setNewUnitName] = useState('')
  const [newUnitAbbreviation, setNewUnitAbbreviation] = useState('')
  const [newUnitFactor, setNewUnitFactor] = useState('1')
  const [newUnitIsBase, setNewUnitIsBase] = useState(false)

  const { toast, toastState, dismiss } = useToast()
  const [state, action, isPending] = useActionState<FormState, FormData>(updateProduct, {
    error: null,
    success: false,
  })
  const [uomState, uomAction, uomPending] = useActionState<UOMFormState, FormData>(addUOMAction, { error: null, success: false })
  const [removeUomState, removeUomAction, removeUomPending] = useActionState<UOMFormState, FormData>(deactivateUnusedUOMAction, { error: null, success: false })
  const previousPending = useRef(isPending)
  const previousUOMPending = useRef(uomPending)
  const previousRemoveUOMPending = useRef(removeUomPending)
  const visibleUoms = useMemo(() => dedupeUoms(availableUoms), [availableUoms])
  const selectedBaseUom = visibleUoms.find((uom) => uom.id === selectedBaseUomId) ?? null
  const selectedPurchaseUoms = purchaseUomIds.map((uomId) => visibleUoms.find((uom) => uom.id === uomId)).filter((uom): uom is UnitOfMeasure => Boolean(uom))
  const selectedSaleUoms = saleUomIds.map((uomId) => visibleUoms.find((uom) => uom.id === uomId)).filter((uom): uom is UnitOfMeasure => Boolean(uom))
  const defaultSaleUom = selectedSaleUoms.find((uom) => uom.id === defaultSaleUomId) ?? null
  const additionalSaleUoms = selectedSaleUoms.filter((uom) => uom.id !== defaultSaleUomId)
  const baseUom = visibleUoms.find((uom) => uom.isBaseUnit) ?? visibleUoms.find((uom) => uom.conversionFactor === 1) ?? visibleUoms[0] ?? null
  const parsedNewUnitFactor = Number(newUnitFactor)
  const newUnitPreview = Number.isFinite(parsedNewUnitFactor)
    ? conversionPreview(1, parsedNewUnitFactor, baseUom?.name ?? 'base units')
    : '= Enter a valid conversion factor'

  const assistedPreviewRows = useMemo(() => {
    if (pricingMethod !== 'assisted_pack') return []
    const maxPointQuantity = Math.max(6, ...pricePoints.map((point) => Number(point.quantity)).filter(Number.isFinite))
    const maxPreviewQuantity = Math.min(maxPointQuantity + 3, 30)

    return Array.from({ length: maxPreviewQuantity }, (_, index) => {
      const quantity = index + 1
      return {
        quantity,
        price: calculateAssistedPrice(quantity, pricePoints, roundingRule),
      }
    })
  }, [pricePoints, pricingMethod, roundingRule])

  /**
   * Closes the modal after a successful server action.
   */
  useEffect(() => {
    let closeTimer: ReturnType<typeof setTimeout> | null = null

    if (previousPending.current && !isPending) {
      if (state.success) {
        toast.success('Product updated successfully')
        closeTimer = setTimeout(() => {
          onClose()
          router.refresh()
        }, 0)
      } else if (state.error) {
        toast.error(state.error)
      }
    }

    previousPending.current = isPending
    return () => {
      if (closeTimer) clearTimeout(closeTimer)
    }
  }, [isPending, router, state.error, state.success, toast, onClose])

  /**
   * Keeps the local UOM list aligned with server-provided units.
   */
  useEffect(() => {
    const syncTimer = setTimeout(() => {
      setAvailableUoms(dedupeUoms(uoms))
    }, 0)

    return () => clearTimeout(syncTimer)
  }, [uoms])

  /**
   * Handles successful nested UOM creation.
   */
  useEffect(() => {
    let resetTimer: ReturnType<typeof setTimeout> | null = null

    if (previousUOMPending.current && !uomPending) {
      if (uomState.success) {
        const createdUomId = readCreatedUOMId(uomState.data)

        if (createdUomId) {
          const conversionFactor = Number(newUnitFactor)
          const createdUom: UnitOfMeasure = {
            id: createdUomId,
            businessId: '',
            name: newUnitName.trim(),
            abbreviation: newUnitAbbreviation.trim(),
            conversionFactor: Number.isFinite(conversionFactor) ? conversionFactor : 1,
            isBaseUnit: newUnitIsBase,
            isActive: true,
            createdBy: '',
            createdAt: new Date().toISOString(),
          }

          toast.success('Unit created')
          resetTimer = setTimeout(() => {
            setAvailableUoms((current) => dedupeUoms([...current, createdUom]))
            setSelectedBaseUomId(createdUomId)
            setUnit(createdUom.name)
            setPurchaseUomIds((current) => Array.from(new Set([...current, createdUomId])))
            setSaleUomIds((current) => Array.from(new Set([...current, createdUomId])))
            setDefaultPurchaseUomId((current) => current || createdUomId)
            setDefaultSaleUomId((current) => current || createdUomId)
            setCreateUnitOpen(false)
            setNewUnitName('')
            setNewUnitAbbreviation('')
            setNewUnitFactor('1')
            setNewUnitIsBase(false)
          }, 0)
        }
      } else if (uomState.error) {
        toast.error(uomState.error)
      }
    }

    previousUOMPending.current = uomPending
    return () => {
      if (resetTimer) clearTimeout(resetTimer)
    }
  }, [newUnitAbbreviation, newUnitFactor, newUnitIsBase, newUnitName, toast, uomPending, uomState.data, uomState.error, uomState.success])

  /**
   * Handles safe removal of unused UOM choices from the active library.
   */
  useEffect(() => {
    let resetTimer: ReturnType<typeof setTimeout> | null = null

    if (previousRemoveUOMPending.current && !removeUomPending) {
      if (removeUomState.success) {
        const removedUomId = readCreatedUOMId(removeUomState.data)

        if (removedUomId) {
          toast.success('Unit removed from active choices')
          resetTimer = setTimeout(() => {
            setAvailableUoms((current) => current.filter((uom) => uom.id !== removedUomId))
            setPurchaseUomIds((current) => current.filter((uomId) => uomId !== removedUomId))
            setSaleUomIds((current) => current.filter((uomId) => uomId !== removedUomId))
            setUomPriceById((current) => {
              const next = { ...current }
              delete next[removedUomId]
              return next
            })
            setUomDiscountById((current) => {
              const next = { ...current }
              delete next[removedUomId]
              return next
            })
            setSelectedBaseUomId((current) => (current === removedUomId ? visibleUoms.find((uom) => uom.id !== removedUomId)?.id ?? '' : current))
            setDefaultPurchaseUomId((current) => (current === removedUomId ? purchaseUomIds.find((uomId) => uomId !== removedUomId) ?? '' : current))
            setDefaultSaleUomId((current) => (current === removedUomId ? saleUomIds.find((uomId) => uomId !== removedUomId) ?? '' : current))
          }, 0)
        }
      } else if (removeUomState.error) {
        toast.error(removeUomState.error)
      }
    }

    previousRemoveUOMPending.current = removeUomPending
    return () => {
      if (resetTimer) clearTimeout(resetTimer)
    }
  }, [purchaseUomIds, removeUomPending, removeUomState.data, removeUomState.error, removeUomState.success, saleUomIds, toast, visibleUoms])

  /**
   * Hydrates the form from the selected product without synchronous effect
   * updates that trigger React cascading-render warnings.
   */
  useEffect(() => {
    if (!product) return

    const hydrateTimer = setTimeout(() => {
      const primaryModel = getPrimaryPricingModel(product)
      const modelPoints = primaryModel?.product_price_points ?? []
      const isUOMOnlyPricingModel = isFixedPriceWithUOMPrices(primaryModel)
      const activeModelPoints = (product.product_pricing_models ?? [])
        .filter((model) => model.status === 'approved' || model.status === 'pending_approval')
        .flatMap((model) => model.product_price_points ?? [])
      const branchScopedModels = (product.product_pricing_models ?? []).filter((model) => model.branch_id && model.status !== 'inactive')
      const matchingUom = uoms.find((uom) => uom.name.toLowerCase() === product.unit.toLowerCase())
      const productLinks = product.product_uom_links ?? []
      const linkedUomIds = productLinks.map((link) => link.uom_id)
      const baseLink = productLinks.find((link) => link.is_base_uom)
      const hasAvailabilityFlags = productLinks.some((link) => typeof link.is_purchase_uom === 'boolean' || typeof link.is_sale_uom === 'boolean')
      const purchaseIds = productLinks.filter((link) => (hasAvailabilityFlags ? link.is_purchase_uom !== false : true)).map((link) => link.uom_id)
      const saleIds = productLinks.filter((link) => (hasAvailabilityFlags ? link.is_sale_uom !== false : true)).map((link) => link.uom_id)
      const fallbackBaseUomId = baseLink?.uom_id ?? matchingUom?.id ?? uoms[0]?.id ?? ''

      setProductKind(product.product_kind ?? 'fixed_package')
      setName(product.name)
      setSku(product.sku)
      setBarcodes(product.barcodes?.join('\n') ?? '')
      setCategory(product.category)
      setSubcategory(product.subcategory ?? '')
      setBrandFamily(product.brand_family ?? '')
      setUnit(product.unit)
      setDescription(product.description ?? '')
      setTracksExpiry(product.tracks_expiry === true)
      setSelectedBaseUomId(fallbackBaseUomId)
      setPurchaseUomIds(purchaseIds.length > 0 ? Array.from(new Set(purchaseIds)) : fallbackBaseUomId ? [fallbackBaseUomId] : [])
      setSaleUomIds(saleIds.length > 0 ? Array.from(new Set(saleIds)) : fallbackBaseUomId ? [fallbackBaseUomId] : [])
      setDefaultPurchaseUomId(productLinks.find((link) => link.is_default_purchase_uom)?.uom_id ?? fallbackBaseUomId)
      setDefaultSaleUomId(productLinks.find((link) => link.is_default_sale_uom)?.uom_id ?? fallbackBaseUomId)
      setBasePrice(product.product_pricing?.[0]?.base_price ?? '')
      setMinPrice(product.product_pricing?.[0]?.min_price ?? '')
      setMaxPrice(product.product_pricing?.[0]?.max_price ?? '')
      setUomToAddId('')
      setUomPriceById(() => {
        const next: Record<string, string> = {}
        activeModelPoints.forEach((point) => {
          if (typeof point.uom_id === 'string' && Number(point.quantity_in_uom) === 1 && point.uom_id !== (productLinks.find((link) => link.is_default_sale_uom)?.uom_id ?? fallbackBaseUomId)) {
            next[point.uom_id] = String(point.price)
          }
        })
        return next
      })
      setUomDiscountById(() => {
        const next: Record<string, string> = {}
        activeModelPoints.forEach((point) => {
          if (typeof point.uom_id === 'string' && Number(point.quantity_in_uom) === 1 && point.uom_id !== (productLinks.find((link) => link.is_default_sale_uom)?.uom_id ?? fallbackBaseUomId)) {
            next[point.uom_id] = String(point.max_discount_amount ?? 0)
          }
        })
        return next
      })
      setPricingMethod(isUOMOnlyPricingModel ? 'fixed_price' : primaryModel?.pricing_method ?? 'fixed_price')
      setRoundingRule(isUOMOnlyPricingModel ? 'nearest_5' : primaryModel?.rounding_rule ?? 'nearest_5')
      setPricingBranchScope(primaryModel && primaryModel.branch_id !== null ? 'branch' : branchScopedModels.length > 0 ? 'branch' : 'all')
      setPricingBranchIds(branchScopedModels.map((model) => model.branch_id).filter((branchId): branchId is string => typeof branchId === 'string'))
      setPricePoints(
        !isUOMOnlyPricingModel && modelPoints.length > 0
          ? modelPoints.map((point, index) => ({
              id: `point-${index}`,
              uomId: typeof point.uom_id === 'string' ? point.uom_id : fallbackBaseUomId,
              quantity: String(point.quantity_in_uom),
              price: String(point.price),
              maxDiscount: String(point.max_discount_amount ?? 0),
            }))
          : [{ id: 'point-0', uomId: fallbackBaseUomId, quantity: '1', price: '', maxDiscount: '0' }]
      )
    }, 0)

    return () => clearTimeout(hydrateTimer)
  }, [product, uoms])

  /**
   * Selects pricing method and seeds helpful assisted pack rows when needed.
   */
  const selectPricingMethod = (method: PricingMethod) => {
    setPricingMethod(method)

    if (
      method === 'assisted_pack' &&
      pricePoints.length === 1 &&
      pricePoints[0]?.quantity === '1' &&
      pricePoints[0]?.price.trim() === ''
    ) {
      setPricePoints([
        { id: 'point-0', uomId: defaultSaleUomId || selectedBaseUomId, quantity: '1', price: '', maxDiscount: '0' },
        { id: 'point-1', uomId: defaultSaleUomId || selectedBaseUomId, quantity: '6', price: '', maxDiscount: '0' },
      ])
    }
  }

  /**
   * Toggles branch-specific pricing scope.
   */
  const togglePricingBranch = (branchId: string) => {
    setPricingBranchIds((current) => (current.includes(branchId) ? current.filter((id) => id !== branchId) : [...current, branchId]))
  }

  /**
   * Toggles a UOM in the purchase or sale availability list.
   */
  const toggleUomSelection = (uomId: string, selectedIds: string[], setSelectedIds: (value: string[]) => void, defaultId: string, setDefaultId: (value: string) => void) => {
    const exists = selectedIds.includes(uomId)
    const nextIds = exists ? selectedIds.filter((id) => id !== uomId) : [...selectedIds, uomId]
    setSelectedIds(nextIds)

    if (!exists && !defaultId) setDefaultId(uomId)
    if (exists && defaultId === uomId) setDefaultId(nextIds[0] ?? '')
  }

  /**
   * Adds a unit from the library to this product.
   */
  const addUomToProduct = () => {
    if (!uomToAddId) {
      toast.error('Select a unit to add to this product')
      return
    }

    setPurchaseUomIds((current) => Array.from(new Set([...current, uomToAddId])))
    setSaleUomIds((current) => Array.from(new Set([...current, uomToAddId])))
    setDefaultPurchaseUomId((current) => current || uomToAddId)
    setDefaultSaleUomId((current) => current || uomToAddId)
    setUomToAddId('')
  }

  /**
   * Updates a dynamic pricing point row.
   */
  const updatePricePoint = (id: string, patch: Partial<PricePointDraft>) => {
    setPricePoints((current) => current.map((point) => (point.id === id ? { ...point, ...patch } : point)))
  }

  /**
   * Requests safe deactivation of an unused unit.
   */
  const removeUnusedUnit = (uomId: string) => {
    const formData = new FormData()
    formData.set('uomId', uomId)

    startTransition(() => {
      removeUomAction(formData)
    })
  }

  /**
   * Submits the full product update payload.
   */
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!product) return

    if (pricingBranchScope === 'branch' && pricingBranchIds.length === 0) {
      toast.error('Select at least one branch for branch-specific pricing')
      return
    }

    if (!selectedBaseUomId || !purchaseUomIds.includes(defaultPurchaseUomId) || !saleUomIds.includes(defaultSaleUomId)) {
      toast.error('Select base, purchase, and sale units before saving')
      return
    }

    const selectedUom = visibleUoms.find((uom) => uom.id === selectedBaseUomId)
    const formData = new FormData()
    formData.set('productId', product.id)
    formData.set('productKind', productKind)
    formData.set('name', name)
    formData.set('sku', sku)
    formData.set('barcodes', barcodes)
    formData.set('category', category)
    formData.set('subcategory', subcategory)
    formData.set('brandFamily', brandFamily)
    formData.set('unit', selectedUom?.name ?? unit)
    formData.set('description', description)
    formData.set('tracksExpiry', String(tracksExpiry))
    formData.set('basePrice', basePrice)
    formData.set('minPrice', minPrice)
    formData.set('maxPrice', maxPrice)
    formData.set('baseUomId', selectedBaseUomId)
    formData.set('defaultPurchaseUomId', defaultPurchaseUomId)
    formData.set('defaultSaleUomId', defaultSaleUomId)
    formData.set('pricingMethod', pricingMethod)
    formData.set('roundingRule', roundingRule)
    formData.set('pricingBranchScope', pricingBranchScope)
    pricingBranchIds.forEach((branchId) => formData.append('pricingBranchIds', branchId))
    purchaseUomIds.forEach((uomId) => formData.append('purchaseUomIds', uomId))
    saleUomIds.forEach((uomId) => formData.append('saleUomIds', uomId))
    formData.set('pricePointCount', String(pricingMethod === 'fixed_price' ? 0 : pricePoints.length))
    const pricedUoms = selectedSaleUoms.filter((uom) => uom.id !== defaultSaleUomId && uomPriceById[uom.id]?.trim())
    formData.set('uomPriceCount', String(pricedUoms.length))
    pricedUoms.forEach((uom, index) => {
      formData.set(`uomPriceUomId_${index}`, uom.id)
      formData.set(`uomPriceAmount_${index}`, uomPriceById[uom.id] ?? '')
      formData.set(`uomPriceMaxDiscount_${index}`, uomDiscountById[uom.id] ?? '0')
    })
    if (pricingMethod !== 'fixed_price') {
      pricePoints.forEach((point, index) => {
        formData.set(`pricePointUomId_${index}`, defaultSaleUomId || selectedBaseUomId)
        formData.set(`pricePointQuantity_${index}`, point.quantity)
        formData.set(`pricePointPrice_${index}`, point.price)
        formData.set(`pricePointMaxDiscount_${index}`, point.maxDiscount || '0')
      })
    }

    startTransition(() => {
      action(formData)
    })
  }

  /**
   * Submits nested UOM creation from the edit modal.
   */
  const onCreateUnitSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const formData = new FormData()
    formData.set('name', newUnitName)
    formData.set('abbreviation', newUnitAbbreviation)
    formData.set('conversionFactor', newUnitFactor)
    formData.set('isBaseUnit', String(newUnitIsBase))

    startTransition(() => {
      uomAction(formData)
    })
  }

  return (
    <>
      {(isPending || uomPending || removeUomPending) && <LoadingOverlay message={isPending ? 'Updating product...' : uomPending ? 'Creating unit...' : 'Removing unused unit...'} />}
      {toastState && <Toast message={toastState.message} type={toastState.type} onDismiss={dismiss} duration={toastState.duration} />}

      <Modal isOpen={isOpen} title="Edit product" onClose={onClose}>
        <form onSubmit={onSubmit}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxHeight: '72vh', overflowY: 'auto', paddingRight: 4 }}>
            <div>
              <p style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 700 }}>How is this product sold?</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  className={productKind === 'fixed_package' ? 'btn-primary' : 'btn-outline'}
                  style={{ padding: '10px 20px', borderRadius: 8, textAlign: 'left' }}
                  onClick={() => {
                    setProductKind('fixed_package')
                    selectPricingMethod('fixed_price')
                  }}
                >
                  Fixed package/item
                  <span style={{ display: 'block', fontSize: 12, marginTop: 4 }}>OMO 500g, soda, bread</span>
                </button>
                <button
                  type="button"
                  className={productKind === 'measured_counted' ? 'btn-primary' : 'btn-outline'}
                  style={{ padding: '10px 20px', borderRadius: 8, textAlign: 'left' }}
                  onClick={() => {
                    setProductKind('measured_counted')
                  }}
                >
                  Counted/measured
                  <span style={{ display: 'block', fontSize: 12, marginTop: 4 }}>Eggs, rice, sugar</span>
                </button>
              </div>
            </div>

            <label style={{ fontSize: 13 }}>
              <span style={{ display: 'block', marginBottom: 6, fontWeight: 500 }}>Product name</span>
              <input type="text" value={name} onChange={(event) => setName(event.target.value)} required style={inputStyle} />
            </label>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label style={{ fontSize: 13 }}>
                <span style={{ display: 'block', marginBottom: 6, fontWeight: 500 }}>SKU</span>
                <input type="text" value={sku} onChange={(event) => setSku(event.target.value)} required style={inputStyle} />
              </label>
              <label style={{ fontSize: 13 }}>
                <span style={{ display: 'block', marginBottom: 6, fontWeight: 500 }}>Category</span>
                <input type="text" value={category} onChange={(event) => setCategory(event.target.value)} required style={inputStyle} />
              </label>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label style={{ fontSize: 13 }}>
                <span style={{ display: 'block', marginBottom: 6, fontWeight: 500 }}>Subcategory</span>
                <input value={subcategory} onChange={(event) => setSubcategory(event.target.value)} placeholder="Chicken Eggs or Powder Detergent" style={inputStyle} />
              </label>
              <label style={{ fontSize: 13 }}>
                <span style={{ display: 'block', marginBottom: 6, fontWeight: 500 }}>Brand/family</span>
                <input value={brandFamily} onChange={(event) => setBrandFamily(event.target.value)} placeholder="Eggs or OMO" style={inputStyle} />
              </label>
            </div>

            {visibleUoms.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14, border: '1px solid var(--color-border)', borderRadius: 10, padding: 14 }}>
                <div style={{ border: '1px solid var(--color-border)', borderRadius: 10, padding: 14, backgroundColor: 'var(--color-surface)' }}>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 700 }}>Units and prices for this product</p>
                  <p style={{ margin: '4px 0 12px', fontSize: 12, color: 'var(--color-text-muted)' }}>
                    The default sale unit uses the normal price below. Add extra sale units here only when they need their own price, for example Tray of 30.
                  </p>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                    <div>
                      <p style={{ margin: '0 0 6px', fontSize: 12, color: 'var(--color-text-muted)' }}>Base</p>
                      <strong style={{ fontSize: 13 }}>{selectedBaseUom ? `${selectedBaseUom.name} (${selectedBaseUom.conversionFactor} base)` : unit || 'Not selected'}</strong>
                    </div>
                    <div>
                      <p style={{ margin: '0 0 6px', fontSize: 12, color: 'var(--color-text-muted)' }}>Can receive stock as</p>
                      <p style={{ margin: 0, fontSize: 13 }}>
                        {selectedPurchaseUoms.length > 0 ? selectedPurchaseUoms.map((uom) => uom.name).join(', ') : 'None selected'}
                      </p>
                    </div>
                    <div>
                      <p style={{ margin: '0 0 6px', fontSize: 12, color: 'var(--color-text-muted)' }}>Can sell as</p>
                      <p style={{ margin: 0, fontSize: 13 }}>
                        {selectedSaleUoms.length > 0 ? selectedSaleUoms.map((uom) => uom.name).join(', ') : 'None selected'}
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto]" style={{ marginTop: 14 }}>
                    <select value={uomToAddId} onChange={(event) => setUomToAddId(event.target.value)} style={inputStyle}>
                      <option value="">Choose a unit or pack to add...</option>
                      {visibleUoms
                        .filter((uom) => !saleUomIds.includes(uom.id))
                        .map((uom) => (
                          <option key={`edit-add-product-uom-${uom.id}`} value={uom.id}>
                            {uom.name} ({uom.conversionFactor} base)
                          </option>
                        ))}
                    </select>
                    <button type="button" className="btn-outline" style={{ padding: '8px 14px', borderRadius: 8 }} onClick={addUomToProduct}>
                      Add to product
                    </button>
                  </div>

                  {selectedSaleUoms.length > 0 && (
                    <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {defaultSaleUom && (
                        <div style={{ border: '1px solid var(--color-border)', borderRadius: 10, padding: 12, backgroundColor: 'var(--color-background)' }}>
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p style={{ margin: 0, fontSize: 13, fontWeight: 700 }}>{defaultSaleUom.name}</p>
                              <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--color-text-muted)' }}>
                                Default sale unit. Price comes from the normal base/min/max price.
                              </p>
                            </div>
                            <span style={{ fontSize: 11, color: 'var(--color-primary)', fontWeight: 700 }}>Default price</span>
                          </div>
                        </div>
                      )}

                      {additionalSaleUoms.length > 0 ? (
                        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                          {additionalSaleUoms.map((uom) => (
                            <div key={`edit-selected-uom-price-${uom.id}`} style={{ border: '1px solid var(--color-border)', borderRadius: 10, padding: 12, backgroundColor: 'var(--color-background)' }}>
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <p style={{ margin: 0, fontSize: 13, fontWeight: 700 }}>{uom.name}</p>
                                  <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--color-text-muted)' }}>
                                    1 {uom.name} = {uom.conversionFactor} base unit{uom.conversionFactor === 1 ? '' : 's'}
                                  </p>
                                </div>
                                <span style={{ fontSize: 11, color: 'var(--color-text-muted)', fontWeight: 700 }}>Own price</span>
                              </div>
                              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" style={{ marginTop: 10 }}>
                                <label style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                                  Price for 1 {uom.name}
                                  <input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={uomPriceById[uom.id] ?? ''}
                                    onChange={(event) => setUomPriceById((current) => ({ ...current, [uom.id]: event.target.value }))}
                                    placeholder={`Amount (${currency})`}
                                    style={{ ...inputStyle, marginTop: 6 }}
                                  />
                                </label>
                                <label style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                                  Max discount
                                  <input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={uomDiscountById[uom.id] ?? '0'}
                                    onChange={(event) => setUomDiscountById((current) => ({ ...current, [uom.id]: event.target.value }))}
                                    placeholder={`Discount (${currency})`}
                                    style={{ ...inputStyle, marginTop: 6 }}
                                  />
                                </label>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p style={{ margin: 0, fontSize: 12, color: 'var(--color-text-muted)' }}>
                          No extra sale-unit prices yet. Add another sale unit if this product is also sold as a pack, tray, crate, or measured quantity.
                        </p>
                      )}
                    </div>
                  )}
                </div>

                <label style={{ fontSize: 13 }}>
                  <span style={{ display: 'block', marginBottom: 6, fontWeight: 600 }}>Base unit of measurement</span>
                  <select
                    value={selectedBaseUomId}
                    onChange={(event) => {
                      if (event.target.value === '__create__') {
                        setCreateUnitOpen(true)
                        return
                      }

                      const selectedUom = visibleUoms.find((uom) => uom.id === event.target.value)
                      setSelectedBaseUomId(event.target.value)
                      setPurchaseUomIds((current) => Array.from(new Set([...current, event.target.value])))
                      setSaleUomIds((current) => Array.from(new Set([...current, event.target.value])))
                      if (selectedUom) setUnit(selectedUom.name)
                    }}
                    style={inputStyle}
                  >
                    <option value="">Keep current unit ({unit || 'not set'})</option>
                    {visibleUoms.map((uom) => (
                      <option key={uom.id} value={uom.id}>
                        {uom.name} ({uom.abbreviation})
                      </option>
                    ))}
                    <option value="__create__">Create new unit...</option>
                  </select>
                  <span style={{ display: 'block', marginTop: 6, color: 'var(--color-text-muted)', fontSize: 12 }}>
                    This is the smallest unit inventory is stored in. Example: Egg = 1 base unit.
                  </span>
                </label>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div>
                    <p style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 600 }}>Units this product can be received in</p>
                    <div style={{ border: '1px solid var(--color-border)', borderRadius: 8, padding: 12, maxHeight: 220, overflowY: 'auto' }}>
                      {visibleUoms.map((uom) => (
                        <label key={`purchase-${uom.id}`} className="flex items-center gap-2" style={{ fontSize: 13, marginBottom: 8 }}>
                          <input
                            type="checkbox"
                            checked={purchaseUomIds.includes(uom.id)}
                            onChange={() => toggleUomSelection(uom.id, purchaseUomIds, setPurchaseUomIds, defaultPurchaseUomId, setDefaultPurchaseUomId)}
                          />
                          <span>
                            {uom.name} ({uom.conversionFactor} base unit{uom.conversionFactor === 1 ? '' : 's'})
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 600 }}>Units this product can be sold in</p>
                    <div style={{ border: '1px solid var(--color-border)', borderRadius: 8, padding: 12, maxHeight: 220, overflowY: 'auto' }}>
                      {visibleUoms.map((uom) => (
                        <label key={`sale-${uom.id}`} className="flex items-center gap-2" style={{ fontSize: 13, marginBottom: 8 }}>
                          <input
                            type="checkbox"
                            checked={saleUomIds.includes(uom.id)}
                            onChange={() => toggleUomSelection(uom.id, saleUomIds, setSaleUomIds, defaultSaleUomId, setDefaultSaleUomId)}
                          />
                          <span>
                            {uom.name} ({uom.conversionFactor} base unit{uom.conversionFactor === 1 ? '' : 's'})
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div>
                    <p style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 600 }}>Default receiving unit</p>
                    {purchaseUomIds.map((uomId) => {
                      const uom = visibleUoms.find((item) => item.id === uomId)
                      return uom ? (
                        <label key={`default-purchase-${uom.id}`} className="flex items-center gap-2" style={{ fontSize: 13, marginBottom: 8 }}>
                          <input type="radio" name="defaultPurchaseUnitEdit" checked={defaultPurchaseUomId === uom.id} onChange={() => setDefaultPurchaseUomId(uom.id)} />
                          {uom.name}
                        </label>
                      ) : null
                    })}
                  </div>
                  <div>
                    <p style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 600 }}>Default sale unit</p>
                    {saleUomIds.map((uomId) => {
                      const uom = visibleUoms.find((item) => item.id === uomId)
                      return uom ? (
                        <label key={`default-sale-${uom.id}`} className="flex items-center gap-2" style={{ fontSize: 13, marginBottom: 8 }}>
                          <input type="radio" name="defaultSaleUnitEdit" checked={defaultSaleUomId === uom.id} onChange={() => setDefaultSaleUomId(uom.id)} />
                          {uom.name}
                        </label>
                      ) : null
                    })}
                  </div>
                </div>

                <div style={{ border: '1px solid var(--color-border)', borderRadius: 8, padding: 12 }}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p style={{ margin: 0, fontSize: 13, fontWeight: 700 }}>Unit library</p>
                      <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--color-text-muted)' }}>
                        Drop only unused units. Units linked to products or historical records are protected.
                      </p>
                    </div>
                    <button type="button" className="btn-outline" style={{ padding: '6px 12px', borderRadius: 8 }} onClick={() => setCreateUnitOpen(true)}>
                      New unit or pack
                    </button>
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" style={{ marginTop: 12 }}>
                    {visibleUoms.map((uom) => (
                      <div key={`edit-library-${uom.id}`} className="flex items-center justify-between gap-2" style={{ border: '1px solid var(--color-border)', borderRadius: 8, padding: 10 }}>
                        <span style={{ fontSize: 13 }}>
                          {uom.name}
                          <span style={{ display: 'block', color: 'var(--color-text-muted)', fontSize: 12 }}>
                            1 {uom.name} = {uom.conversionFactor} base unit{uom.conversionFactor === 1 ? '' : 's'}
                          </span>
                        </span>
                        <button
                          type="button"
                          className="btn-outline"
                          style={{ padding: '5px 10px', borderRadius: 8, fontSize: 12 }}
                          disabled={removeUomPending}
                          onClick={() => removeUnusedUnit(uom.id)}
                        >
                          Drop
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto]">
                <label style={{ fontSize: 13 }}>
                  <span style={{ display: 'block', marginBottom: 6, fontWeight: 500 }}>Base unit of measurement</span>
                  <input type="text" value={unit} onChange={(event) => setUnit(event.target.value)} required style={inputStyle} />
                </label>
                <button type="button" className="btn-outline" style={{ alignSelf: 'end', padding: '10px 20px', borderRadius: 8 }} onClick={() => setCreateUnitOpen(true)}>
                  New unit
                </button>
              </div>
            )}

            <label style={{ fontSize: 13 }}>
              <span style={{ display: 'block', marginBottom: 6, fontWeight: 500 }}>Add barcode values</span>
              <textarea
                value={barcodes}
                onChange={(event) => setBarcodes(event.target.value)}
                rows={2}
                placeholder="One new barcode per line. Existing codes stay linked."
                style={{ width: '100%', border: '1px solid var(--color-border)', borderRadius: 8, padding: '10px 12px', boxSizing: 'border-box', resize: 'vertical', fontSize: 13 }}
              />
            </label>
            <label style={{ fontSize: 13 }}>
              <span style={{ display: 'block', marginBottom: 6, fontWeight: 500 }}>Description</span>
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={3}
                style={{ width: '100%', border: '1px solid var(--color-border)', borderRadius: 8, padding: '10px 12px', boxSizing: 'border-box', resize: 'vertical', fontSize: 13 }}
              />
            </label>
            <label className="flex items-start gap-3" style={{ border: '1px solid var(--color-border)', borderRadius: 8, padding: 12 }}>
              <input type="checkbox" checked={tracksExpiry} onChange={(event) => setTracksExpiry(event.target.checked)} style={{ marginTop: 3 }} />
              <span style={{ fontSize: 13 }}>
                <strong style={{ display: 'block' }}>Track expiry by batch</strong>
                <span style={{ display: 'block', marginTop: 3, color: 'var(--color-text-muted)', fontSize: 12 }}>Require an expiry date each time this product is received.</span>
              </span>
            </label>

            <div>
              <p style={{ margin: '0 0 6px', fontSize: 13, fontWeight: 700 }}>Pricing model</p>
              <p style={{ margin: '0 0 10px', fontSize: 12, color: 'var(--color-text-muted)' }}>
                Choose how employees will price this product at checkout.
              </p>
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                <button type="button" className={pricingMethod === 'fixed_price' ? 'btn-primary' : 'btn-outline'} style={{ padding: '10px 20px', borderRadius: 8, textAlign: 'left' }} onClick={() => selectPricingMethod('fixed_price')}>
                  Fixed price
                  <span style={{ display: 'block', fontSize: 12, marginTop: 4 }}>One normal selling price.</span>
                </button>
                <button type="button" className={pricingMethod === 'assisted_pack' ? 'btn-primary' : 'btn-outline'} style={{ padding: '10px 20px', borderRadius: 8, textAlign: 'left' }} onClick={() => selectPricingMethod('assisted_pack')}>
                  System assisted
                  <span style={{ display: 'block', fontSize: 12, marginTop: 4 }}>Enter packs like 6 @ 100.</span>
                </button>
                <button type="button" className={pricingMethod === 'manual_quantity' ? 'btn-primary' : 'btn-outline'} style={{ padding: '10px 20px', borderRadius: 8, textAlign: 'left' }} onClick={() => selectPricingMethod('manual_quantity')}>
                  Manual quantity prices
                  <span style={{ display: 'block', fontSize: 12, marginTop: 4 }}>Exact owner-approved prices.</span>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <label style={{ fontSize: 13 }}>
                <span style={{ display: 'block', marginBottom: 6, fontWeight: 500 }}>Base ({currency})</span>
                <input type="number" step="0.01" min="0" value={basePrice} onChange={(event) => setBasePrice(event.target.value)} required style={inputStyle} />
              </label>
              <label style={{ fontSize: 13 }}>
                <span style={{ display: 'block', marginBottom: 6, fontWeight: 500 }}>Min ({currency})</span>
                <input type="number" step="0.01" min="0" value={minPrice} onChange={(event) => setMinPrice(event.target.value)} required style={inputStyle} />
              </label>
              <label style={{ fontSize: 13 }}>
                <span style={{ display: 'block', marginBottom: 6, fontWeight: 500 }}>Max ({currency})</span>
                <input type="number" step="0.01" min="0" value={maxPrice} onChange={(event) => setMaxPrice(event.target.value)} required style={inputStyle} />
              </label>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label style={{ fontSize: 13 }}>
                <span style={{ display: 'block', marginBottom: 6, fontWeight: 500 }}>Applies to</span>
                <select
                  value={pricingBranchScope}
                  onChange={(event) => {
                    const nextScope = event.target.value as 'all' | 'branch'
                    setPricingBranchScope(nextScope)
                    if (nextScope === 'all') setPricingBranchIds([])
                  }}
                  style={inputStyle}
                >
                  <option value="all">All branches</option>
                  <option value="branch">Selected branches</option>
                </select>
              </label>
              {pricingBranchScope === 'branch' && (
                <div style={{ fontSize: 13 }}>
                  <span style={{ display: 'block', marginBottom: 6, fontWeight: 500 }}>Branches</span>
                  <div style={{ border: '1px solid var(--color-border)', borderRadius: 8, padding: 12, maxHeight: 168, overflowY: 'auto' }}>
                    {branches.map((branch) => (
                      <label key={branch.id} className="flex items-center gap-2" style={{ marginBottom: 8 }}>
                        <input type="checkbox" checked={pricingBranchIds.includes(branch.id)} onChange={() => togglePricingBranch(branch.id)} />
                        {branch.name}
                      </label>
                    ))}
                    {branches.length === 0 && <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>No active branches found.</p>}
                  </div>
                </div>
              )}
            </div>

            {pricingMethod !== 'fixed_price' && (
              <div style={{ border: '1px solid var(--color-border)', borderRadius: 8, padding: 12 }}>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p style={{ margin: 0, fontSize: 13, fontWeight: 700 }}>{pricingMethod === 'assisted_pack' ? 'Pack prices for system assistance' : 'Manual quantity prices'}</p>
                    <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--color-text-muted)' }}>
                      {pricingMethod === 'assisted_pack'
                        ? 'Examples: 1 @ 20, 6 @ 100, 10 @ 170.'
                        : 'Examples: 1 @ 20, 2 @ 35, 3 @ 50.'}
                    </p>
                  </div>
                  <button type="button" className="btn-outline" style={{ padding: '5px 14px', borderRadius: 8 }} onClick={() => setPricePoints((current) => [...current, { id: `point-${current.length}`, uomId: defaultSaleUomId || saleUomIds[0] || selectedBaseUomId, quantity: '', price: '', maxDiscount: '0' }])}>
                    {pricingMethod === 'assisted_pack' ? 'Add pack' : 'Add price'}
                  </button>
                </div>

                <div className="flex flex-col gap-3" style={{ marginTop: 12 }}>
                  {pricePoints.map((point, index) => (
                    <div key={point.id} className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_1fr_auto]">
                      <label style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                        Quantity
                        <input type="number" min="0.0001" step="0.0001" value={point.quantity} onChange={(event) => updatePricePoint(point.id, { quantity: event.target.value })} placeholder={pricingMethod === 'assisted_pack' ? 'Example: 6' : 'Example: 2'} style={{ ...inputStyle, marginTop: 6 }} />
                      </label>
                      <label style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                        Price ({currency})
                        <input type="number" min="0" step="0.01" value={point.price} onChange={(event) => updatePricePoint(point.id, { price: event.target.value })} placeholder={pricingMethod === 'assisted_pack' ? 'Pack price' : 'Exact price'} style={{ ...inputStyle, marginTop: 6 }} />
                      </label>
                      <label style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                        Max discount
                        <input type="number" min="0" step="0.01" value={point.maxDiscount} onChange={(event) => updatePricePoint(point.id, { maxDiscount: event.target.value })} placeholder={`Discount (${currency})`} style={{ ...inputStyle, marginTop: 6 }} />
                      </label>
                      <button type="button" className="btn-outline" style={{ padding: '8px 16px', borderRadius: 8 }} disabled={pricePoints.length === 1} onClick={() => setPricePoints((current) => current.filter((item) => item.id !== point.id))}>
                        {index === 0 && pricePoints.length === 1 ? 'Keep' : 'Remove'}
                      </button>
                    </div>
                  ))}
                </div>

                {pricingMethod === 'assisted_pack' && (
                  <div style={{ marginTop: 14 }}>
                    <label style={{ fontSize: 13 }}>
                      <span style={{ display: 'block', marginBottom: 6, fontWeight: 500 }}>Rounding</span>
                      <select value={roundingRule} onChange={(event) => setRoundingRule(event.target.value as RoundingRule)} style={inputStyle}>
                        <option value="nearest_5">Nearest 5</option>
                        <option value="up_5">Up to next 5</option>
                        <option value="down_5">Down to previous 5</option>
                        <option value="nearest_10">Nearest 10</option>
                        <option value="none">No rounding</option>
                      </select>
                    </label>

                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" style={{ marginTop: 12 }}>
                      {assistedPreviewRows.map((row) => (
                        <div key={row.quantity} style={{ border: '1px solid var(--color-border)', borderRadius: 8, padding: 10 }}>
                          <p style={{ margin: 0, fontSize: 12, color: 'var(--color-text-muted)' }}>{row.quantity} unit(s)</p>
                          <p style={{ margin: '4px 0 0', fontSize: 13, fontWeight: 700 }}>{row.price === null ? '-' : formatMoney(row.price, currency)}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
              <button type="submit" disabled={isPending} className="btn-primary" style={{ flex: 1, padding: '10px 20px', borderRadius: 8, opacity: isPending ? 0.8 : 1 }}>
                {isPending ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin h-4 w-4 text-white" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                    </svg>
                    Updating product...
                  </span>
                ) : (
                  'Save changes'
                )}
              </button>
              <button type="button" className="btn-outline" style={{ flex: 1, padding: '10px 20px', borderRadius: 8 }} onClick={onClose}>
                Cancel
              </button>
            </div>
          </div>
        </form>
      </Modal>

      <Modal isOpen={createUnitOpen} title="Create new unit" onClose={() => setCreateUnitOpen(false)}>
        <form onSubmit={onCreateUnitSubmit}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <label style={{ fontSize: 13 }}>
              <span style={{ display: 'block', marginBottom: 6, fontWeight: 500 }}>Unit name</span>
              <input value={newUnitName} onChange={(event) => setNewUnitName(event.target.value)} placeholder="Single, Tray of 30, 500g" required style={inputStyle} />
            </label>
            <label style={{ fontSize: 13 }}>
              <span style={{ display: 'block', marginBottom: 6, fontWeight: 500 }}>Abbreviation</span>
              <input value={newUnitAbbreviation} onChange={(event) => setNewUnitAbbreviation(event.target.value)} placeholder="single, tray30, 500g" required style={inputStyle} />
            </label>
            <label style={{ fontSize: 13 }}>
              <span style={{ display: 'block', marginBottom: 6, fontWeight: 500 }}>Conversion factor</span>
              <input type="number" min="0.0001" step="0.0001" value={newUnitFactor} onChange={(event) => setNewUnitFactor(event.target.value)} required style={inputStyle} />
              <span style={{ display: 'block', marginTop: 6, color: 'var(--color-text-muted)', fontSize: 12 }}>
                How many base units make one of this unit?
              </span>
            </label>
            <label className="flex items-center gap-2" style={{ fontSize: 13 }}>
              <input type="checkbox" checked={newUnitIsBase} onChange={(event) => setNewUnitIsBase(event.target.checked)} />
              This is the base unit for this business
            </label>
            <div style={{ border: '1px solid var(--color-border)', borderRadius: 8, padding: 12, color: 'var(--color-text-muted)', fontSize: 13 }}>
              {newUnitPreview}
            </div>
            <div className="flex gap-3">
              <button type="submit" disabled={uomPending} className="btn-primary" style={{ flex: 1, padding: '10px 20px', borderRadius: 8 }}>
                {uomPending ? 'Creating unit...' : 'Save unit'}
              </button>
              <button type="button" onClick={() => setCreateUnitOpen(false)} className="btn-outline" style={{ flex: 1, padding: '10px 20px', borderRadius: 8 }}>
                Cancel
              </button>
            </div>
          </div>
        </form>
      </Modal>
    </>
  )
}
