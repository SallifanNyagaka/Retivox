/**
 * Employee Supabase data access for Retivox mobile.
 *
 * Mirrors the employee web portal by using the same RPCs for sale products,
 * damaged stock reporting, and transaction recording.
 */

import { supabase } from '../supabase/client'
import { withTimeout } from '../../utils/asyncTimeout'
import { getConnectivityState } from '../network/connectivity'
import { enqueueSyncItem } from '../sync/queue'
import {
  appendOfflineEmployeeTransaction,
  createOfflineTransactionId,
  mergeEmployeeSnapshot,
  readEmployeeSnapshot,
  readEmployeeSnapshotByBranch,
} from '../offline/employeeSnapshot'

export type PricingMethod = 'fixed_price' | 'assisted_pack' | 'manual_quantity'
export type RoundingRule = 'none' | 'nearest_5' | 'up_5' | 'down_5' | 'nearest_10'
export type StockSource = 'normal' | 'recovery'
export type PaymentMethod = 'mpesa_manual' | 'cash'
export type LossType = 'breakage' | 'spoilage' | 'theft' | 'markdown_damage' | 'other'

export type UomOption = {
  id: string
  name: string
  abbreviation: string
  conversionFactor: number
  isBaseUnit: boolean
  isBaseUom: boolean
  isDefaultSaleUom: boolean
  isDefaultPurchaseUom: boolean
}

export type PricingOption = {
  quantity: number
  baseQuantity: number
  price: number
  maxDiscountAmount: number
  uomId: string | null
}

export type EmployeeProductOption = {
  optionId: string
  productId: string
  name: string
  sku: string
  category: string
  unit: string
  sellingPrice: number
  pricingMethod: PricingMethod
  roundingRule: RoundingRule
  pricingOptions: PricingOption[]
  uomOptions: UomOption[]
  quantityOnHand: number
  quantityReserved: number
  baseQuantityOnHand: number
  baseQuantityReserved: number
  recoveryItemId: string | null
  stockSource: StockSource
}

export type DamageReportProductOption = {
  productId: string
  name: string
  sku: string
  category: string
  baseQuantityAvailable: number
  uomOptions: UomOption[]
}

export type EmployeeTransaction = {
  id: string
  status: string
  totalAmount: number
  recordedAt: string
}

export type EmployeeDashboardData = {
  currency: string
  todayTransactions: EmployeeTransaction[]
  recentTransactions: EmployeeTransaction[]
  products: EmployeeProductOption[]
  damageProducts: DamageReportProductOption[]
}

export type RecordTransactionPayload = {
  items: Array<{
    productId: string
    uomId: string
    quantity: number
    recoveryItemId: string | null
  }>
  paymentMethod: PaymentMethod
  discountAmount: number
  customerName: string
  customerPhone: string
  mpesaRefCode: string
  cashDepositCode?: string
}

export type DamageReportPayload = {
  productId: string
  uomId: string
  quantity: number
  lossType: LossType
  reason: string
}

export type RecordTransactionContext = {
  businessId: string
  branchId: string
  employeeId: string
  products: EmployeeProductOption[]
  subtotal: number
  totalAmount: number
}

export type RecordTransactionResult = {
  queued: boolean
  localId?: string
  serverId?: string
}

type EmployeeAvailableProductRow = {
  product_id: string
  name: string
  sku: string | null
  category: string | null
  unit: string | null
  selling_price: number | string | null
  pricing_method?: PricingMethod | null
  rounding_rule?: RoundingRule | null
  pricing_options?: unknown
  uom_options?: unknown
  quantity_on_hand: number | string | null
  quantity_reserved: number | string | null
  base_quantity_on_hand?: number | string | null
  base_quantity_reserved?: number | string | null
  recovery_item_id?: string | null
  stock_source?: StockSource | null
}

type DamageReportProductRow = {
  product_id: string
  name: string
  sku: string | null
  category: string | null
  base_quantity_available: number | string | null
  uom_options?: unknown
}

type TransactionRow = {
  id: string
  status: string
  total_amount: number | string | null
  recorded_at: string
}

type BusinessCurrencyRow = {
  currency: string | null
}

/**
 * Converts unknown values into finite numbers.
 *
 * @param value - Unknown numeric value.
 * @param fallback - Number to return when conversion fails.
 * @returns Numeric value.
 */
