/**
 * Admin dashboard page for Retivox.
 *
 * This server component gives branch administrators a focused operational
 * overview for their assigned branches: sales metrics, stock alerts, branch
 * coverage, and recent transactions.
 */

import { requireRole } from '../../../lib/auth/helpers'
import { getAccessibleBranchIds } from '../../../lib/auth/branchAccess'
import { createClient } from '../../../lib/supabase/server'
import { getStockAlerts } from '../../../lib/data/owner'
import logger from '../../../lib/logger'
import { GlobalRole } from '@smartretail/shared'
import { Card, CardHeader } from '../../../components/ui/Card'
import { Badge } from '../../../components/ui/Badge'
import { MetricCard } from '../../../components/dashboard/MetricCard'
import TimeGreeting from '../../../components/dashboard/TimeGreeting'

/**
 * Business row used to read the active currency.
 */
type BusinessRow = {
  currency: string
}

/**
 * Branch row shown in the admin branch coverage panel.
 */
type BranchRow = {
  id: string
  name: string
  location: string
  branch_type: string
  is_active: boolean
}

/**
 * Transaction row shown in the recent transactions table.
 */
type TransactionRow = {
  id: string
  branch_id: string
  total_amount: number
  status: string
  recorded_at: string
  users: {
    name: string
  } | {
    name: string
  }[] | null
  branches: {
    name: string
  } | {
    name: string
  }[] | null
}

/**
 * Stock row shown in the low stock panel.
 */
type LowStockRow = {
  id: string
  quantity_on_hand: number
  base_quantity_on_hand: number
  low_stock_threshold: number
  base_low_stock_threshold: number
  threshold_uom_name: string
  base_uom_name: string
  threshold_conversion_factor: number
  products: {
    name: string
    sku: string
  }[]
  branches: {
    name: string
  }[]
}

/**
 * Supabase joins can be returned as either an object or a single-item array.
 */
function normalizeJoinedOne<T>(value: T | T[] | null | undefined): T | null {
  if (!value) {
    return null
  }

  return Array.isArray(value) ? value[0] ?? null : value
}

/**
 * Formats monetary values with the current business currency.
 */
function formatMoney(amount: number, currency: string) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)
}

function formatAlertRemaining(
  baseQuantity: number,
  receivingUomName: string,
  baseUomName: string,
  conversionFactor: number
) {
  const formattedBase = baseQuantity.toLocaleString(undefined, { maximumFractionDigits: 4 })

  if (!conversionFactor || conversionFactor <= 1) {
    return `${formattedBase} ${baseUomName} remaining`
  }

  const receivingQuantity = Math.floor(baseQuantity / conversionFactor)
  const remainingBaseQuantity = Math.round((baseQuantity - receivingQuantity * conversionFactor) * 10000) / 10000

  if (receivingQuantity <= 0) {
    return `${formattedBase} ${baseUomName} remaining`
  }

  const formattedReceivingQuantity = receivingQuantity.toLocaleString(undefined, { maximumFractionDigits: 4 })
  const formattedRemainingBaseQuantity = remainingBaseQuantity.toLocaleString(undefined, { maximumFractionDigits: 4 })
  const remainderText = remainingBaseQuantity > 0 ? ` and ${formattedRemainingBaseQuantity} ${baseUomName}` : ''

  return `${formattedReceivingQuantity} ${receivingUomName}${remainderText} remaining (${formattedBase} ${baseUomName})`
}

/**
 * Formats an ISO timestamp into a compact time label.
 */
