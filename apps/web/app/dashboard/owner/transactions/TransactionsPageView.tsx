/**
 * Server-rendered view for the owner transactions dashboard.
 *
 * This component renders filters, metrics, pagination, empty states, and the
 * transactions table while delegating row-level writes to client actions.
 */

import Link from 'next/link'
import { Card, CardHeader } from '../../../../components/ui/Card'
import { Badge } from '../../../../components/ui/Badge'
import { MetricCard } from '../../../../components/dashboard/MetricCard'
import TransactionRowActions from './TransactionRowActions'
import type {
  BranchFilterRow,
  PaymentMethod,
  TransactionFilters,
  TransactionItemSummary,
  TransactionMetrics,
  TransactionStatus,
  TransactionView,
} from './types'

/**
 * Props for the transactions dashboard view.
 */
type Props = {
  currency: string
  branches: BranchFilterRow[]
  transactions: TransactionView[]
  filters: TransactionFilters
  metrics: TransactionMetrics
  totalCount: number
  totalPages: number
  basePath?: string
  subtitle?: string
  canManageTransactions?: boolean
  recordTransactionHref?: string
  recordTransactionLabel?: string
}

/**
 * Transaction statuses available in the filter bar.
 */
const STATUS_OPTIONS: { value: TransactionStatus; label: string }[] = [
  { value: 'pending_sync', label: 'Pending sync' },
  { value: 'synced', label: 'Synced' },
  { value: 'pending_verify', label: 'Pending verify' },
  { value: 'verified', label: 'Verified' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'flagged', label: 'Flagged' },
  { value: 'voided', label: 'Voided' },
]

/**
 * Payment method options available in the filter bar.
 */
const PAYMENT_METHOD_OPTIONS: { value: PaymentMethod; label: string }[] = [
  { value: 'mpesa_stk', label: 'M-Pesa STK' },
  { value: 'mpesa_manual', label: 'M-Pesa manual' },
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' },
]

/**
 * Formats a money value with the business currency.
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
 * Formats an ISO timestamp for the transaction table.
 */