function toNumber(value: unknown, fallback = 0): number {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

/**
 * Converts an unknown JSON value into UOM options.
 *
 * @param value - RPC JSON value.
 * @returns Normalized UOM options.
 */
function mapUomOptions(value: unknown): UomOption[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((option) => {
      const row = option as Record<string, unknown>
      return {
        id: String(row.id ?? ''),
        name: String(row.name ?? 'Unit'),
        abbreviation: String(row.abbreviation ?? ''),
        conversionFactor: toNumber(row.conversionFactor, 1),
        isBaseUnit: Boolean(row.isBaseUnit),
        isBaseUom: Boolean(row.isBaseUom),
        isDefaultSaleUom: Boolean(row.isDefaultSaleUom),
        isDefaultPurchaseUom: Boolean(row.isDefaultPurchaseUom),
      }
    })
    .filter((option) => option.id.length > 0 && option.conversionFactor > 0)
}

/**
 * Converts an unknown JSON value into pricing options.
 *
 * @param value - RPC JSON value.
 * @param saleUomIds - UOM ids allowed for this product.
 * @returns Normalized pricing options.
 */
function mapPricingOptions(value: unknown, saleUomIds: Set<string>): PricingOption[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((option) => {
      const row = option as Record<string, unknown>
      const uomId = typeof row.uomId === 'string' ? row.uomId : null

      return {
        quantity: toNumber(row.quantity ?? row.baseQuantity),
        baseQuantity: toNumber(row.baseQuantity ?? row.quantity),
        price: toNumber(row.price),
        maxDiscountAmount: toNumber(row.maxDiscountAmount),
        uomId,
      }
    })
    .filter((option) => (!option.uomId || saleUomIds.has(option.uomId)) && option.baseQuantity > 0)
}

/**
 * Maps an employee sale product RPC row.
 *
 * @param row - RPC row.
 * @returns Product option used by forms.
 */
export function mapEmployeeProductOption(row: EmployeeAvailableProductRow): EmployeeProductOption {
  const uomOptions = mapUomOptions(row.uom_options)
  const saleUomIds = new Set(uomOptions.map((option) => option.id))
  const recoveryItemId = row.recovery_item_id ?? null

  const stockSource: StockSource = row.stock_source === 'recovery' || Boolean(recoveryItemId) ? 'recovery' : 'normal'

  return {
    optionId: recoveryItemId ? `recovery:${recoveryItemId}` : `normal:${row.product_id}`,
    productId: row.product_id,
    name: row.name,
    sku: row.sku ?? '',
    category: row.category ?? '',
    unit: row.unit ?? 'Unit',
    sellingPrice: toNumber(row.selling_price),
    pricingMethod: row.pricing_method ?? 'fixed_price',
    roundingRule: row.rounding_rule ?? 'nearest_5',
    pricingOptions: mapPricingOptions(row.pricing_options, saleUomIds),
    uomOptions,
    quantityOnHand: toNumber(row.quantity_on_hand),
    quantityReserved: toNumber(row.quantity_reserved),
    baseQuantityOnHand: toNumber(row.base_quantity_on_hand ?? row.quantity_on_hand),
    baseQuantityReserved: toNumber(row.base_quantity_reserved ?? row.quantity_reserved),
    recoveryItemId,
    stockSource,
  }
}

/**
 * Maps a damaged-stock product RPC row.
 *
 * @param row - RPC row.
 * @returns Damage report product option.
 */
function mapDamageReportProductOption(row: DamageReportProductRow): DamageReportProductOption {
  return {
    productId: row.product_id,
    name: row.name,
    sku: row.sku ?? '',
    category: row.category ?? '',
    baseQuantityAvailable: toNumber(row.base_quantity_available),
    uomOptions: mapUomOptions(row.uom_options),
  }
}

/**
 * Maps a transaction row into mobile shape.
 *
 * @param row - Transaction row.
 * @returns Mobile transaction.
 */
function mapTransaction(row: TransactionRow): EmployeeTransaction {
  return {
    id: row.id,
    status: row.status,
    totalAmount: toNumber(row.total_amount),
    recordedAt: row.recorded_at,
  }
}

/**
 * Loads employee dashboard data.
 *
 * @param businessId - Current business id.
 * @param branchId - Assigned branch id.
 * @param employeeId - Current employee id.
 * @returns Dashboard data.
 */
export async function fetchEmployeeDashboardData(
  businessId: string,
  branchId: string,
  employeeId: string,
): Promise<EmployeeDashboardData> {
  const connectivity = await getConnectivityState().catch(() => ({ isOnline: false, connectionType: null }))
  if (!connectivity.isOnline) {
    const cached = await readEmployeeSnapshot(businessId, employeeId)
    if (cached) return cached
  }

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  try {
    const [businessResponse, todayResponse, recentResponse, productsResponse] = await Promise.all([
      supabase.from('businesses').select('currency').eq('id', businessId).single(),
      supabase
        .from('transactions')
        .select('id, status, total_amount, recorded_at')
        .eq('business_id', businessId)
        .eq('branch_id', branchId)
        .eq('employee_id', employeeId)
        .gte('recorded_at', today.toISOString())
        .order('recorded_at', { ascending: false })
        .range(0, 49),
      supabase
        .from('transactions')
        .select('id, status, total_amount, recorded_at')
        .eq('business_id', businessId)
        .eq('branch_id', branchId)
        .eq('employee_id', employeeId)
        .order('recorded_at', { ascending: false })
        .range(0, 19),
      supabase.rpc('employee_available_products', { p_branch_id: branchId }),
    ])

    if (businessResponse.error) throw businessResponse.error
    if (todayResponse.error) throw todayResponse.error
    if (recentResponse.error) throw recentResponse.error
    if (productsResponse.error) throw productsResponse.error

    const business = businessResponse.data as BusinessCurrencyRow | null
    const data: EmployeeDashboardData = {
      currency: business?.currency ?? 'KES',
      todayTransactions: ((todayResponse.data ?? []) as TransactionRow[]).map(mapTransaction),
      recentTransactions: ((recentResponse.data ?? []) as TransactionRow[]).map(mapTransaction),
      products: ((productsResponse.data ?? []) as EmployeeAvailableProductRow[]).map(mapEmployeeProductOption),
      damageProducts: [],
    }

    await mergeEmployeeSnapshot(
      { businessId, branchId, employeeId },
      { currency: data.currency, todayTransactions: data.todayTransactions, recentTransactions: data.recentTransactions, transactions: data.recentTransactions, products: data.products },
    )

    return data
  } catch (error) {
    const cached = await readEmployeeSnapshot(businessId, employeeId)
    if (cached) return cached
    throw error
  }
}

/**
 * Loads sale product options for the employee branch.
 *
 * @param branchId - Assigned branch id.
 * @returns Product options.
 */
export async function fetchEmployeeSaleProducts(branchId: string, employeeId?: string, businessId?: string): Promise<EmployeeProductOption[]> {
  const connectivity = await getConnectivityState().catch(() => ({ isOnline: false, connectionType: null }))
  if (!connectivity.isOnline) {
    const cached = employeeId && businessId
      ? await readEmployeeSnapshot(businessId, employeeId)
      : await readEmployeeSnapshotByBranch(branchId)
    if (cached) return cached.products
  }

  try {
    const { data, error } = await supabase.rpc('employee_available_products', { p_branch_id: branchId })

    if (error) throw error

    const products = ((data ?? []) as EmployeeAvailableProductRow[]).map(mapEmployeeProductOption)
    if (employeeId && businessId) await mergeEmployeeSnapshot({ businessId, branchId, employeeId }, { products })
    return products
  } catch (error) {
    const cached = employeeId && businessId
      ? await readEmployeeSnapshot(businessId, employeeId)
      : await readEmployeeSnapshotByBranch(branchId)
    if (cached) return cached.products
    throw error
  }
}

/**
 * Loads products available for employee damage reporting.
 *
 * @param branchId - Assigned branch id.
 * @returns Product options.
 */
export async function fetchEmployeeDamageReportProducts(branchId: string, employeeId?: string, businessId?: string): Promise<DamageReportProductOption[]> {
  const connectivity = await getConnectivityState().catch(() => ({ isOnline: false, connectionType: null }))
  if (!connectivity.isOnline) {
    const cached = employeeId && businessId
      ? await readEmployeeSnapshot(businessId, employeeId)
      : await readEmployeeSnapshotByBranch(branchId)
    if (cached) return cached.damageProducts
  }

  try {
    const { data, error } = await supabase.rpc('employee_damage_report_products', { p_branch_id: branchId })

    if (error) throw error

    const products = ((data ?? []) as DamageReportProductRow[]).map(mapDamageReportProductOption)
    if (employeeId && businessId) await mergeEmployeeSnapshot({ businessId, branchId, employeeId }, { damageProducts: products })
    return products
  } catch (error) {
    const cached = employeeId && businessId
      ? await readEmployeeSnapshot(businessId, employeeId)
      : await readEmployeeSnapshotByBranch(branchId)
    if (cached) return cached.damageProducts
    throw error
  }
}

/**
 * Loads employee-owned transactions.
 *
 * @param businessId - Current business id.
 * @param branchId - Assigned branch id.
 * @param employeeId - Current employee id.
 * @returns Transactions.
 */
export async function fetchEmployeeTransactions(
  businessId: string,
  branchId: string,
  employeeId: string,
): Promise<EmployeeTransaction[]> {
  const connectivity = await getConnectivityState().catch(() => ({ isOnline: false, connectionType: null }))
  if (!connectivity.isOnline) {
    const cached = await readEmployeeSnapshot(businessId, employeeId)
    if (cached) return cached.transactions
  }

  try {
    const { data, error } = await supabase
      .from('transactions')
      .select('id, status, total_amount, recorded_at')
      .eq('business_id', businessId)
      .eq('branch_id', branchId)
      .eq('employee_id', employeeId)
      .order('recorded_at', { ascending: false })
      .range(0, 49)

    if (error) throw error

    const transactions = ((data ?? []) as TransactionRow[]).map(mapTransaction)
    await mergeEmployeeSnapshot({ businessId, branchId, employeeId }, { transactions, recentTransactions: transactions })
    return transactions
  } catch (error) {
    const cached = await readEmployeeSnapshot(businessId, employeeId)
    if (cached) return cached.transactions
    throw error
  }
}

/**
 * Records an employee transaction through the server-side RPC.
 *
 * @param payload - Transaction payload.
 * @returns Void.
 */
export async function recordEmployeeTransaction(
  payload: RecordTransactionPayload,
  context?: RecordTransactionContext,
): Promise<RecordTransactionResult> {
  const recordedAt = new Date().toISOString()
  const args = {
    p_items: payload.items,
    p_payment_method: payload.paymentMethod,
    p_discount_amount: payload.discountAmount,
    p_customer_name: payload.customerName || null,
    p_customer_phone: payload.customerPhone || null,
    p_mpesa_ref_code: payload.mpesaRefCode || null,
    p_cash_deposit_code: null,
    p_recorded_at: recordedAt,
  }

  const connectivity = await getConnectivityState().catch(() => ({ isOnline: false, connectionType: null }))
  if (!connectivity.isOnline) {
    if (!context) throw new Error('You are offline. Sale context is unavailable on this screen.')
    return queueOfflineEmployeeTransaction(payload, args, recordedAt, context)
  }

  try {
    const { data, error } = await withTimeout(
      Promise.resolve(supabase.rpc('employee_record_transaction_offline', args)),
      30000,
      'The sale is taking too long. Check your network and try again.',
    )

    if (error) throw error
    const response = Array.isArray(data) ? data[0] : data
    const serverId = response && typeof response === 'object' && 'transaction_id' in response
      ? String((response as { transaction_id: unknown }).transaction_id)
      : undefined
    return { queued: false, serverId }
  } catch (error) {
    const currentConnectivity = await getConnectivityState().catch(() => ({ isOnline: false, connectionType: null }))
    if (context && !currentConnectivity.isOnline && isLikelyNetworkError(error)) {
      return queueOfflineEmployeeTransaction(payload, args, recordedAt, context)
    }
    throw error
  }
}

async function queueOfflineEmployeeTransaction(
  payload: RecordTransactionPayload,
  args: Record<string, unknown>,
  recordedAt: string,
  context: RecordTransactionContext,
): Promise<RecordTransactionResult> {
  const localId = createOfflineTransactionId()
  const items = payload.items.map((item) => {
    const product = context.products.find((option) => option.productId === item.productId && (item.recoveryItemId ? option.recoveryItemId === item.recoveryItemId : option.stockSource === 'normal'))
    const uom = product?.uomOptions.find((option) => option.id === item.uomId)
    return { optionId: product?.optionId ?? `${item.recoveryItemId ? 'recovery' : 'normal'}:${item.productId}`, baseQuantity: Number((item.quantity * (uom?.conversionFactor ?? 1)).toFixed(4)) }
  })

  await enqueueSyncItem({
    entityType: 'employee_transaction',
    localId,
    payload: {
      kind: 'rpc',
      rpc: 'employee_record_transaction_offline',
      args: { ...args, p_local_id: localId },
    },
  })
  await appendOfflineEmployeeTransaction({
    identity: context,
    transaction: { id: localId, status: 'pending_sync', totalAmount: context.totalAmount, recordedAt },
    items,
  })

  return { queued: true, localId }
}

function isLikelyNetworkError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase()
  return ['network', 'fetch', 'timeout', 'offline', 'connection', 'internet', 'taking too long'].some((part) => message.includes(part))
}

/**
 * Submits an employee damaged-stock report.
 *
 * @param payload - Damage report payload.
 * @returns Void.
 */
export async function reportEmployeeDamagedStock(payload: DamageReportPayload): Promise<void> {
  const { error } = await withTimeout(
    Promise.resolve(supabase.rpc('employee_report_inventory_loss', {
      p_product_id: payload.productId,
      p_uom_id: payload.uomId,
      p_quantity_in_uom: payload.quantity,
      p_loss_type: payload.lossType,
      p_reason: payload.reason,
    })),
    30000,
    'The damage report is taking too long. Check your network and try again.',
  )

  if (error) throw error
}