function formatTimeLabel(isoDate: string) {
  return new Date(isoDate).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Returns the badge style for a transaction status.
 */
function getTransactionVariant(status: string) {
  if (status === 'verified') return 'success'
  if (status === 'pending_verify') return 'warning'
  if (status === 'rejected') return 'danger'
  return 'muted'
}

/**
 * Returns the badge style for a branch type.
 */
function getBranchTypeVariant(branchType: string) {
  return branchType === 'warehouse' ? 'info' : 'success'
}

/**
 * Normalizes transaction status labels for display.
 */
function getStatusLabel(status: string) {
  if (status === 'pending_verify') return 'Pending'
  return status.charAt(0).toUpperCase() + status.slice(1)
}

/**
 * Small icon used by branch metric cards.
 */
function BranchIcon() {
  return (
    <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path d="M4 9l8-6 8 6v11a1 1 0 01-1 1h-5v-7H10v7H5a1 1 0 01-1-1V9z" />
    </svg>
  )
}

/**
 * Small icon used by sales metric cards.
 */
function SalesIcon() {
  return (
    <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path d="M4 19V5" />
      <path d="M8 17v-5" />
      <path d="M13 17V8" />
      <path d="M18 17v-3" />
    </svg>
  )
}

/**
 * Small icon used by stock metric cards.
 */
function StockIcon() {
  return (
    <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path d="M4 7l8-4 8 4-8 4-8-4z" />
      <path d="M4 7v10l8 4 8-4V7" />
    </svg>
  )
}

/**
 * Admin dashboard page component.
 */
export default async function AdminDashboardPage() {
  const profile = await requireRole([GlobalRole.Admin])
  const businessId = profile.business_id

  if (!businessId) {
    throw new Error('Admin profile missing business ID')
  }

  let pageError: unknown = null
  let currency = ''
  let assignedBranches: BranchRow[] = []
  let todayTransactions: TransactionRow[] = []
  let recentTransactions: TransactionRow[] = []
  let lowStockItems: LowStockRow[] = []
  let todayRevenue = 0

  try {
    const supabase = await createClient()
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const todayStart = today.toISOString()

    const branchIds = await getAccessibleBranchIds(profile.id, 'admin')

    const [businessResponse, assignedBranchesResponse] = await Promise.all([
      supabase.from('businesses').select('currency').eq('id', businessId).single(),
      branchIds.length > 0
        ? supabase
            .from('branches')
            .select('id, name, location, branch_type, is_active')
            .eq('business_id', businessId)
            .in('id', branchIds)
            .order('name')
        : Promise.resolve({ data: [], error: null }),
    ])

    if (businessResponse.error) {
      throw businessResponse.error
    }

    if (assignedBranchesResponse.error) {
      throw assignedBranchesResponse.error
    }

    const business = businessResponse.data as BusinessRow | null

    if (!business?.currency) {
      throw new Error('Business currency missing')
    }

    currency = business.currency
    assignedBranches = (assignedBranchesResponse.data ?? []) as BranchRow[]

    const [todayTransactionsResponse, recentTransactionsResponse] =
      branchIds.length > 0
        ? await Promise.all([
            supabase
              .from('transactions')
              .select('id, branch_id, total_amount, status, recorded_at, users!inner(name), branches!inner(name)')
              .eq('business_id', businessId)
              .in('branch_id', branchIds)
              .gte('recorded_at', todayStart)
              .order('recorded_at', { ascending: false }),
            supabase
              .from('transactions')
              .select('id, branch_id, total_amount, status, recorded_at, users!inner(name), branches!inner(name)')
              .eq('business_id', businessId)
              .in('branch_id', branchIds)
              .order('recorded_at', { ascending: false })
              .limit(8),
          ])
        : [
            { data: [], error: null },
            { data: [], error: null },
          ]

    if (todayTransactionsResponse.error) {
      throw todayTransactionsResponse.error
    }

    if (recentTransactionsResponse.error) {
      throw recentTransactionsResponse.error
    }

    todayTransactions = (todayTransactionsResponse.data ?? []) as TransactionRow[]
    recentTransactions = (recentTransactionsResponse.data ?? []) as TransactionRow[]
    lowStockItems = branchIds.length > 0 ? ((await getStockAlerts(businessId, branchIds, 6)) as LowStockRow[]) : []
    todayRevenue = todayTransactions.reduce((sum, transaction) => sum + Number(transaction.total_amount), 0)
  } catch (error: unknown) {
    logger.error('AdminDashboardPage data fetch failed', { businessId, error })
    pageError = error
  }

  if (pageError) {
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h1
            className="font-bold"
            style={{
              fontSize: '22px',
              color: 'var(--color-text-primary)',
              letterSpacing: '-0.3px',
            }}
          >
            Admin Dashboard
          </h1>
          <p style={{ fontSize: '14px', color: 'var(--color-text-muted)', marginTop: '4px' }}>
            We could not load your admin dashboard right now.
          </p>
        </div>

        <Card>
          <p style={{ fontSize: '14px', color: 'var(--color-danger)', margin: 0 }}>
            Failed to load admin content. Please refresh and try again.
          </p>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Page header */}
      <div>
        <h1
          className="font-bold"
          style={{
            fontSize: '22px',
            color: 'var(--color-text-primary)',
            letterSpacing: '-0.3px',
          }}
        >
          <TimeGreeting />
        </h1>
        <p style={{ fontSize: '14px', color: 'var(--color-text-muted)', marginTop: '4px' }}>
          Monitor branch performance, stock alerts, and sales activity.
        </p>
      </div>

        {/* Summary metrics */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <MetricCard label="Branches assigned" value={String(assignedBranches.length)} icon={<BranchIcon />} />
          <MetricCard label="Sales today" value={String(todayTransactions.length)} icon={<SalesIcon />} />
          <MetricCard label="Revenue today" value={formatMoney(todayRevenue, currency)} icon={<SalesIcon />} />
          <MetricCard label="Low-stock alerts" value={String(lowStockItems.length)} icon={<StockIcon />} />
        </div>

        {/* Branch coverage */}
        <Card padding="md">
          <CardHeader title="Branch coverage" />

          {assignedBranches.length === 0 ? (
            <div
              className="flex flex-col items-center justify-center text-center"
              style={{ padding: '44px 20px', gap: '14px' }}
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
                <BranchIcon />
              </div>
              <div>
                <h2 style={{ fontSize: '20px', fontWeight: 600, color: 'var(--color-text-primary)', margin: 0 }}>
                  No assigned branches
                </h2>
                <p style={{ fontSize: '14px', color: 'var(--color-text-muted)', marginTop: '8px' }}>
                  Ask the owner to assign branches to this admin account.
                </p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {assignedBranches.map((branch) => (
                <div
                  key={branch.id}
                  className="rounded-xl border"
                  style={{
                    borderColor: 'var(--color-border)',
                    backgroundColor: 'var(--color-background)',
                    padding: '16px',
                  }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p style={{ fontSize: '15px', fontWeight: 600, color: 'var(--color-text-primary)', margin: 0 }}>
                        {branch.name}
                      </p>
                      <p style={{ fontSize: '13px', color: 'var(--color-text-muted)', marginTop: '6px' }}>
                        {branch.location}
                      </p>
                    </div>
                    <Badge variant={branch.is_active ? 'success' : 'muted'}>
                      {branch.is_active ? 'Active' : 'Inactive'}
                    </Badge>
                  </div>

                  <div className="flex flex-wrap gap-2" style={{ marginTop: '12px' }}>
                    <Badge variant={getBranchTypeVariant(branch.branch_type)}>{branch.branch_type}</Badge>
                    <Badge variant="info">
                      {todayTransactions.filter((transaction) => transaction.branch_id === branch.id).length} sales today
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Activity grid */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <Card padding="md">
            <CardHeader title="Recent transactions" />

            {recentTransactions.length === 0 ? (
              <p style={{ fontSize: '14px', color: 'var(--color-text-muted)', margin: 0 }}>
                No transactions have been recorded for your assigned branches yet.
              </p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderSpacing: 0 }}>
                  <thead>
                    <tr style={{ textAlign: 'left' }}>
                      {['Time', 'Branch', 'Employee', 'Amount', 'Status'].map((heading) => (
                        <th key={heading} style={{ padding: '12px', fontSize: '12px', color: 'var(--color-text-muted)' }}>
                          {heading}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {recentTransactions.map((transaction, index) => {
                      const branch = normalizeJoinedOne(transaction.branches)
                      const employee = normalizeJoinedOne(transaction.users)

                      return (
                        <tr
                          key={transaction.id}
                          style={{
                            backgroundColor: index % 2 === 0 ? 'var(--color-background)' : 'var(--color-surface)',
                          }}
                        >
                          <td style={{ padding: '12px', fontSize: '13px', color: 'var(--color-text-primary)' }}>
                            {formatTimeLabel(transaction.recorded_at)}
                          </td>
                          <td style={{ padding: '12px', fontSize: '13px', color: 'var(--color-text-primary)' }}>
                            {branch?.name ?? 'Unknown branch'}
                          </td>
                          <td style={{ padding: '12px', fontSize: '13px', color: 'var(--color-text-primary)' }}>
                            {employee?.name ?? 'Unknown employee'}
                          </td>
                          <td style={{ padding: '12px', fontSize: '13px', color: 'var(--color-text-primary)' }}>
                            {formatMoney(Number(transaction.total_amount), currency)}
                          </td>
                          <td style={{ padding: '12px' }}>
                            <Badge variant={getTransactionVariant(transaction.status)}>
                              {getStatusLabel(transaction.status)}
                            </Badge>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card padding="md">
            <CardHeader title="Low stock alerts" />

            {lowStockItems.length === 0 ? (
              <p style={{ fontSize: '14px', color: 'var(--color-text-muted)', margin: 0 }}>
                No low-stock items for your assigned branches right now.
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                {lowStockItems.map((item) => {
                  const product = normalizeJoinedOne(item.products)
                  const branch = normalizeJoinedOne(item.branches)

                  return (
                  <div
                    key={item.id}
                    className="flex items-start justify-between gap-3 rounded-xl border"
                    style={{
                      borderColor: 'var(--color-border)',
                      backgroundColor: 'var(--color-background)',
                      padding: '14px 16px',
                    }}
                  >
                    <div>
                      <p style={{ fontSize: '14px', fontWeight: 600, color: 'var(--color-text-primary)', margin: 0 }}>
                        {product?.name ?? 'Unknown product'}
                      </p>
                      <p style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginTop: '6px' }}>
                        {product?.sku ?? '-'} - {branch?.name ?? 'Unknown branch'}
                      </p>
                      <p style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginTop: '4px' }}>
                        Threshold: {Number(item.low_stock_threshold).toLocaleString(undefined, { maximumFractionDigits: 4 })} {item.threshold_uom_name}
                        {item.threshold_conversion_factor !== 1
                          ? ` (${Number(item.base_low_stock_threshold).toLocaleString(undefined, { maximumFractionDigits: 4 })} ${item.base_uom_name})`
                          : ''}
                      </p>
                    </div>
                    <Badge variant={Number(item.base_quantity_on_hand) <= 0 ? 'danger' : 'warning'}>
                      {formatAlertRemaining(
                        Number(item.base_quantity_on_hand),
                        item.threshold_uom_name,
                        item.base_uom_name,
                        Number(item.threshold_conversion_factor)
                      )}
                    </Badge>
                  </div>
                  )
                })}
              </div>
            )}
          </Card>
        </div>
    </div>
  )
}
