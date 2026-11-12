/**
 * Employee transactions page.
 *
 * Shows the signed-in employee's own transaction history across current and
 * former store assignments. New sales remain limited to their current store.
 */

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Badge } from '../../../../components/ui/Badge'
import { Card, CardHeader } from '../../../../components/ui/Card'
import { requireAuth } from '../../../../lib/auth/helpers'
import { getEmployeeProfile } from '../../../../lib/employee/auth'
import logger from '../../../../lib/logger'
import { createClient } from '../../../../lib/supabase/server'
import PrintReceiptButton from './PrintReceiptButton'

/**
 * Number of employee transactions shown per page.
 */
const PAGE_SIZE = 25

/**
 * Transaction statuses employees can filter by.
 */
const TRANSACTION_STATUSES = [
  'pending_sync',
  'synced',
  'pending_verify',
  'verified',
  'rejected',
  'flagged',
  'voided',
] as const

/**
 * Employee transaction status literal.
 */
type EmployeeTransactionStatus = (typeof TRANSACTION_STATUSES)[number]

/**
 * Search params accepted by the employee transactions page.
 */
type EmployeeTransactionsSearchParams = Promise<{
  status?: string
  dateFrom?: string
  dateTo?: string
  page?: string
}>

/**
 * Validated filters used for employee transaction queries.
 */
type EmployeeTransactionFilters = {
  status: EmployeeTransactionStatus | ''
  dateFrom: string
  dateTo: string
  page: number
}

/**
 * Currency row returned from the businesses table.
 */
type BusinessCurrencyRow = {
  currency: string
}

/**
 * Raw transaction row visible to an employee.
 */
type EmployeeTransactionRow = {
  id: string
  branch_id: string | null
  status: EmployeeTransactionStatus
  subtotal: number
  discount_amount: number
  total_amount: number
  receipt_number: string
  origin: string
  recorded_at: string
  branches: { name: string } | { name: string }[] | null
}

/**
 * Payment row visible for an employee-owned transaction.
 */
type EmployeePaymentRow = {
  transaction_id: string
  payment_method: string
  amount: number
  status: string
  payment_at: string
}

type EmployeeTransactionItemRow = {
  transaction_id: string
  product_id: string
  recovery_item_id: string | null
  quantity: number
  quantity_in_uom: string | number | null
  base_quantity: string | number | null
  net_line_total: string | number | null
  line_total: string | number | null
  products: { name: string; sku: string | null } | { name: string; sku: string | null }[] | null
  units_of_measure: { name: string; conversion_factor: string | number } | { name: string; conversion_factor: string | number }[] | null
}

type EmployeeTransactionItemSummary = {
  productName: string
  isRecovery: boolean
  quantity: number
  quantityInUom: number | null
  baseQuantity: number | null
  uomName: string | null
  uomConversionFactor: number | null
  baseUomName: string | null
  lineTotal: number
}

type ProductBaseUomRow = {
  product_id: string
  units_of_measure: { name: string } | { name: string }[] | null
}

/**
 * Hydrated transaction row shown in the employee table.
 */
type EmployeeTransactionView = Omit<EmployeeTransactionRow, 'branches'> & {
  branchName: string
  payment: EmployeePaymentRow | null
  itemSummary: EmployeeTransactionItemSummary[]
}

/**
 * Checks whether a string is an allowed employee transaction status.
 */
function isEmployeeTransactionStatus(value: string): value is EmployeeTransactionStatus {
  return TRANSACTION_STATUSES.includes(value as EmployeeTransactionStatus)
}

/**
 * Returns a safe integer page number from a URL value.
 */
