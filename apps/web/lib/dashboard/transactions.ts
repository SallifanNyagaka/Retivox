/**
 * Shared transaction dashboard data access for Retivox.
 *
 * Owner and admin transaction routes use this module so branch scoping,
 * filters, pagination, and hydration remain consistent.
 *
 * Throughput note: at very high sustained traffic, transaction dashboards will
 * need Supavisor/PgBouncer connection pooling, read replicas for historical
 * reads, and possibly write queueing for burst-heavy payment workflows. Those
 * are infrastructure decisions and are intentionally not implemented here.
 *
 * Required indexes:
 * - idx_transactions_business_branch_recorded_at for paginated branch/date lists
 * - idx_transactions_business_branch_status for status filters
 * - idx_transactions_branch_employee_recorded_at for employee-scoped history
 * - idx_payments_business_method_transaction for payment method filters
 * - idx_payments_transaction_id for lazy payment hydration per page
 */

import { z } from 'zod'
import { getAccessibleBranchIds, type BranchRole } from '../auth/branchAccess'
import logger from '../logger'
import { createClient } from '../supabase/server'
import { runSoftDeleteAwareQuery } from '../supabase/softDelete'
import type {
  BranchFilterRow,
  PaymentMethod,
  PaymentRow,
  TransactionItemSummary,
  TransactionLineItemProduct,
  TransactionLineItemUOM,
  TransactionFilters,
  TransactionMetrics,
  TransactionRow,
  TransactionStatus,
  TransactionView,
  UserFilterRow,
} from '../../app/dashboard/owner/transactions/types'

/**
 * Number of transaction rows fetched for each page.
 */
const PAGE_SIZE = 25

/**
 * Valid transaction status filter values.
 */
const TRANSACTION_STATUSES: TransactionStatus[] = [
  'pending_sync',
  'synced',
  'pending_verify',
  'verified',
  'rejected',
  'flagged',
  'voided',
]

/**
 * Valid payment method filter values.
 */
const PAYMENT_METHODS: PaymentMethod[] = ['mpesa_stk', 'mpesa_manual', 'cash', 'card']

/**
 * Empty metrics used when a user has no accessible branches.
 */
const EMPTY_TRANSACTION_METRICS: TransactionMetrics = {
  totalToday: 0,
  totalThisWeek: 0,
  pendingVerifications: 0,
  rejectedCount: 0,
}

type TransactionItemSummaryRow = {
  transaction_id: string
  product_id: string
  recovery_item_id: string | null
  quantity: number
  quantity_in_uom: string | number | null
  base_quantity: string | number | null
  products: TransactionLineItemProduct | TransactionLineItemProduct[] | null
  units_of_measure: TransactionLineItemUOM | TransactionLineItemUOM[] | null
}

type ProductBaseUomRow = {
  product_id: string
  units_of_measure: { name: string } | { name: string }[] | null
}

/**
 * Expected URL search params for transaction list routes.
 */
export type TransactionsSearchParams = Promise<{
  branch?: string
  employee?: string
  status?: string
  payment_method?: string
  date_from?: string
  date_to?: string
  search?: string
  page?: string
}>

/**
 * Full data payload consumed by the transaction view.
 */
export type TransactionsDashboardData = {
  currency: string
  branches: BranchFilterRow[]
  transactions: TransactionView[]
  filters: TransactionFilters
  metrics: TransactionMetrics
  totalCount: number
  totalPages: number
}

/**
 * Options that define the minimum branch role for transaction visibility.
 */
export type TransactionsDashboardOptions = {
  minimumBranchRole?: BranchRole
}

/**
 * Business currency row shape.
 */
type BusinessCurrencyRow = {
  currency: string
}

/**
 * Reads and trims a single URL search param.
 */
function readParam(value: string | undefined) {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Parses an optional UUID URL value with Zod.
 */
function parseOptionalUuid(value: string) {
  if (!value) {
    return ''
  }

  const result = z.string().uuid().safeParse(value)
  return result.success ? result.data : ''
}

/**
 * Parses an optional enum URL value.
 */
function parseOptionalEnum<TValue extends string>(value: string, allowedValues: readonly TValue[]) {
  return allowedValues.includes(value as TValue) ? (value as TValue) : ''
}

/**
 * Parses an optional YYYY-MM-DD date URL value.
 */
function parseOptionalDate(value: string) {
  if (!value) {
    return ''
  }

  const result = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).safeParse(value)
  return result.success ? result.data : ''
}

/**
 * Parses and validates transaction URL filters.
 */