function formatDateTimeLabel(isoDate: string) {
  return new Date(isoDate).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Returns a readable payment method label.
 */
function getPaymentMethodLabel(method: PaymentMethod | null) {
  if (!method) {
    return 'No payment'
  }

  return PAYMENT_METHOD_OPTIONS.find((option) => option.value === method)?.label ?? method
}

/**
 * Returns a badge variant for transaction statuses.
 */
function getTransactionStatusVariant(status: TransactionStatus) {
  if (status === 'verified' || status === 'synced') return 'success'
  if (status === 'pending_verify' || status === 'pending_sync' || status === 'flagged') return 'warning'
  if (status === 'rejected' || status === 'voided') return 'danger'
  return 'muted'
}

/**
 * Returns a readable transaction status label.
 */
function getTransactionStatusLabel(status: TransactionStatus) {
  return STATUS_OPTIONS.find((option) => option.value === status)?.label ?? status
}

function formatNumber(value: number) {
  return value.toLocaleString(undefined, { maximumFractionDigits: 4 })
}

function formatTransactionItemQuantity(item: TransactionItemSummary) {
  const quantityInUom = item.quantityInUom ?? item.quantity
  const baseQuantity = item.baseQuantity ?? item.quantity
  const uomName = item.uomName ?? 'units'

  if (!item.uomConversionFactor || item.uomConversionFactor <= 1 || baseQuantity === quantityInUom) {
    return `${formatNumber(quantityInUom)} ${uomName}`
  }

  return `${formatNumber(quantityInUom)} ${uomName} (${formatNumber(baseQuantity)} ${item.baseUomName ?? 'base units'})`
}

function formatTransactionItemSummary(items: TransactionItemSummary[]) {
  if (items.length === 0) {
    return 'No items'
  }

  const visibleItems = items.slice(0, 2).map((item) => {
    const productLabel = item.isRecovery ? `Damaged: ${item.productName}` : item.productName
    return `${productLabel}: ${formatTransactionItemQuantity(item)}`
  })
  const hiddenCount = items.length - visibleItems.length

  return hiddenCount > 0 ? `${visibleItems.join(', ')} +${hiddenCount} more` : visibleItems.join(', ')
}

/**
 * Creates a URL for pagination while preserving active filters.
 */
function buildTransactionsHref(filters: TransactionFilters, page: number, basePath: string) {
  const params = new URLSearchParams()

  if (filters.branch) params.set('branch', filters.branch)
  if (filters.employeeId) params.set('employee', filters.employeeId)
  if (filters.status) params.set('status', filters.status)
  if (filters.paymentMethod) params.set('payment_method', filters.paymentMethod)
  if (filters.dateFrom) params.set('date_from', filters.dateFrom)
  if (filters.dateTo) params.set('date_to', filters.dateTo)
  if (filters.search) params.set('search', filters.search)
  if (page > 1) params.set('page', String(page))

  const query = params.toString()
  return query ? `${basePath}?${query}` : basePath
}

/**
 * Renders the transaction filter bar.
 */
function TransactionFilterBar({
  branches,
  filters,
  basePath,
}: {
  branches: BranchFilterRow[]
  filters: TransactionFilters
  basePath: string
}) {
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

  return (
    <Card padding="md">
      <CardHeader
        title="Filters"
        action={
          <button
            type="button"
            className="btn-outline"
            disabled
            title="Export is coming soon"
            style={{ padding: '8px 16px', borderRadius: 8, opacity: 0.65 }}
          >
            Export
          </button>
        }
      />

      <form action={basePath} method="get">
        <input type="hidden" name="page" value="1" />
        {filters.employeeId && <input type="hidden" name="employee" value={filters.employeeId} />}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-3">
          {/* Branch filter */}
          <label style={{ fontSize: 13 }}>
            <span style={{ display: 'block', marginBottom: 6, color: 'var(--color-text-muted)' }}>Branch</span>
            <select name="branch" defaultValue={filters.branch} style={inputStyle}>
              <option value="">All branches</option>
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </select>
          </label>

          {/* Status filter */}
          <label style={{ fontSize: 13 }}>
            <span style={{ display: 'block', marginBottom: 6, color: 'var(--color-text-muted)' }}>Status</span>
            <select name="status" defaultValue={filters.status} style={inputStyle}>
              <option value="">All statuses</option>
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          {/* Payment method filter */}
          <label style={{ fontSize: 13 }}>
            <span style={{ display: 'block', marginBottom: 6, color: 'var(--color-text-muted)' }}>
              Payment method
            </span>
            <select name="payment_method" defaultValue={filters.paymentMethod} style={inputStyle}>
              <option value="">All methods</option>
              {PAYMENT_METHOD_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          {/* Date range filter */}
          <label style={{ fontSize: 13 }}>
            <span style={{ display: 'block', marginBottom: 6, color: 'var(--color-text-muted)' }}>From</span>
            <input type="date" name="date_from" defaultValue={filters.dateFrom} style={inputStyle} />
          </label>

          {/* Date range filter */}
          <label style={{ fontSize: 13 }}>
            <span style={{ display: 'block', marginBottom: 6, color: 'var(--color-text-muted)' }}>To</span>
            <input type="date" name="date_to" defaultValue={filters.dateTo} style={inputStyle} />
          </label>

          {/* Employee search filter */}
          <label style={{ fontSize: 13 }}>
            <span style={{ display: 'block', marginBottom: 6, color: 'var(--color-text-muted)' }}>Recorded by</span>
            <input
              type="search"
              name="search"
              defaultValue={filters.search}
              placeholder="Search name"
              style={inputStyle}
            />
          </label>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center" style={{ marginTop: 14 }}>
          <button type="submit" className="btn-primary" style={{ padding: '8px 16px', borderRadius: 8 }}>
            Apply filters
          </button>
          <Link href={basePath} className="btn-outline" style={{ padding: '8px 16px', borderRadius: 8 }}>
            Clear filters
          </Link>
        </div>
      </form>
    </Card>
  )
}

/**
 * Renders the empty state shown when no transactions match the filters.
 */
function EmptyTransactionsState({ basePath }: { basePath: string }) {
  return (
    <div
      className="flex flex-col items-center justify-center text-center"
      style={{
        padding: '48px 20px',
        gap: '16px',
      }}
    >
      <div
        className="rounded-2xl"
        style={{
          width: '84px',
          height: '84px',
          display: 'grid',
          placeItems: 'center',
          backgroundColor: 'var(--color-primary-light)',
          color: 'var(--color-primary)',
        }}
      >
        <svg width="36" height="36" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3z" />
          <path d="M9 8h6" />
          <path d="M9 12h6" />
        </svg>
      </div>
      <div>
        <h2 style={{ fontSize: '20px', fontWeight: 600, color: 'var(--color-text-primary)', margin: 0 }}>
          No transactions found
        </h2>
        <p style={{ fontSize: '14px', color: 'var(--color-text-muted)', marginTop: '8px' }}>
          Try clearing filters or checking a wider date range.
        </p>
      </div>
      <Link href={basePath} className="btn-primary" style={{ padding: '10px 20px', borderRadius: 8 }}>
        Clear filters
      </Link>
    </div>
  )
}

/**
 * Owner transactions dashboard view.
 */
export default function TransactionsPageView({
  currency,
  branches,
  transactions,
  filters,
  metrics,
  totalCount,
  totalPages,
  basePath = '/dashboard/owner/transactions',
  subtitle = 'Review sales, payments, verification requests, and branch activity across the business.',
  canManageTransactions = true,
  recordTransactionHref = `${basePath}/new`,
  recordTransactionLabel = 'Record transaction',
}: Props) {
  const previousPage = Math.max(1, filters.page - 1)
  const nextPage = Math.min(totalPages, filters.page + 1)

  return (
    <div className="flex flex-col gap-6" data-currency={currency}>
      {/* Page header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1
            className="font-bold"
            style={{
              fontSize: '22px',
              color: 'var(--color-text-primary)',
              letterSpacing: '-0.3px',
            }}
          >
            Transactions
          </h1>
          <p style={{ fontSize: '14px', color: 'var(--color-text-muted)', marginTop: '4px' }}>
            {subtitle}
          </p>
        </div>
        <Link href={recordTransactionHref} className="btn-primary" style={{ padding: '9px 16px', borderRadius: 8, textDecoration: 'none' }}>
          {recordTransactionLabel}
        </Link>
      </div>

      {/* Summary metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <MetricCard label="Total today" value={formatMoney(metrics.totalToday, currency)} />
        <MetricCard label="Total this week" value={formatMoney(metrics.totalThisWeek, currency)} />
        <MetricCard label="Pending verifications" value={String(metrics.pendingVerifications)} />
        <MetricCard label="Rejected count" value={String(metrics.rejectedCount)} />
      </div>

      {/* URL-backed filters */}
      <TransactionFilterBar branches={branches} filters={filters} basePath={basePath} />

      {/* Transactions table */}
      <Card padding="md">
        <CardHeader
          title="Transaction history"
          action={
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
              {totalCount} {totalCount === 1 ? 'record' : 'records'}
            </span>
          }
        />

        {transactions.length === 0 ? (
          <EmptyTransactionsState basePath={basePath} />
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderSpacing: 0 }}>
                <thead>
                  <tr style={{ textAlign: 'left' }}>
                    {['Time', 'Branch', 'Recorded by', 'Items', 'Amount', 'Payment method', 'Status', 'Actions'].map((heading) => (
                      <th key={heading} style={{ padding: '12px', fontSize: '12px', color: 'var(--color-text-muted)' }}>
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((transaction, index) => (
                    <tr
                      key={transaction.id}
                      style={{
                        backgroundColor: index % 2 === 0 ? 'var(--color-background)' : 'var(--color-surface)',
                      }}
                    >
                      <td style={{ padding: '12px', fontSize: '13px', color: 'var(--color-text-primary)' }}>
                        {formatDateTimeLabel(transaction.recorded_at)}
                      </td>
                      <td style={{ padding: '12px', fontSize: '13px', color: 'var(--color-text-primary)' }}>
                        {transaction.branch_name}
                      </td>
                      <td style={{ padding: '12px', fontSize: '13px', color: 'var(--color-text-primary)' }}>
                        <div>
                          <p style={{ margin: 0, color: 'var(--color-text-primary)' }}>{transaction.employee_name}</p>
                          {transaction.employee_email && (
                            <p style={{ marginTop: 4, color: 'var(--color-text-muted)', fontSize: 12 }}>
                              {transaction.employee_email}
                            </p>
                          )}
                        </div>
                      </td>
                      <td style={{ padding: '12px', fontSize: '13px', color: 'var(--color-text-primary)', minWidth: 220 }}>
                        {formatTransactionItemSummary(transaction.item_summary)}
                      </td>
                      <td style={{ padding: '12px', fontSize: '13px', color: 'var(--color-text-primary)' }}>
                        <div>
                          <p style={{ margin: 0, color: 'var(--color-text-primary)', fontWeight: 700 }}>
                            {formatMoney(Number(transaction.total_amount), currency)}
                          </p>
                          {Number(transaction.discount_amount) > 0 && (
                            <p style={{ marginTop: 4, color: 'var(--color-text-muted)', fontSize: 12 }}>
                              Discount {formatMoney(Number(transaction.discount_amount), currency)}
                            </p>
                          )}
                        </div>
                      </td>
                      <td style={{ padding: '12px', fontSize: '13px', color: 'var(--color-text-primary)' }}>
                        {getPaymentMethodLabel(transaction.primary_payment?.payment_method ?? null)}
                      </td>
                      <td style={{ padding: '12px' }}>
                        <Badge variant={getTransactionStatusVariant(transaction.status)}>
                          {getTransactionStatusLabel(transaction.status)}
                        </Badge>
                      </td>
                      <td style={{ padding: '12px' }}>
                        <TransactionRowActions
                          transaction={transaction}
                          currency={currency}
                          canManage={canManageTransactions}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* URL-backed pagination */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between" style={{ marginTop: 16 }}>
              <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: 0 }}>
                Page {filters.page} of {totalPages}
              </p>
              <div className="flex gap-2">
                {filters.page <= 1 ? (
                  <span className="btn-outline" style={{ padding: '8px 16px', borderRadius: 8, opacity: 0.65 }}>
                    Previous
                  </span>
                ) : (
                  <Link href={buildTransactionsHref(filters, previousPage, basePath)} className="btn-outline" style={{ padding: '8px 16px', borderRadius: 8 }}>
                    Previous
                  </Link>
                )}
                {filters.page >= totalPages ? (
                  <span className="btn-outline" style={{ padding: '8px 16px', borderRadius: 8, opacity: 0.65 }}>
                    Next
                  </span>
                ) : (
                  <Link href={buildTransactionsHref(filters, nextPage, basePath)} className="btn-primary" style={{ padding: '8px 16px', borderRadius: 8 }}>
                    Next
                  </Link>
                )}
              </div>
            </div>
          </>
        )}
      </Card>
    </div>
  )
}