function parsePage(value: string | undefined) {
  const parsed = Number.parseInt(value ?? '1', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1
}

/**
 * Returns true when a value is a simple YYYY-MM-DD date input value.
 */
function isDateInputValue(value: string | undefined): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

/**
 * Parses and validates URL filters for employee transaction history.
 */
async function parseEmployeeTransactionFilters(
  searchParams: EmployeeTransactionsSearchParams
): Promise<EmployeeTransactionFilters> {
  const params = await searchParams
  const status = params.status && isEmployeeTransactionStatus(params.status) ? params.status : ''

  return {
    status,
    dateFrom: isDateInputValue(params.dateFrom) ? params.dateFrom : '',
    dateTo: isDateInputValue(params.dateTo) ? params.dateTo : '',
    page: parsePage(params.page),
  }
}

/**
 * Formats monetary values with the business currency.
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
 * Formats transaction timestamps for compact table display.
 */
function formatDateTimeLabel(isoDate: string) {
  return new Date(isoDate).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function normalizeJoinedOne<T>(value: T | T[] | null): T | null {
  if (!value) {
    return null
  }

  return Array.isArray(value) ? value[0] ?? null : value
}

function formatNumber(value: number) {
  return value.toLocaleString(undefined, { maximumFractionDigits: 4 })
}

function formatItemQuantity(item: EmployeeTransactionItemSummary) {
  const quantityInUom = item.quantityInUom ?? item.quantity
  const baseQuantity = item.baseQuantity ?? item.quantity
  const uomName = item.uomName ?? 'units'

  if (!item.uomConversionFactor || item.uomConversionFactor <= 1 || baseQuantity === quantityInUom) {
    return `${formatNumber(quantityInUom)} ${uomName}`
  }

  return `${formatNumber(quantityInUom)} ${uomName} (${formatNumber(baseQuantity)} ${item.baseUomName ?? 'base units'})`
}

function formatItemSummary(items: EmployeeTransactionItemSummary[]) {
  if (items.length === 0) {
    return 'No items'
  }

  const visibleItems = items.slice(0, 2).map((item) => {
    const productLabel = item.isRecovery ? `Damaged: ${item.productName}` : item.productName
    return `${productLabel}: ${formatItemQuantity(item)}`
  })
  const hiddenCount = items.length - visibleItems.length

  return hiddenCount > 0 ? `${visibleItems.join(', ')} +${hiddenCount} more` : visibleItems.join(', ')
}

/**
 * Converts status text to a readable label.
 */
function formatStatusLabel(status: string) {
  return status
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

/**
 * Returns the badge variant for transaction and payment statuses.
 */
function getStatusVariant(status: string) {
  if (status === 'verified' || status === 'synced') return 'success'
  if (status === 'pending_verify' || status === 'pending_sync' || status === 'pending') return 'warning'
  if (status === 'rejected' || status === 'flagged') return 'danger'
  return 'muted'
}

/**
 * Builds a pagination URL while preserving active filters.
 */
function buildEmployeeTransactionsHref(filters: EmployeeTransactionFilters, page: number) {
  const params = new URLSearchParams()

  if (filters.status) params.set('status', filters.status)
  if (filters.dateFrom) params.set('dateFrom', filters.dateFrom)
  if (filters.dateTo) params.set('dateTo', filters.dateTo)
  if (page > 1) params.set('page', String(page))

  return `/dashboard/employee/transactions${params.toString() ? `?${params.toString()}` : ''}`
}

/**
 * Employee transactions page server component.
 */
export default async function EmployeeTransactionsPage({
  searchParams,
}: {
  searchParams: EmployeeTransactionsSearchParams
}) {
  const user = await requireAuth()
  const employeeProfile = await getEmployeeProfile(user.id)

  if (!employeeProfile) {
    redirect('/unauthorized')
  }

  if (!employeeProfile.isActive) {
    redirect('/account/deactivated')
  }

  if (!employeeProfile.branchId) {
    redirect('/dashboard/employee/unassigned')
  }

  const filters = await parseEmployeeTransactionFilters(searchParams)
  let currency = 'USD'
  let transactions: EmployeeTransactionView[] = []
  let totalCount = 0
  let pageError: string | null = null

  try {
    const supabase = await createClient()
    const from = (filters.page - 1) * PAGE_SIZE
    const to = from + PAGE_SIZE - 1

    const businessResponse = await supabase
      .from('businesses')
      .select('currency')
      .eq('id', employeeProfile.businessId)
      .single()

    if (businessResponse.error) {
      throw businessResponse.error
    }

    const business = businessResponse.data as BusinessCurrencyRow | null
    currency = business?.currency ?? currency

    let transactionQuery = supabase
      .from('transactions')
      .select('id, receipt_number, branch_id, status, subtotal, discount_amount, total_amount, origin, recorded_at, branches(name)', { count: 'exact' })
      .eq('business_id', employeeProfile.businessId)
      .eq('employee_id', employeeProfile.id)
      .order('recorded_at', { ascending: false })
      .range(from, to)

    if (filters.status) {
      transactionQuery = transactionQuery.eq('status', filters.status)
    }

    if (filters.dateFrom) {
      transactionQuery = transactionQuery.gte('recorded_at', `${filters.dateFrom}T00:00:00.000Z`)
    }

    if (filters.dateTo) {
      transactionQuery = transactionQuery.lte('recorded_at', `${filters.dateTo}T23:59:59.999Z`)
    }

    const transactionResponse = await transactionQuery

    if (transactionResponse.error) {
      throw transactionResponse.error
    }

    const transactionRows = (transactionResponse.data ?? []) as EmployeeTransactionRow[]
    const transactionIds = transactionRows.map((transaction) => transaction.id)
    totalCount = transactionResponse.count ?? 0

    const [paymentResponse, itemResponse] = await Promise.all([
      transactionIds.length > 0
        ? supabase
            .from('payments')
            .select('transaction_id, payment_method, amount, status, payment_at')
            .eq('business_id', employeeProfile.businessId)
            .in('transaction_id', transactionIds)
            .order('payment_at', { ascending: false })
        : Promise.resolve({ data: [], error: null }),
      transactionIds.length > 0
        ? supabase
            .from('transaction_items')
            .select('transaction_id, product_id, recovery_item_id, quantity, quantity_in_uom, base_quantity, net_line_total, line_total, products!inner(name, sku), units_of_measure(name, conversion_factor)')
            .eq('business_id', employeeProfile.businessId)
            .in('transaction_id', transactionIds)
            .order('id', { ascending: true })
        : Promise.resolve({ data: [], error: null }),
    ])

    if (paymentResponse.error) {
      throw paymentResponse.error
    }

    if (itemResponse.error) {
      throw itemResponse.error
    }

    const paymentsByTransaction = new Map<string, EmployeePaymentRow>()
    ;((paymentResponse.data ?? []) as EmployeePaymentRow[]).forEach((payment) => {
      if (!paymentsByTransaction.has(payment.transaction_id)) {
        paymentsByTransaction.set(payment.transaction_id, payment)
      }
    })

    const itemRows = (itemResponse.data ?? []) as EmployeeTransactionItemRow[]
    const productIdsFromItems = Array.from(new Set(itemRows.map((item) => item.product_id).filter(Boolean)))
    const baseUomResponse =
      productIdsFromItems.length > 0
        ? await supabase
            .from('product_uom_links')
            .select('product_id, units_of_measure!inner(name)')
            .eq('business_id', employeeProfile.businessId)
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

    const itemsByTransaction = new Map<string, EmployeeTransactionItemSummary[]>()
    itemRows.forEach((item) => {
      const product = normalizeJoinedOne(item.products)
      const uom = normalizeJoinedOne(item.units_of_measure)
      const currentItems = itemsByTransaction.get(item.transaction_id) ?? []

      currentItems.push({
        productName: product?.name ?? 'Unknown product',
        isRecovery: Boolean(item.recovery_item_id),
        quantity: Number(item.quantity),
        quantityInUom: item.quantity_in_uom === null ? null : Number(item.quantity_in_uom),
        baseQuantity: item.base_quantity === null ? null : Number(item.base_quantity),
        uomName: uom?.name ?? null,
        uomConversionFactor: uom?.conversion_factor === undefined ? null : Number(uom.conversion_factor),
        baseUomName: baseUomByProduct.get(item.product_id) ?? null,
        lineTotal: Number(item.net_line_total ?? item.line_total ?? 0),
      })

      itemsByTransaction.set(item.transaction_id, currentItems)
    })

    transactions = transactionRows.map((transaction) => {
      const branch = normalizeJoinedOne(transaction.branches)

      return {
        ...transaction,
        branchName: branch?.name ?? 'Former store',
        payment: paymentsByTransaction.get(transaction.id) ?? null,
        itemSummary: itemsByTransaction.get(transaction.id) ?? [],
      }
    })
  } catch (error: unknown) {
    logger.error('EmployeeTransactionsPage data fetch failed', {
      userId: employeeProfile.id,
      branchId: employeeProfile.branchId,
      businessId: employeeProfile.businessId,
      filters,
      error,
    })
    pageError = error instanceof Error ? error.message : 'Unable to load employee transactions'
  }

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))
  const currentPage = Math.min(filters.page, totalPages)
  const previousHref = buildEmployeeTransactionsHref(filters, Math.max(1, currentPage - 1))
  const nextHref = buildEmployeeTransactionsHref(filters, Math.min(totalPages, currentPage + 1))

  if (pageError) {
    return (
      <Card padding="md">
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-text-primary)', letterSpacing: '-0.3px' }}>
          My Transactions
        </h1>
        <p style={{ fontSize: 14, color: 'var(--color-danger)', marginTop: 8 }}>
          Failed to load your transactions. Please refresh and try again.
        </p>
      </Card>
    )
  }

  return (
    <div className="mx-auto flex w-full flex-col items-center gap-6 text-center">
      {/* Page header */}
      <div className="flex w-full flex-col items-center justify-between gap-4 text-center sm:flex-row sm:text-left">
        <div>
          <h1
            className="font-bold"
            style={{ fontSize: 22, color: 'var(--color-text-primary)', letterSpacing: '-0.3px' }}
          >
            My Transactions
          </h1>
          <p style={{ fontSize: 14, color: 'var(--color-text-muted)', marginTop: 4 }}>
            Transactions you recorded across your store assignments are shown. New sales can only be recorded at {employeeProfile.branchName}.
          </p>
        </div>
        <Link href="/dashboard/employee/transactions/new" className="btn-primary" style={{ padding: '10px 18px', borderRadius: 8, flexShrink: 0 }}>
          Record transaction
        </Link>
      </div>

      {/* URL-driven filters */}
      <Card padding="md">
        <form action="/dashboard/employee/transactions" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-2 text-left" style={{ fontSize: 13, color: 'var(--color-text-primary)' }}>
            Status
            <select
              name="status"
              defaultValue={filters.status}
              style={{
                height: 44,
                borderRadius: 8,
                border: '1px solid var(--color-border)',
                padding: '0 14px',
                backgroundColor: 'var(--color-background)',
                color: 'var(--color-text-primary)',
              }}
            >
              <option value="">All statuses</option>
              {TRANSACTION_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {formatStatusLabel(status)}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-2 text-left" style={{ fontSize: 13, color: 'var(--color-text-primary)' }}>
            Date from
            <input
              type="date"
              name="dateFrom"
              defaultValue={filters.dateFrom}
              style={{
                height: 44,
                borderRadius: 8,
                border: '1px solid var(--color-border)',
                padding: '0 14px',
                backgroundColor: 'var(--color-background)',
                color: 'var(--color-text-primary)',
              }}
            />
          </label>

          <label className="flex flex-col gap-2 text-left" style={{ fontSize: 13, color: 'var(--color-text-primary)' }}>
            Date to
            <input
              type="date"
              name="dateTo"
              defaultValue={filters.dateTo}
              style={{
                height: 44,
                borderRadius: 8,
                border: '1px solid var(--color-border)',
                padding: '0 14px',
                backgroundColor: 'var(--color-background)',
                color: 'var(--color-text-primary)',
              }}
            />
          </label>

          <div className="flex items-end justify-center gap-2">
            <button type="submit" className="btn-primary" style={{ padding: '8px 16px', borderRadius: 8 }}>
              Apply
            </button>
            <Link href="/dashboard/employee/transactions" className="btn-outline" style={{ padding: '8px 16px', borderRadius: 8 }}>
              Clear
            </Link>
          </div>
        </form>
      </Card>

      {/* Own transaction history */}
      <div className="w-full">
        <Card padding="md">
          <CardHeader title="Transaction history" />

          {transactions.length === 0 ? (
            <div className="flex flex-col items-center justify-center text-center" style={{ padding: '44px 20px', gap: 14 }}>
              <h2 style={{ fontSize: 20, fontWeight: 600, color: 'var(--color-text-primary)', margin: 0 }}>
                No transactions found
              </h2>
              <p style={{ fontSize: 14, color: 'var(--color-text-muted)', margin: 0 }}>
                Your own transactions will appear here after they are recorded.
              </p>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderSpacing: 0 }}>
                <thead>
                  <tr style={{ textAlign: 'center' }}>
                    {['Date', 'Store', 'Items', 'Amount', 'Payment', 'Status', 'Receipt'].map((heading) => (
                      <th key={heading} style={{ padding: 12, fontSize: 12, color: 'var(--color-text-muted)' }}>
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((transaction, index) => (
                    <tr
                      key={transaction.id}
                      style={{ backgroundColor: index % 2 === 0 ? 'var(--color-background)' : 'var(--color-surface)' }}
                    >
                      <td style={{ padding: 12, fontSize: 13, color: 'var(--color-text-primary)', textAlign: 'center' }}>
                        {formatDateTimeLabel(transaction.recorded_at)}
                      </td>
                      <td style={{ padding: 12, fontSize: 13, color: 'var(--color-text-primary)', textAlign: 'center' }}>
                        {transaction.branchName}
                      </td>
                      <td style={{ padding: 12, fontSize: 13, color: 'var(--color-text-primary)', textAlign: 'center', minWidth: 220 }}>
                        {formatItemSummary(transaction.itemSummary)}
                      </td>
                      <td style={{ padding: 12, fontSize: 13, color: 'var(--color-text-primary)', textAlign: 'center' }}>
                        <span className="inline-flex flex-col items-center gap-1">
                          <span style={{ fontWeight: 700 }}>{formatMoney(Number(transaction.total_amount), currency)}</span>
                          {Number(transaction.discount_amount) > 0 && (
                            <span style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>
                              Discount {formatMoney(Number(transaction.discount_amount), currency)}
                            </span>
                          )}
                        </span>
                      </td>
                      <td style={{ padding: 12, fontSize: 13, color: 'var(--color-text-primary)', textAlign: 'center' }}>
                        {transaction.payment ? (
                          <span className="inline-flex flex-col items-center gap-1">
                            <span>{formatStatusLabel(transaction.payment.payment_method)}</span>
                            <Badge variant={getStatusVariant(transaction.payment.status)}>
                              {formatStatusLabel(transaction.payment.status)}
                            </Badge>
                          </span>
                        ) : (
                          '-'
                        )}
                      </td>
                      <td style={{ padding: 12, textAlign: 'center' }}>
                        <Badge variant={getStatusVariant(transaction.status)}>
                          {formatStatusLabel(transaction.status)}
                        </Badge>
                      </td>
                      <td style={{ padding: 12, textAlign: 'center' }}>
                        <PrintReceiptButton
                          receiptNumber={transaction.receipt_number}
                          store={transaction.branchName}
                          currency={currency}
                          recordedAt={transaction.recorded_at}
                          items={transaction.itemSummary.map((item) => ({
                            name: item.productName,
                            quantity: item.quantityInUom ?? item.quantity,
                            unit: item.uomName,
                            amount: item.lineTotal,
                          }))}
                          subtotal={Number(transaction.subtotal)}
                          discount={Number(transaction.discount_amount)}
                          total={Number(transaction.total_amount)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {/* Pagination */}
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Link
          href={previousHref}
          className="btn-outline"
          aria-disabled={currentPage <= 1}
          style={{ padding: '8px 16px', borderRadius: 8, opacity: currentPage <= 1 ? 0.55 : 1 }}
        >
          Previous
        </Link>
        <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
          Page {currentPage} of {totalPages}
        </span>
        <Link
          href={nextHref}
          className="btn-outline"
          aria-disabled={currentPage >= totalPages}
          style={{ padding: '8px 16px', borderRadius: 8, opacity: currentPage >= totalPages ? 0.55 : 1 }}
        >
          Next
        </Link>
      </div>
    </div>
  )
}
