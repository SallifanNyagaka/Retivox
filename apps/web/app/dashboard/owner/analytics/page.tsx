/**
 * Owner analytics page for Retivox.
 *
 * This server-only page fetches business-level analytics from Supabase,
 * then renders revenue, product performance, payment method breakdown,
 * and branch ranking summaries in a responsive dashboard layout.
 */

import Link from 'next/link'
import { requireRole } from '../../../../lib/auth/helpers'
import { GlobalRole, formatCurrency } from '@smartretail/shared'
import { createClient } from '../../../../lib/supabase/server'
import { Card, CardHeader } from '../../../../components/ui/Card'
import { Badge } from '../../../../components/ui/Badge'

// ── Data shapes for analytics results ──

type DayRevenue = {
  date: string
  total: number
}

type BranchRevenue = {
  branchName: string
  total: number
}

type TopProduct = {
  productName: string
  totalQty: number
  totalRevenue: number
}

type PaymentMethodStat = {
  method: string
  count: number
  total: number
}

type BusinessCurrencyRow = {
  currency: string
}

type AnalyticsSummary = {
  revenueByDay: DayRevenue[]
  revenueByBranch: BranchRevenue[]
  topProducts: TopProduct[]
  paymentMethods: PaymentMethodStat[]
  transactionCount: number
}

/**
 * Returns an ordinal label for a numeric rank.
 */
function getOrdinalLabel(rank: number) {
  if (rank === 1) return '1st'
  if (rank === 2) return '2nd'
  if (rank === 3) return '3rd'
  return `${rank}th`
}

/**
 * Returns a badge variant for the top branch ranks.
 */
function getRankVariant(rank: number) {
  if (rank === 1) return 'success'
  if (rank === 2) return 'info'
  if (rank === 3) return 'warning'
  return 'muted'
}

/**
 * Formats a date string to a compact human-readable label.
 */
function formatDateLabel(dateIso: string) {
  return new Date(dateIso).toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
  })
}

/**
 * Analytics dashboard page for business owners.
 */