export async function parseTransactionFilters(searchParams: TransactionsSearchParams): Promise<TransactionFilters> {
  const params = await searchParams
  const rawPage = Number(readParam(params.page))

  return {
    branch: parseOptionalUuid(readParam(params.branch)),
    employeeId: parseOptionalUuid(readParam(params.employee)),
    status: parseOptionalEnum(readParam(params.status), TRANSACTION_STATUSES),
    paymentMethod: parseOptionalEnum(readParam(params.payment_method), PAYMENT_METHODS),
    dateFrom: parseOptionalDate(readParam(params.date_from)),
    dateTo: parseOptionalDate(readParam(params.date_to)),
    search: z.string().trim().max(100).catch('').parse(readParam(params.search)),
    page: Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1,
  }
}

/**
 * Converts a date input value to the inclusive end-of-day ISO timestamp.
 */
function getDateToIso(dateValue: string) {
  const date = new Date(`${dateValue}T23:59:59.999`)
  return date.toISOString()
}

/**
 * Converts a date input value to the start-of-day ISO timestamp.
 */
function getDateFromIso(dateValue: string) {
  const date = new Date(`${dateValue}T00:00:00.000`)
  return date.toISOString()
}

/**
 * Chooses the most useful payment to show in a table row.
 */
function getPrimaryPayment(payments: PaymentRow[], paymentMethodFilter: string) {
  if (paymentMethodFilter) {
    return payments.find((payment) => payment.payment_method === paymentMethodFilter) ?? payments[0] ?? null
  }

  return (
    payments.find((payment) => payment.status === 'pending_verify') ??
    payments.find((payment) => payment.status === 'verified') ??
    payments[0] ??
    null
  )
}

/**
 * Returns a unique string array.
 */
function uniqueStrings(values: string[]) {
  return Array.from(new Set(values))
}

/**
 * Normalizes Supabase joined rows that may arrive as a single object or array.
 */
function normalizeJoinedOne<T>(value: T | T[] | null): T | null {
  if (!value) {
    return null
  }

  return Array.isArray(value) ? value[0] ?? null : value
}

/**
 * Loads transaction dashboard data scoped to a user's accessible branches.
 */
