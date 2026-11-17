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
import { queueOfflineEmployeeSale } from '../../../../../lib/pwa/offlineEmployeeSales'
import { createClient } from '../../../../../lib/supabase/client'
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
  barcodes: string[]
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

type SplitPaymentMethod = 'cash' | 'mpesa_manual' | 'mpesa_stk' | 'pesapal'

/**
 * Props for the record transaction form.
 */
type Props = {
  products: EmployeeProductOption[]
  currency: string
  action?: RecordTransactionAction
  branchId?: string
  redirectPath?: string
  stayOnSuccess?: boolean
  submitLabel?: string
  pendingMessage?: string
  offlineQueueEnabled?: boolean
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

async function isRetivoxBackendReachable() {
  if (typeof navigator === 'undefined' || !navigator.onLine) return false
  try {
    const { error } = await createClient().from('businesses').select('id').limit(1)
    return !error
  } catch {
    return false
  }
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

const splitLabelStyle = {
  fontSize: 12,
  color: 'var(--color-text-primary)',
} as const

function getInitialLineItems(idSuffix = ''): LineItemDraft[] {
  return [
    {
      id: `row-1${idSuffix}`,
      optionId: '',
      uomId: '',
      quantity: '',
    },
  ]
}

/**
 * RecordEmployeeTransactionForm renders the web POS transaction form.
 */
export default function RecordEmployeeTransactionForm({
  products,
  currency,
  action: recordTransactionAction = recordEmployeeTransaction,
  branchId,
  redirectPath = '/dashboard/employee/transactions',
  stayOnSuccess = false,
  submitLabel = 'Record transaction',
  pendingMessage = 'Recording transaction...',
  offlineQueueEnabled = false,
}: Props) {
  const router = useRouter()
  const previousPending = useRef(false)
  const barcodeInputRef = useRef<HTMLInputElement>(null)
  const barcodeRowSequence = useRef(0)
  const [rows, setRows] = useState<LineItemDraft[]>(() => getInitialLineItems())
  const [scannerEnabled, setScannerEnabled] = useState(false)
  const [scannerSetupOpen, setScannerSetupOpen] = useState(false)
  const [barcodeInput, setBarcodeInput] = useState('')
  const [barcodeMessage, setBarcodeMessage] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<'mpesa_manual' | 'mpesa_stk' | 'pesapal' | 'cash' | 'card' | 'bank_transfer' | 'other'>('mpesa_manual')
  const [splitPaymentMode, setSplitPaymentMode] = useState(false)
  const [splitPayments, setSplitPayments] = useState<Array<{ id: string; paymentMethod: SplitPaymentMethod; amount: string; amountTendered: string; referenceCode: string }>>([])
  const [isCredit, setIsCredit] = useState(false)
  const [amountPaid, setAmountPaid] = useState('')
  const [amountTendered, setAmountTendered] = useState('')
  const [customerEmail, setCustomerEmail] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [discountAmount, setDiscountAmount] = useState('0')
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [mpesaRefCode, setMpesaRefCode] = useState('')
  const [paymentPhone, setPaymentPhone] = useState('')
  const [isOfflineSubmitting, setIsOfflineSubmitting] = useState(false)
  const [isBackendOnline, setIsBackendOnline] = useState(false)
  const [offlineDeductedByOption, setOfflineDeductedByOption] = useState<Map<string, number>>(() => new Map())
  const [state, action, isPending] = useActionState<EmployeeTransactionFormState, FormData>(recordTransactionAction, {
    success: false,
    error: null,
  })
  const { toast, toastState, dismiss } = useToast()
  const hasAdvancedPricing = products.some(
    (product) => product.pricingMethod !== 'fixed_price' || product.pricingOptions.length > 0,
  )

  useEffect(() => {
    let active = true
    const refreshConnection = async () => {
      const online = await isRetivoxBackendReachable()
      if (active) {
        setIsBackendOnline(online)
        if (!online) {
          setPaymentMethod((current) => ['cash', 'mpesa_manual'].includes(current) ? current : 'cash')
        }
      }
    }
    const handleNetworkChange = () => { void refreshConnection() }
    void refreshConnection()
    const timer = window.setInterval(() => { void refreshConnection() }, 15000)
    window.addEventListener('online', handleNetworkChange)
    window.addEventListener('offline', handleNetworkChange)
    return () => {
      active = false
      window.clearInterval(timer)
      window.removeEventListener('online', handleNetworkChange)
      window.removeEventListener('offline', handleNetworkChange)
    }
  }, [])
  const lineSummaries: LineDraftSummary[] = rows.map((row) => {
    const product = products.find((availableProduct) => availableProduct.optionId === row.optionId) ?? null
    const selectedUom = product?.uomOptions.find((uom) => uom.id === row.uomId) ?? getDefaultSaleUOM(product)
    const baseUom = getBaseUOM(product)
    const quantity = Number(row.quantity)
    const baseQuantity = getBaseQuantity(quantity, selectedUom)
    const pricing = product && baseQuantity ? resolvePreviewPricing(product, baseQuantity, selectedUom?.id ?? null) : null
    const availableBaseQuantity = product
      ? product.baseQuantityOnHand - product.baseQuantityReserved - (offlineDeductedByOption.get(product.optionId) ?? 0)
      : 0

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
  const splitPaidTotal = splitPayments.reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0)
  const effectivePaidNow = splitPaymentMode ? splitPaidTotal : Number(amountPaid || (isCredit ? 0 : totalPreview))
  const hasValidLine = lineSummaries.some((summary) => summary.product && summary.selectedUom && summary.quantity > 0)
  const canSubmit =
    !isPending &&
    !isOfflineSubmitting &&
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
        if (state.checkoutUrl) {
          window.location.assign(state.checkoutUrl)
          previousPending.current = isPending
          return
        }
        toast.success(state.message ?? 'Transaction recorded successfully')
        redirectTimer = setTimeout(() => {
          if (stayOnSuccess) {
            setRows(getInitialLineItems(`-${Date.now()}`))
            setDiscountAmount('0')
            setCustomerName('')
            setCustomerPhone('')
            setMpesaRefCode('')
            setPaymentPhone('')
            setSplitPayments([])
            setSplitPaymentMode(false)
          } else {
            router.push(redirectPath)
          }
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
  }, [isPending, products, redirectPath, router, state.checkoutUrl, state.error, state.message, state.success, stayOnSuccess, toast])

  useEffect(() => {
    const refreshAfterSync = () => router.refresh()
    window.addEventListener('retivox:offline-sales-synced', refreshAfterSync)
    return () => window.removeEventListener('retivox:offline-sales-synced', refreshAfterSync)
  }, [router])

  /**
   * Updates one line item draft field.
   */
  const updateRow = (rowId: string, field: keyof Omit<LineItemDraft, 'id'>, value: string) => {
    setRows((currentRows) =>
      currentRows.map((row) => (row.id === rowId ? { ...row, [field]: value } : row))
    )
  }

  const handleBarcodeScan = (code: string) => {
    const normalized = code.trim().toUpperCase()
    if (!normalized) return
    const match = products.find((product) => product.barcodes.some((barcode) => barcode.trim().toUpperCase() === normalized))
    setBarcodeInput('')
    window.requestAnimationFrame(() => barcodeInputRef.current?.focus())
    if (!match) {
      setBarcodeMessage(`No product is linked to barcode ${code.trim()}.`)
      return
    }
    const defaultUomId = getDefaultSaleUOM(match)?.id ?? ''
    const newRowId = `barcode-${Date.now()}-${barcodeRowSequence.current++}`
    setRows((currentRows) => {
      const existingRow = currentRows.find(
        (row) => row.optionId === match.optionId && row.uomId === defaultUomId,
      )
      if (existingRow) {
        return currentRows.map((row) => row.id === existingRow.id
          ? { ...row, quantity: String((Number(row.quantity) || 0) + 1) }
          : row)
      }

      const emptyRow = currentRows.find((row) => !row.optionId || !row.uomId)
      if (emptyRow) {
        return currentRows.map((row) => row.id === emptyRow.id
          ? { ...row, optionId: match.optionId, uomId: defaultUomId, quantity: '1' }
          : row)
      }

      return [...currentRows, {
        id: newRowId,
        optionId: match.optionId,
        uomId: defaultUomId,
        quantity: '1',
      }]
    })
    setBarcodeMessage(`${match.name} added to the sale.`)
  }

  /**
   * Adds another product row.
   */
  const addRow = () => {
    setRows((currentRows) => [
      ...currentRows,
      {
        id: `row-${currentRows.length + 1}-${Date.now()}`,
        optionId: '',
        uomId: '',
        quantity: '',
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
  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const backendOnline = await isRetivoxBackendReachable()
    setIsBackendOnline(backendOnline)
    if (!backendOnline && splitPaymentMode) {
      toast.error('Split tender needs a live connection. Offline sales remain available with one cash or mobile manual payment.')
      return
    }
    if (!backendOnline && paymentMethod !== 'cash' && paymentMethod !== 'mpesa_manual') {
      toast.error('This payment method needs a live internet connection. Use cash or mobile manual while offline.')
      return
    }
    if (!backendOnline && !offlineQueueEnabled) {
      toast.error('Retivox is not reachable. Reconnect before recording this sale.')
      return
    }

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

    const saleItems = rows
      .map((row) => ({
        row,
        product: products.find((product) => product.optionId === row.optionId) ?? null,
      }))
      .filter(({ row, product }) => product && row.uomId && Number(row.quantity) > 0)
      .map(({ row, product }) => ({
        productId: product?.productId ?? '',
        uomId: row.uomId,
        quantity: Number(row.quantity),
        recoveryItemId: product?.stockSource === 'recovery' ? product.recoveryItemId : null,
      }))

    if (!backendOnline && offlineQueueEnabled) {
      if (paymentMethod !== 'cash' && paymentMethod !== 'mpesa_manual') {
        toast.error('Online payment prompts cannot be queued as offline payments.')
        return
      }
      const offlinePaymentMethod: 'cash' | 'mpesa_manual' = paymentMethod
      setIsOfflineSubmitting(true)

      void (async () => {
        try {
          const { data } = await createClient().auth.getSession()
          const userId = data.session?.user.id

          if (!userId) {
            toast.error('Connect once to restore your secure Retivox session before recording offline sales.')
            return
          }

          await queueOfflineEmployeeSale({
            userId,
            items: saleItems,
            paymentMethod: offlinePaymentMethod,
            amountPaid: isCredit ? Number(amountPaid || 0) : null,
            amountTendered: paymentMethod === 'cash' ? Number(amountTendered || (isCredit ? amountPaid : totalPreview)) : null,
            isCredit,
            discountAmount: safeDiscountValue,
            customerName: customerName.trim() || null,
            customerPhone: customerPhone.trim() || null,
            customerEmail: customerEmail.trim() || null,
            dueDate: dueDate || null,
            mpesaRefCode: mpesaRefCode.trim() || null,
            recordedAt: new Date().toISOString(),
          })

          setOfflineDeductedByOption((current) => {
            const next = new Map(current)
            lineSummaries.forEach((summary) => {
              if (summary.product && summary.baseQuantity) {
                next.set(summary.product.optionId, (next.get(summary.product.optionId) ?? 0) + summary.baseQuantity)
              }
            })
            return next
          })
          setRows(getInitialLineItems(`-offline-${Date.now()}`))
          setDiscountAmount('0')
          setCustomerName('')
          setCustomerPhone('')
          setMpesaRefCode('')
          setAmountPaid('')
          setAmountTendered('')
          toast.success('Sale saved on this device. It will sync automatically when you are online.')
        } catch {
          toast.error('Unable to save this sale offline. Check your device storage and try again.')
        } finally {
          setIsOfflineSubmitting(false)
        }
      })()
      return
    }

    const formData = new FormData()
    if (branchId) {
      formData.set('branchId', branchId)
    }
    formData.set(
      'itemsJson',
      JSON.stringify(saleItems)
    )
    formData.set('paymentMethod', paymentMethod)
    formData.set('amountPaid', isCredit ? amountPaid || '0' : String(totalPreview))
    formData.set('amountTendered', paymentMethod === 'cash' ? amountTendered || (isCredit ? amountPaid : String(totalPreview)) : '')
    formData.set('isCredit', String(isCredit))
    formData.set('discountAmount', discountAmount)
    formData.set('customerName', customerName)
    formData.set('customerPhone', customerPhone)
    formData.set('customerEmail', customerEmail)
    formData.set('dueDate', dueDate)
    formData.set('mpesaRefCode', mpesaRefCode)
    formData.set('paymentPhone', paymentPhone)
    formData.set('splitPaymentsJson', splitPaymentMode ? JSON.stringify(splitPayments.map((payment) => ({
      paymentMethod: payment.paymentMethod,
      amount: payment.amount,
      amountTendered: payment.amountTendered,
      referenceCode: payment.referenceCode,
    }))) : '')

    startTransition(() => {
      action(formData)
    })
  }

  return (
    <>
      {(isPending || isOfflineSubmitting) && <LoadingOverlay message={isOfflineSubmitting ? 'Saving sale offline...' : pendingMessage} />}
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

        <section
          className="rounded-xl border text-left"
          aria-label="Barcode scanner"
          style={{ borderColor: scannerEnabled ? 'var(--color-primary)' : 'var(--color-border)', backgroundColor: 'var(--color-surface)', padding: 14 }}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p style={{ margin: 0, fontSize: 14, fontWeight: 800, color: 'var(--color-text-primary)' }}>Barcode scanner</p>
              <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--color-text-muted)' }}>
                Scan a product to add it to this sale. Scan it again to increase the quantity.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={scannerEnabled ? 'btn-outline' : 'btn-primary'}
                aria-pressed={scannerEnabled}
                onClick={() => {
                  if (scannerEnabled) {
                    setScannerEnabled(false)
                    setBarcodeInput('')
                  } else {
                    setScannerEnabled(true)
                    window.requestAnimationFrame(() => barcodeInputRef.current?.focus())
                  }
                }}
                style={{ padding: '8px 14px', borderRadius: 8, fontSize: 13 }}
              >
                {scannerEnabled ? 'Stop scanner' : 'Use scanner'}
              </button>
              <button
                type="button"
                className="btn-outline"
                aria-expanded={scannerSetupOpen}
                onClick={() => setScannerSetupOpen((open) => !open)}
                style={{ padding: '8px 14px', borderRadius: 8, fontSize: 13 }}
              >
                {scannerSetupOpen ? 'Close setup' : 'Scanner setup'}
              </button>
            </div>
          </div>

          {scannerSetupOpen && (
            <div
              className="mt-3 rounded-lg border"
              style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-background)', padding: 12, color: 'var(--color-text-primary)', fontSize: 12, lineHeight: 1.6 }}
            >
              <p style={{ margin: '0 0 6px', fontWeight: 800 }}>Set up a USB or Bluetooth scanner</p>
              <ol style={{ margin: 0, paddingLeft: 20 }}>
                <li>Connect the scanner to this computer. Keyboard-style scanners work without a browser permission prompt.</li>
                <li>Configure the scanner to send <strong>Enter</strong> after each barcode.</li>
                <li>Select <strong>Use scanner</strong>, then scan a barcode saved on the product.</li>
              </ol>
              <p style={{ margin: '6px 0 0', color: 'var(--color-text-muted)' }}>
                A successful scan adds one sale unit using the product&apos;s default sale unit. The sale is only recorded when you submit this form.
              </p>
            </div>
          )}

          {scannerEnabled && (
            <label className="mt-3 flex flex-col gap-2" style={{ fontSize: 13, color: 'var(--color-text-primary)' }}>
              Ready to scan
              <input
                ref={barcodeInputRef}
                value={barcodeInput}
                onChange={(event) => { setBarcodeInput(event.target.value); setBarcodeMessage('') }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    handleBarcodeScan(barcodeInput)
                  }
                }}
                autoComplete="off"
                autoFocus
                aria-label="Scan product barcode"
                placeholder="Scan a product barcode"
                style={inputStyle}
              />
              {barcodeMessage && (
                <span aria-live="polite" style={{ color: barcodeMessage.startsWith('No product') ? 'var(--color-danger)' : 'var(--color-text-muted)', fontSize: 12 }}>
                  {barcodeMessage}
                </span>
              )}
            </label>
          )}
        </section>

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
              ? selectedProduct.baseQuantityOnHand - selectedProduct.baseQuantityReserved - (offlineDeductedByOption.get(selectedProduct.optionId) ?? 0)
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
                      <option value="">Select product</option>
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
        <label className="flex items-center gap-2" style={{ fontSize: 13, color: 'var(--color-text-primary)' }}>
          <input type="checkbox" checked={splitPaymentMode} onChange={(event) => {
            const enabled = event.target.checked
            setSplitPaymentMode(enabled)
            if (enabled) {
              const splitInitialMethod: SplitPaymentMethod = paymentMethod === 'card' || paymentMethod === 'bank_transfer' ? 'pesapal' : paymentMethod === 'other' ? 'cash' : paymentMethod
              setSplitPayments([{ id: `tender-${Date.now()}`, paymentMethod: splitInitialMethod, amount: isCredit ? amountPaid : String(totalPreview), amountTendered: isCredit ? amountPaid : String(totalPreview), referenceCode: mpesaRefCode }])
            }
          }} />
          Split this sale across cash, mobile manual, M-Pesa prompt, or Pesapal checkout
        </label>

        {splitPaymentMode ? (
          <section className="flex flex-col gap-3 rounded-xl border" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)', padding: 14 }}>
            <div className="flex flex-wrap items-center justify-between gap-2"><strong style={{ color: 'var(--color-text-primary)', fontSize: 14 }}>Payment split</strong><span style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>Cash and Mobile manual work offline. Provider checkouts need an active connection.</span></div>
            {splitPayments.map((payment, index) => <div key={payment.id} className="grid grid-cols-1 gap-2 rounded-lg border p-3 md:grid-cols-[1fr_1fr_1fr_1fr_auto]" style={{ borderColor: 'var(--color-border)', background: 'var(--color-background)' }}>
              <label className="flex flex-col gap-1" style={splitLabelStyle}>Method<select value={payment.paymentMethod} onChange={(event) => setSplitPayments((current) => current.map((row) => row.id === payment.id ? { ...row, paymentMethod: event.target.value as SplitPaymentMethod } : row))} style={inputStyle}><option value="cash">Cash</option><option value="mpesa_manual">Mobile manual</option><option value="mpesa_stk" disabled={!isBackendOnline}>M-Pesa prompt{!isBackendOnline ? ' (online only)' : ''}</option><option value="pesapal" disabled={!isBackendOnline}>Card / bank via Pesapal{!isBackendOnline ? ' (online only)' : ''}</option></select></label>
              <label className="flex flex-col gap-1" style={splitLabelStyle}>Amount applied<input type="number" min="0.01" step="0.01" value={payment.amount} onChange={(event) => setSplitPayments((current) => current.map((row) => row.id === payment.id ? { ...row, amount: event.target.value, amountTendered: row.paymentMethod === 'cash' && !row.amountTendered ? event.target.value : row.amountTendered } : row))} style={inputStyle} /></label>
              {payment.paymentMethod === 'cash' ? <label className="flex flex-col gap-1" style={splitLabelStyle}>Cash received<input type="number" min={Number(payment.amount) || 0} step="0.01" value={payment.amountTendered} onChange={(event) => setSplitPayments((current) => current.map((row) => row.id === payment.id ? { ...row, amountTendered: event.target.value } : row))} style={inputStyle} /></label> : payment.paymentMethod === 'mpesa_manual' ? <label className="flex flex-col gap-1" style={splitLabelStyle}>Mobile reference<input value={payment.referenceCode} onChange={(event) => setSplitPayments((current) => current.map((row) => row.id === payment.id ? { ...row, referenceCode: event.target.value.toUpperCase() } : row))} required minLength={5} style={inputStyle} /></label> : <div className="self-end pb-2" style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>{payment.paymentMethod === 'mpesa_stk' ? 'Prompt sent to customer phone below' : 'Customer completes a secure hosted checkout'}</div>}
              {payment.paymentMethod === 'cash' ? <div className="self-end pb-2" style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>Change {formatMoney(Math.max(0, Number(payment.amountTendered || payment.amount) - Number(payment.amount || 0)), currency)}</div> : payment.paymentMethod === 'mpesa_manual' ? <div className="self-end pb-2" style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>Reference required</div> : <div className="self-end pb-2" style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>Provider confirms the exact split amount</div>}
              <button type="button" className="btn-outline" aria-label={`Remove payment ${index + 1}`} disabled={splitPayments.length === 1 && !isCredit} onClick={() => setSplitPayments((current) => current.filter((row) => row.id !== payment.id))} style={{ alignSelf: 'end', borderRadius: 8, padding: '8px 10px' }}>Remove</button>
            </div>)}
            {splitPayments.some((payment) => payment.paymentMethod === 'mpesa_stk') && <label className="flex flex-col gap-1" style={splitLabelStyle}>Customer phone for M-Pesa prompt<input type="tel" inputMode="tel" value={paymentPhone} onChange={(event) => setPaymentPhone(event.target.value)} required pattern="^(?:\\+?254|0)?[17]\\d{8}$" placeholder="0712345678" style={inputStyle} /></label>}
            <div className="flex flex-wrap items-center justify-between gap-2"><button type="button" className="btn-outline" disabled={splitPayments.length >= 8} onClick={() => setSplitPayments((current) => [...current, { id: `tender-${Date.now()}-${current.length}`, paymentMethod: 'cash', amount: '', amountTendered: '', referenceCode: '' }])} style={{ borderRadius: 8, padding: '8px 12px' }}>Add payment method</button><span style={{ color: 'var(--color-text-primary)', fontSize: 13, fontWeight: 750 }}>Applied {formatMoney(splitPaidTotal, currency)} · Outstanding {formatMoney(Math.max(0, totalPreview - splitPaidTotal), currency)}</span></div>
            {!isCredit && splitPaidTotal !== totalPreview && <p style={{ margin: 0, color: 'var(--color-warning)', fontSize: 12 }}>A non-credit sale must be paid in full. Adjust the tender amounts or record a credit sale.</p>}
            {!isBackendOnline && <p style={{ margin: 0, color: 'var(--color-danger)', fontSize: 12 }}>Split payments require an active Retivox connection. Use a single tender while offline.</p>}
          </section>
        ) : null}

        {(!splitPaymentMode || isCredit || splitPayments.some((payment) => payment.paymentMethod === 'pesapal')) && <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-2 text-left" style={{ fontSize: 13, color: 'var(--color-text-primary)' }}>
            Customer name {isCredit ? 'required for credit' : 'optional'}
            <input value={customerName} onChange={(event) => setCustomerName(event.target.value)} style={inputStyle} />
          </label>
          <label className="flex flex-col gap-2 text-left" style={{ fontSize: 13, color: 'var(--color-text-primary)' }}>
            Customer phone {isCredit ? 'required for credit' : 'optional'}
            <input
              type="tel"
              inputMode="tel"
              pattern="^(?:\+?254|0)?[17]\d{8}$"
              title="Use a Kenyan mobile number like 0712345678 or +254712345678"
              value={customerPhone}
              onChange={(event) => {
                const nextValue = event.target.value.replace(/[^\d+]/g, '').replace(/(?!^)\+/g, '').slice(0, 13)
                setCustomerPhone(nextValue)
              }}
              placeholder="0712345678"
              style={inputStyle}
            />
          </label>
          <label className="flex flex-col gap-2 text-left" style={{ fontSize: 13, color: 'var(--color-text-primary)' }}>
            Customer email (optional)
            <input type="email" value={customerEmail} onChange={(event) => setCustomerEmail(event.target.value)} style={inputStyle} />
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
          {!splitPaymentMode && <label className="flex flex-col gap-2 text-left" style={{ fontSize: 13, color: 'var(--color-text-primary)' }}>
            Payment method for amount received
            <select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as typeof paymentMethod)} style={inputStyle}>
              <option value="mpesa_manual">Mobile manual</option>
              <option value="mpesa_stk" disabled={!isBackendOnline}>M-Pesa prompt{!isBackendOnline ? ' (online only)' : ''}</option>
              <option value="pesapal" disabled={!isBackendOnline}>Card, bank or hosted checkout{!isBackendOnline ? ' (online only)' : ''}</option>
              <option value="cash">Cash</option>
            </select>
          </label>}
        </div>}

        <label className="flex items-center gap-2" style={{ fontSize: 13, color: 'var(--color-text-primary)' }}>
          <input type="checkbox" checked={isCredit} onChange={(event) => setIsCredit(event.target.checked)} />
          Record this as a credit sale
        </label>

        {isCredit ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-2 text-left" style={{ fontSize: 13, color: 'var(--color-text-primary)' }}>
              Amount paid now
              {splitPaymentMode ? <span style={{ ...inputStyle, display: 'block', paddingTop: 10 }}>{formatMoney(splitPaidTotal, currency)}</span> : <input type="number" min="0" max={totalPreview} step="0.01" value={amountPaid} onChange={(event) => setAmountPaid(event.target.value)} style={inputStyle} />}
              <span style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>Outstanding balance: {formatMoney(Math.max(0, totalPreview - effectivePaidNow), currency)}</span>
            </label>
            <label className="flex flex-col gap-2 text-left" style={{ fontSize: 13, color: 'var(--color-text-primary)' }}>
              Expected payment date
              <input type="date" min={new Date().toISOString().slice(0, 10)} value={dueDate} onChange={(event) => setDueDate(event.target.value)} style={inputStyle} />
            </label>
          </div>
        ) : null}

        {!splitPaymentMode && paymentMethod === 'cash' ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-2 text-left" style={{ fontSize: 13, color: 'var(--color-text-primary)' }}>
              Cash received
              <input type="number" min={isCredit ? Number(amountPaid || 0) : totalPreview} step="0.01" value={amountTendered} onChange={(event) => setAmountTendered(event.target.value)} placeholder={String(isCredit ? amountPaid || 0 : totalPreview)} style={inputStyle} />
            </label>
            <div style={{ alignSelf: 'end', color: 'var(--color-text-muted)', fontSize: 13, padding: 12 }}>
              Change to give: {formatMoney(Math.max(0, Number(amountTendered || (isCredit ? amountPaid : totalPreview)) - (isCredit ? Number(amountPaid || 0) : totalPreview)), currency)}
            </div>
          </div>
        ) : null}

        {/* Payment reference fields */}
        {!splitPaymentMode && paymentMethod === 'mpesa_stk' ? (
          <label className="flex flex-col gap-2 text-left" style={{ fontSize: 13, color: 'var(--color-text-primary)' }}>
            Customer phone for M-Pesa prompt
            <input type="tel" inputMode="tel" autoComplete="tel" value={paymentPhone} onChange={(event) => setPaymentPhone(event.target.value)} placeholder="0712345678" required pattern="^(?:\\+?254|0)?[17]\\d{8}$" title="Enter a Kenyan mobile number such as 0712345678" style={inputStyle} />
            <span style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>The sale remains pending until Safaricom confirms the exact amount and phone number.</span>
          </label>
        ) : null}

        {!splitPaymentMode && paymentMethod === 'pesapal' ? (
          <p style={{ margin: 0, borderRadius: 10, padding: 12, background: 'var(--color-surface)', color: 'var(--color-text-muted)', fontSize: 12, lineHeight: 1.55 }}>
            The customer will complete payment on Pesapal&apos;s hosted page. Enter a customer phone number or email above; Retivox verifies the payment directly with Pesapal before confirming the sale.
          </p>
        ) : null}

        {!splitPaymentMode && paymentMethod !== 'cash' && paymentMethod !== 'mpesa_stk' && paymentMethod !== 'pesapal' && (paymentMethod !== 'mpesa_manual' || !isCredit || Number(amountPaid) > 0) ? (
          <label className="flex flex-col gap-2 text-left" style={{ fontSize: 13, color: 'var(--color-text-primary)' }}>
            {paymentMethod === 'mpesa_manual' ? 'Mobile payment reference code' : 'Payment reference (optional)'}
            <input value={mpesaRefCode} onChange={(event) => setMpesaRefCode(event.target.value)} required={paymentMethod === 'mpesa_manual'} style={inputStyle} />
          </label>
        ) : null}

        {!splitPaymentMode && paymentMethod !== 'cash' && paymentMethod !== 'mpesa_manual' && paymentMethod !== 'mpesa_stk' && paymentMethod !== 'pesapal' ? (
          <div
            className="rounded-xl border text-left"
            style={{
              borderColor: 'var(--color-border)',
              backgroundColor: 'var(--color-surface)',
              color: 'var(--color-text-muted)',
              fontSize: 13,
              padding: 14,
            }}
          >
            {paymentMethod === 'card' ? 'Card payments are manually recorded; payment terminal integration can be added later.' : paymentMethod === 'bank_transfer' ? 'Bank transfers are manually recorded; bank API integration can be added later.' : 'This payment is manually recorded without a provider reference.'}
          </div>
        ) : null}

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
          {isPending || isOfflineSubmitting ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="h-4 w-4 animate-spin text-white" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
              </svg>
              {isOfflineSubmitting ? 'Saving sale offline...' : pendingMessage}
            </span>
          ) : (
            submitLabel
          )}
        </button>
      </form>
    </>
  )
}