export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>
}) {
  // Await searchParams and read the range value from URL query
  const params = await searchParams
  const rangeParam = params.range ?? '30'

  // Validate range parameter; default to '30' if invalid
  const validRanges = ['7', '30', '90']
  const range = validRanges.includes(rangeParam) ? rangeParam : '30'
  const rangeDays = parseInt(range, 10)

  const profile = await requireRole([GlobalRole.Owner])
  const businessId = profile.business_id

  if (!businessId) {
    throw new Error('Owner profile missing business ID')
  }

  const supabase = await createClient()

  // Fetch compact analytics summaries in parallel for the current business.
  const [businessResponse, analyticsResponse] = await Promise.all([
    supabase.from('businesses').select('currency').eq('id', businessId).single(),
    supabase.rpc('owner_analytics_summary', { p_range_days: rangeDays }),
  ])

  if (businessResponse.error) {
    throw businessResponse.error
  }

  const business = businessResponse.data as BusinessCurrencyRow | null

  if (!business?.currency) {
    throw new Error('Business currency missing')
  }

  if (analyticsResponse.error) {
    throw analyticsResponse.error
  }

  const currency = business.currency
  const summary = analyticsResponse.data as AnalyticsSummary | null
  const revenueByDay = summary?.revenueByDay ?? []
  const revenueByBranch = summary?.revenueByBranch ?? []
  const topProducts = summary?.topProducts ?? []
  const paymentMethods = summary?.paymentMethods ?? []
  const transactionCount = summary?.transactionCount ?? 0
  const paymentMethodTotal = paymentMethods.reduce((sum, method) => sum + method.total, 0)

  const totalRevenue = revenueByBranch.reduce((sum, branch) => sum + branch.total, 0)
  const totalTransactions = transactionCount
  const averageOrderValue = totalTransactions > 0 ? totalRevenue / totalTransactions : 0
  const bestBranch = revenueByBranch[0]?.branchName ?? '—'

  return (
    <div className="flex flex-col gap-6">
      {/* Header section */}
      <div className="flex flex-col gap-3">
        <div>
          <h1
            className="font-bold"
            style={{
              fontSize: '22px',
              color: 'var(--color-text-primary)',
              letterSpacing: '-0.3px',
            }}
          >
            Analytics
          </h1>
          <p style={{ fontSize: '14px', color: 'var(--color-text-muted)', marginTop: '4px' }}>
            Revenue and performance across all branches
          </p>
        </div>

        {/* Date range selector row */}
        <div className="flex flex-wrap gap-2">
          {[
            { label: 'Last 7 days', rangeValue: '7' },
            { label: 'Last 30 days', rangeValue: '30' },
            { label: 'Last 90 days', rangeValue: '90' },
          ].map(({ label, rangeValue }) => {
            const isActive = range === rangeValue
            return (
              <Link
                key={rangeValue}
                href={`?range=${rangeValue}`}
                className={isActive ? 'btn-primary' : 'btn-outline'}
                style={{
                  padding: '8px 16px',
                  fontSize: '13px',
                  borderRadius: '8px',
                }}
              >
                {label}
              </Link>
            )
          })}
        </div>
      </div>

      {/* Summary metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {[
          {
            label: 'Total revenue',
            value: formatCurrency(totalRevenue, currency),
          },
          {
            label: 'Total transactions',
            value: String(totalTransactions),
          },
          {
            label: 'Average order value',
            value: formatCurrency(averageOrderValue, currency),
          },
          {
            label: 'Best performing branch',
            value: bestBranch,
          },
        ].map((metric) => (
          <Card key={metric.label}>
            <p style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginBottom: '8px' }}>
              {metric.label}
            </p>
            <p style={{ fontSize: '20px', fontWeight: 600, color: 'var(--color-text-primary)' }}>
              {metric.value}
            </p>
          </Card>
        ))}
      </div>

      {/* Revenue and top products grid */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card>
          <CardHeader title="Revenue trend" />
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderSpacing: 0 }}>
              <thead>
                <tr style={{ textAlign: 'left' }}>
                  <th style={{ padding: '12px', fontSize: '12px', color: 'var(--color-text-muted)' }}>Date</th>
                  <th style={{ padding: '12px', fontSize: '12px', color: 'var(--color-text-muted)' }}>Revenue</th>
                </tr>
              </thead>
              <tbody>
                {revenueByDay.map((row, index) => (
                  <tr
                    key={row.date}
                    style={{
                      backgroundColor: index % 2 === 0 ? 'var(--color-background)' : 'var(--color-surface)',
                    }}
                  >
                    <td style={{ padding: '12px', fontSize: '13px', color: 'var(--color-text-primary)' }}>
                      {formatDateLabel(row.date)}
                    </td>
                    <td style={{ padding: '12px', fontSize: '13px', color: 'var(--color-text-primary)' }}>
                      {formatCurrency(row.total, currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card>
          <CardHeader title="Top products" />
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderSpacing: 0 }}>
              <thead>
                <tr style={{ textAlign: 'left' }}>
                  <th style={{ padding: '12px', fontSize: '12px', color: 'var(--color-text-muted)' }}>Product</th>
                  <th style={{ padding: '12px', fontSize: '12px', color: 'var(--color-text-muted)' }}>Quantity</th>
                  <th style={{ padding: '12px', fontSize: '12px', color: 'var(--color-text-muted)' }}>Revenue</th>
                </tr>
              </thead>
              <tbody>
                {topProducts.map((product, index) => (
                  <tr
                    key={product.productName}
                    style={{
                      backgroundColor: index % 2 === 0 ? 'var(--color-background)' : 'var(--color-surface)',
                    }}
                  >
                    <td style={{ padding: '12px', fontSize: '13px', color: 'var(--color-text-primary)' }}>
                      {product.productName}
                    </td>
                    <td style={{ padding: '12px', fontSize: '13px', color: 'var(--color-text-primary)' }}>
                      {product.totalQty}
                    </td>
                    <td style={{ padding: '12px', fontSize: '13px', color: 'var(--color-text-primary)' }}>
                      {formatCurrency(product.totalRevenue, currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      {/* Payment method breakdown */}
      <Card>
        <CardHeader title="Payment method breakdown" />
        <div className="flex flex-col gap-3">
          {paymentMethods.map((method) => {
            const percent = paymentMethodTotal > 0 ? (method.total / paymentMethodTotal) * 100 : 0

            return (
              <div
                key={method.method}
                style={{
                  backgroundColor: 'var(--color-background)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-card)',
                  padding: '12px',
                }}
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p style={{ fontSize: '13px', fontWeight: 500, color: 'var(--color-text-primary)' }}>
                      {method.method}
                    </p>
                    <p style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginTop: '2px' }}>
                      {method.count} transactions · {formatCurrency(method.total, currency)}
                    </p>
                  </div>
                  <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-text-primary)' }}>
                    {percent.toFixed(0)}%
                  </span>
                </div>
                <div
                  style={{
                    marginTop: '10px',
                    height: '8px',
                    backgroundColor: 'var(--color-border)',
                    borderRadius: '999px',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      width: `${percent}%`,
                      height: '100%',
                      backgroundColor: 'var(--color-accent)',
                    }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      </Card>

      {/* Branch performance table */}
      <Card>
        <CardHeader title="Branch performance" />
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderSpacing: 0 }}>
            <thead>
              <tr style={{ textAlign: 'left' }}>
                <th style={{ padding: '12px', fontSize: '12px', color: 'var(--color-text-muted)' }}>
                  Branch
                </th>
                <th style={{ padding: '12px', fontSize: '12px', color: 'var(--color-text-muted)' }}>
                  Revenue
                </th>
                <th style={{ padding: '12px', fontSize: '12px', color: 'var(--color-text-muted)' }}>
                  Share
                </th>
                <th style={{ padding: '12px', fontSize: '12px', color: 'var(--color-text-muted)' }}>
                  Rank
                </th>
              </tr>
            </thead>
            <tbody>
              {revenueByBranch.map((branch, index) => {
                const share = totalRevenue > 0 ? (branch.total / totalRevenue) * 100 : 0
                const rank = index + 1
                return (
                  <tr
                    key={branch.branchName}
                    style={{
                      backgroundColor: index % 2 === 0 ? 'var(--color-background)' : 'var(--color-surface)',
                    }}
                  >
                    <td style={{ padding: '12px', fontSize: '13px', color: 'var(--color-text-primary)' }}>
                      {branch.branchName}
                    </td>
                    <td style={{ padding: '12px', fontSize: '13px', color: 'var(--color-text-primary)' }}>
                      {formatCurrency(branch.total, currency)}
                    </td>
                    <td style={{ padding: '12px', fontSize: '13px', color: 'var(--color-text-primary)' }}>
                      {share.toFixed(1)}%
                    </td>
                    <td style={{ padding: '12px' }}>
                      <Badge variant={getRankVariant(rank)}>{getOrdinalLabel(rank)}</Badge>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