export async function getTransactionsDashboardData(
  userId: string,
  businessId: string,
  filters: TransactionFilters,
  options: TransactionsDashboardOptions = {}
): Promise<TransactionsDashboardData> {
  const supabase = await createClient()

  try {
    const accessibleBranchIds = await getAccessibleBranchIds(userId, options.minimumBranchRole ?? 'employee')
    const scopedBranchIds = filters.branch
      ? accessibleBranchIds.includes(filters.branch)
        ? [filters.branch]
        : []
      : accessibleBranchIds

    const [businessResponse, branchesResponse, metricsResponse] = await Promise.all([
      supabase.from('businesses').select('currency').eq('id', businessId).single(),
      accessibleBranchIds.length > 0
        ? runSoftDeleteAwareQuery<BranchFilterRow>(
            () =>
              supabase
                .from('branches')
                .select('id, name')
                .eq('business_id', businessId)
                .in('id', accessibleBranchIds)
                .is('deleted_at', null)
                .order('name'),
            () =>
              supabase
                .from('branches')
                .select('id, name')
                .eq('business_id', businessId)
                .in('id', accessibleBranchIds)
                .order('name'),
            { table: 'branches', businessId, page: 'transactions_dashboard' }
          )
        : Promise.resolve({ data: [], error: null }),
      scopedBranchIds.length > 0
        ? supabase.rpc('dashboard_transaction_metrics', { p_branch_ids: scopedBranchIds })
        : Promise.resolve({ data: [EMPTY_TRANSACTION_METRICS], error: null }),
    ])

    if (businessResponse.error) {
      throw businessResponse.error
    }

    if (branchesResponse.error) {
      throw branchesResponse.error
    }

    if (metricsResponse.error) {
      throw metricsResponse.error
    }

    const business = businessResponse.data as BusinessCurrencyRow | null

    if (!business?.currency) {
      throw new Error('Business currency missing')
    }

    const branches = (branchesResponse.data ?? []) as BranchFilterRow[]
    const metricsRows = (metricsResponse.data ?? []) as TransactionMetrics[]
    const metrics = metricsRows[0] ?? EMPTY_TRANSACTION_METRICS

    if (scopedBranchIds.length === 0) {
      return {
        currency: business.currency,
        branches,
        transactions: [],
        filters,
        metrics,
        totalCount: 0,
        totalPages: 1,
      }
    }

    let employeeIdsFromSearch: string[] | null = null
    if (filters.search) {
      const employeeSearchResponse = await supabase
        .from('users')
        .select('id')
        .eq('business_id', businessId)
        .ilike('name', `%${filters.search}%`)

      if (employeeSearchResponse.error) {
        throw employeeSearchResponse.error
      }

      employeeIdsFromSearch = ((employeeSearchResponse.data ?? []) as { id: string }[]).map((user) => user.id)
    }

    let transactionIdsFromPaymentMethod: string[] | null = null
    if (filters.paymentMethod) {
      let paymentMethodQuery = supabase
        .from('payments')
        .select('transaction_id, transactions!inner(branch_id, employee_id, status, recorded_at)')
        .eq('business_id', businessId)
        .eq('payment_method', filters.paymentMethod)
        .in('transactions.branch_id', scopedBranchIds)

      if (filters.employeeId) {
        paymentMethodQuery = paymentMethodQuery.eq('transactions.employee_id', filters.employeeId)
      }

      if (filters.status) {
        paymentMethodQuery = paymentMethodQuery.eq('transactions.status', filters.status)
      }

      if (filters.dateFrom) {
        paymentMethodQuery = paymentMethodQuery.gte('transactions.recorded_at', getDateFromIso(filters.dateFrom))
      }

      if (filters.dateTo) {
        paymentMethodQuery = paymentMethodQuery.lte('transactions.recorded_at', getDateToIso(filters.dateTo))
      }

      if (employeeIdsFromSearch) {
        paymentMethodQuery = paymentMethodQuery.in('transactions.employee_id', employeeIdsFromSearch)
      }

      const paymentMethodResponse = await paymentMethodQuery.range(0, 999)

      if (paymentMethodResponse.error) {
        throw paymentMethodResponse.error
      }

      transactionIdsFromPaymentMethod = uniqueStrings(
        ((paymentMethodResponse.data ?? []) as { transaction_id: string }[]).map((payment) => payment.transaction_id)
      )
    }

    const searchHasNoMatches = employeeIdsFromSearch !== null && employeeIdsFromSearch.length === 0
    const paymentMethodHasNoMatches =
      transactionIdsFromPaymentMethod !== null && transactionIdsFromPaymentMethod.length === 0

    if (searchHasNoMatches || paymentMethodHasNoMatches) {
      return {
        currency: business.currency,
        branches,
        transactions: [],
        filters,
        metrics,
        totalCount: 0,
        totalPages: 1,
      }
    }

    let transactionQuery = supabase
      .from('transactions')
      .select(
        'id, branch_id, employee_id, customer_id, status, subtotal, discount_amount, total_amount, origin, sync_status, local_id, recorded_at, synced_at, created_at',
        { count: 'exact' }
      )
      .eq('business_id', businessId)
      .in('branch_id', scopedBranchIds)
      .order('recorded_at', { ascending: false })

    if (filters.employeeId) {
      transactionQuery = transactionQuery.eq('employee_id', filters.employeeId)
    }

    if (filters.status) {
      transactionQuery = transactionQuery.eq('status', filters.status)
    }

    if (filters.dateFrom) {
      transactionQuery = transactionQuery.gte('recorded_at', getDateFromIso(filters.dateFrom))
    }

    if (filters.dateTo) {
      transactionQuery = transactionQuery.lte('recorded_at', getDateToIso(filters.dateTo))
    }

    if (employeeIdsFromSearch) {
      transactionQuery = transactionQuery.in('employee_id', employeeIdsFromSearch)
    }

    if (transactionIdsFromPaymentMethod) {
      transactionQuery = transactionQuery.in('id', transactionIdsFromPaymentMethod)
    }

    const pageOffset = (filters.page - 1) * PAGE_SIZE
    const transactionsResponse = await transactionQuery.range(pageOffset, pageOffset + PAGE_SIZE - 1)

    if (transactionsResponse.error) {
      throw transactionsResponse.error
    }

    const transactionRows = (transactionsResponse.data ?? []) as TransactionRow[]
    const totalCount = transactionsResponse.count ?? 0
    const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))
    const transactionIds = transactionRows.map((transaction) => transaction.id)
    const employeeIds = uniqueStrings(
      transactionRows.map((transaction) => transaction.employee_id).filter((id): id is string => Boolean(id))
    )

    const [paymentsResponse, usersResponse, itemSummaryResponse] = await Promise.all([
      transactionIds.length > 0
        ? supabase
            .from('payments')
            .select(
              'id, transaction_id, payment_method, amount, status, mpesa_ref_code, mpesa_checkout_id, paybill_number, account_reference, cash_deposit_code, verified_by, verified_at, payment_at'
            )
            .eq('business_id', businessId)
            .in('transaction_id', transactionIds)
            .order('payment_at', { ascending: false })
        : Promise.resolve({ data: [], error: null }),
      employeeIds.length > 0
        ? supabase.from('users').select('id, name, email').eq('business_id', businessId).in('id', employeeIds)
        : Promise.resolve({ data: [], error: null }),
      transactionIds.length > 0
        ? supabase
            .from('transaction_items')
            .select('transaction_id, product_id, recovery_item_id, quantity, quantity_in_uom, base_quantity, products!inner(name, sku), units_of_measure(name, abbreviation, conversion_factor)')
            .eq('business_id', businessId)
            .in('transaction_id', transactionIds)
            .order('id', { ascending: true })
        : Promise.resolve({ data: [], error: null }),
    ])

    if (paymentsResponse.error) {
      throw paymentsResponse.error
    }

    if (usersResponse.error) {
      throw usersResponse.error
    }

    if (itemSummaryResponse.error) {
      throw itemSummaryResponse.error
    }

    const paymentRows = (paymentsResponse.data ?? []) as PaymentRow[]
    const users = (usersResponse.data ?? []) as UserFilterRow[]
    const itemRows = (itemSummaryResponse.data ?? []) as TransactionItemSummaryRow[]
    const productIdsFromItems = uniqueStrings(itemRows.map((item) => item.product_id))
    const baseUomResponse =
      productIdsFromItems.length > 0
        ? await supabase
            .from('product_uom_links')
            .select('product_id, units_of_measure!inner(name)')
            .eq('business_id', businessId)
            .eq('is_base_uom', true)
            .in('product_id', productIdsFromItems)
        : { data: [], error: null }

    if (baseUomResponse.error) {
      throw baseUomResponse.error
    }

    const baseUomByProduct = new Map<string, string>()
    ;((baseUomResponse.data ?? []) as ProductBaseUomRow[]).forEach((row) => {
      const baseUom = normalizeJoinedOne(row.units_of_measure)

      if (baseUom?.name) {
        baseUomByProduct.set(row.product_id, baseUom.name)
      }
    })
    const branchMap: Record<string, string> = {}
    branches.forEach((branch) => {
      branchMap[branch.id] = branch.name
    })

    const userMap: Record<string, UserFilterRow> = {}
    users.forEach((user) => {
      userMap[user.id] = user
    })

    const paymentsByTransaction: Record<string, PaymentRow[]> = {}
    paymentRows.forEach((payment) => {
      paymentsByTransaction[payment.transaction_id] = [
        ...(paymentsByTransaction[payment.transaction_id] ?? []),
        payment,
      ]
    })

    const itemsByTransaction: Record<string, TransactionItemSummary[]> = {}
    itemRows.forEach((item) => {
      const product = normalizeJoinedOne(item.products)
      const uom = normalizeJoinedOne(item.units_of_measure)

      itemsByTransaction[item.transaction_id] = [
        ...(itemsByTransaction[item.transaction_id] ?? []),
        {
          transactionId: item.transaction_id,
          productId: item.product_id,
          productName: product?.name ?? 'Unknown product',
          isRecovery: Boolean(item.recovery_item_id),
          quantity: Number(item.quantity),
          quantityInUom: item.quantity_in_uom === null ? null : Number(item.quantity_in_uom),
          baseQuantity: item.base_quantity === null ? null : Number(item.base_quantity),
          uomName: uom?.name ?? null,
          uomConversionFactor: uom?.conversion_factor === undefined ? null : Number(uom.conversion_factor),
          baseUomName: baseUomByProduct.get(item.product_id) ?? null,
        },
      ]
    })

    const transactions = transactionRows.map((transaction) => {
      const transactionPayments = paymentsByTransaction[transaction.id] ?? []
      const employee = transaction.employee_id ? userMap[transaction.employee_id] : null

      return {
        ...transaction,
        branch_name: transaction.branch_id ? branchMap[transaction.branch_id] ?? 'Unknown branch' : 'Unknown branch',
        employee_name: employee?.name ?? 'Unknown employee',
        employee_email: employee?.email ?? null,
        payments: transactionPayments,
        primary_payment: getPrimaryPayment(transactionPayments, filters.paymentMethod),
        item_summary: itemsByTransaction[transaction.id] ?? [],
      }
    })

    return {
      currency: business.currency,
      branches,
      transactions,
      filters,
      metrics,
      totalCount,
      totalPages,
    }
  } catch (error: unknown) {
    logger.error('getTransactionsDashboardData failed', { userId, businessId, filters, error })
    throw error
  }
}
