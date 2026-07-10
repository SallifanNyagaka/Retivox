/**
 * Owner dashboard — main overview page.
 * Shows metrics, branch summaries, stock alerts,
 * pending approvals and recent transactions.
 * Server component — all data fetched server side.
 */

import { requireRole } from '../../../lib/auth/helpers'
import { GlobalRole, formatCurrency } from '@smartretail/shared'
import Link from 'next/link'
import {
  getOwnerMetrics,
  getBranchSummaries,
  getStockAlerts,
  getPendingApprovals,
  getRecentTransactions,
} from '../../../lib/data/owner'
import { createClient } from '../../../lib/supabase/server'
import { MetricCard } from '../../../components/dashboard/MetricCard'
import { Card, CardHeader } from '../../../components/ui/Card'
import { Badge } from '../../../components/ui/Badge'

// ── Types ──
type Branch = {
  id: string
  name: string
  location: string
  branch_type: string
  is_active: boolean
  todayRevenue: number
}

type StockAlert = {
  id: string
  quantity_on_hand: number
  base_quantity_on_hand: number
  low_stock_threshold: number
  base_low_stock_threshold: number
  threshold_uom_name: string
  base_uom_name: string
  threshold_conversion_factor: number
  products: { name: string; sku?: string | null }[] | null
  branches: { name: string }[] | null
}

type PendingPayment = {
  id: string
  amount: number
  payment_method: string
  payment_at: string
  transactions: {
    branch_id: string
    employee_id: string
    branches: { name: string }[] | null
    users: { name: string }[] | null
  }[] | null
}

type PendingPrice = {
  id: string
  old_price: number
  new_price: number
  requested_at: string
  branch_product_prices: {
    products: { name: string }[] | null
    branches: { name: string }[] | null
  }[] | null
  users: { name: string }[] | null
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

type Transaction = {
  id: string
  total_amount: number
  status: string
  recorded_at: string
  branches: { name: string }[] | null
  users: { name: string }[] | null
}

// ── Icons ──
function RevenueIcon() {
  return (
    <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <line x1="12" y1="1" x2="12" y2="23" />
      <path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
    </svg>
  )
}

function TxIcon() {
  return (
    <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  )
}

function AlertIcon() {
  return (
    <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  )
}

function StoreIcon() {
  return (
    <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  )
}

// ── Sub components ──

function ApproveRejectButtons() {
  return (
    <div className="flex gap-2 mt-2">
      {/* Quick links keep the pending-approval cards actionable until the full workflow ships. */}
      <Link
        href="/dashboard/owner/transactions"
        className="btn-success"
        style={{
          padding: '5px 14px',
          fontSize: '12px',
          borderRadius: '999px',
          textDecoration: 'none',
        }}
      >
        Open transactions
      </Link>
      <Link
        href="/dashboard/owner/audit"
        className="btn-danger"
        style={{
          padding: '5px 14px',
          fontSize: '12px',
          borderRadius: '999px',
          textDecoration: 'none',
        }}
      >
        Open audit log
      </Link>
    </div>
  )
}

function BranchRow({ branch, currency }: { branch: Branch; currency: string }) {
  return (
    <div
      className="flex items-center justify-between py-2.5 px-3 rounded-lg"
      style={{ backgroundColor: 'var(--color-background)' }}
    >
      <div className="flex items-center gap-3">
        <div
          className="w-2 h-2 rounded-full flex-shrink-0"
          style={{
            backgroundColor: branch.is_active
              ? 'var(--color-success)'
              : 'var(--color-text-muted)',
          }}
        />
        <div>
          <p style={{ fontSize: '13px', fontWeight: 500, color: 'var(--color-text-primary)' }}>
            {branch.name}
          </p>
          <p style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>
            {branch.location}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--color-text-primary)' }}>
          {formatCurrency(branch.todayRevenue, currency)}
        </span>
        <Badge variant={branch.is_active ? 'success' : 'muted'}>
          {branch.is_active ? 'Active' : 'Inactive'}
        </Badge>
      </div>
    </div>
  )
}

function StockAlertRow({ alert }: { alert: StockAlert }) {
  const baseOnHand = Number(alert.base_quantity_on_hand ?? alert.quantity_on_hand)
  const baseThreshold = Number(alert.base_low_stock_threshold ?? alert.low_stock_threshold)
  const pct = baseThreshold > 0 ? Math.min(100, (baseOnHand / baseThreshold) * 100) : 0
  const isCritical = baseOnHand <= Math.min(5, baseThreshold)
  const thresholdLabel = `${Number(alert.low_stock_threshold).toLocaleString(undefined, { maximumFractionDigits: 4 })} ${alert.threshold_uom_name}`
  const baseLabel = alert.threshold_conversion_factor === 1
    ? null
    : `${Number(alert.base_low_stock_threshold).toLocaleString(undefined, { maximumFractionDigits: 4 })} ${alert.base_uom_name}`
  const remainingLabel = formatAlertRemaining(
    baseOnHand,
    alert.threshold_uom_name,
    alert.base_uom_name,
    Number(alert.threshold_conversion_factor)
  )

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <div>
          <p style={{ fontSize: '13px', fontWeight: 500, color: 'var(--color-text-primary)' }}>
            {alert.products?.[0]?.name ?? '—'}
          </p>
          <p style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>
            {alert.branches?.[0]?.name ?? '—'}
          </p>
        </div>
        <Badge variant={isCritical ? 'danger' : 'warning'}>
          {remainingLabel}
        </Badge>
      </div>
      <p style={{ fontSize: '11px', color: 'var(--color-text-muted)', margin: '0 0 6px' }}>
        Threshold: {thresholdLabel}{baseLabel ? ` (${baseLabel})` : ''}
      </p>
      <div
        style={{
          height: '3px',
          backgroundColor: 'var(--color-border)',
          borderRadius: '2px',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${pct}%`,
            backgroundColor: isCritical ? 'var(--color-danger)' : 'var(--color-accent)',
            borderRadius: '2px',
          }}
        />
      </div>
    </div>
  )
}

function PaymentApprovalRow({
  payment,
  currency,
}: {
  payment: PendingPayment
  currency: string
}) {
  return (
    <div
      className="flex items-start gap-3 pb-3"
      style={{ borderBottom: '1px solid var(--color-border)' }}
    >
      <div
        className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
        style={{ backgroundColor: 'var(--color-primary-light)' }}
      >
        <span style={{ fontSize: '14px' }}>💰</span>
      </div>
      <div className="flex-1 min-w-0">
        <p style={{ fontSize: '13px', fontWeight: 500, color: 'var(--color-text-primary)' }}>
          Cash deposit — {payment.transactions?.[0]?.branches?.[0]?.name ?? '—'}
        </p>
        <p style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginTop: '2px' }}>
          {payment.transactions?.[0]?.users?.[0]?.name ?? '—'} · {formatCurrency(Number(payment.amount), currency)}
        </p>
        <ApproveRejectButtons />
      </div>
    </div>
  )
}

function PriceApprovalRow({
  price,
  currency,
}: {
  price: PendingPrice
  currency: string
}) {
  return (
    <div
      className="flex items-start gap-3 pb-3"
      style={{ borderBottom: '1px solid var(--color-border)' }}
    >
      <div
        className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
        style={{ backgroundColor: 'var(--color-accent-light)' }}
      >
        <span style={{ fontSize: '14px' }}>🏷️</span>
      </div>
      <div className="flex-1 min-w-0">
        <p style={{ fontSize: '13px', fontWeight: 500, color: 'var(--color-text-primary)' }}>
          Price change — {price.branch_product_prices?.[0]?.products?.[0]?.name ?? '—'}
        </p>
        <p style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginTop: '2px' }}>
          {formatCurrency(Number(price.old_price), currency)} → {formatCurrency(Number(price.new_price), currency)}
        </p>
        <ApproveRejectButtons />
      </div>
    </div>
  )
}

function TransactionRow({
  tx,
  isLast,
  currency,
}: {
  tx: Transaction
  isLast: boolean
  currency: string
}) {
  const statusVariant = (): 'success' | 'warning' | 'danger' | 'muted' => {
    if (tx.status === 'verified') return 'success'
    if (tx.status === 'pending_verify') return 'warning'
    if (tx.status === 'rejected') return 'danger'
    return 'muted'
  }

  return (
    <div
      className="flex items-center justify-between py-2.5"
      style={{ borderBottom: isLast ? 'none' : '1px solid var(--color-border)' }}
    >
      <div>
        <p style={{ fontSize: '13px', fontWeight: 500, color: 'var(--color-text-primary)' }}>
          {tx.branches?.[0]?.name ?? '—'}
        </p>
        <p style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginTop: '1px' }}>
          {tx.users?.[0]?.name ?? '—'} · {new Date(tx.recorded_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--color-text-primary)' }}>
          {formatCurrency(Number(tx.total_amount), currency)}
        </span>
        <Badge variant={statusVariant()}>
          {tx.status === 'pending_verify' ? 'Pending' : tx.status}
        </Badge>
      </div>
    </div>
  )
}

// ── Main page ──
export default async function OwnerDashboardPage() {
  const profile = await requireRole([GlobalRole.Owner])
  const businessId = profile.business_id

  if (!businessId) {
    throw new Error('Owner profile missing business ID')
  }

  const supabase = await createClient()

  // Fetch all data in parallel for performance
  const [businessResponse, metrics, branches, stockAlerts, approvals, transactions] = await Promise.all([
    supabase.from('businesses').select('currency').eq('id', businessId).single(),
    getOwnerMetrics(businessId),
    getBranchSummaries(businessId),
    getStockAlerts(businessId),
    getPendingApprovals(businessId),
    getRecentTransactions(businessId),
  ])

  if (businessResponse.error) {
    throw businessResponse.error
  }

  const business = businessResponse.data as { currency: string } | null

  if (!business?.currency) {
    throw new Error('Business currency missing')
  }

  const currency = business.currency

  const typedBranches = branches as Branch[]
  const typedAlerts = stockAlerts as StockAlert[]
  const typedPayments = approvals.payments as PendingPayment[]
  const typedPrices = approvals.prices as PendingPrice[]
  const typedTransactions = transactions as Transaction[]

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
          Good morning 👋
        </h1>
        <p style={{ fontSize: '14px', color: 'var(--color-text-muted)', marginTop: '4px' }}>
          Here&apos;s what&apos;s happening across your business today.
        </p>
      </div>

      {/* Metric cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          label="Total revenue today"
          value={formatCurrency(metrics.totalRevenue, currency)}
          deltaType="neutral"
          icon={<RevenueIcon />}
        />
        <MetricCard
          label="Transactions today"
          value={metrics.txCount.toString()}
          deltaType="neutral"
          icon={<TxIcon />}
        />
        <MetricCard
          label="Active branches"
          value={typedBranches.filter(b => b.is_active).length.toString()}
          deltaType="neutral"
          icon={<StoreIcon />}
        />
        <MetricCard
          label="Pending approvals"
          value={metrics.pendingApprovals.toString()}
          deltaType={metrics.pendingApprovals > 0 ? 'down' : 'neutral'}
          valueColor={
            metrics.pendingApprovals > 0
              ? 'var(--color-accent)'
              : 'var(--color-text-primary)'
          }
          icon={<AlertIcon />}
        />
      </div>

      {/* Branch overview + Stock alerts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <Card padding="md">
            <CardHeader title="Branch overview" />
            {typedBranches.length === 0 ? (
              <p style={{ fontSize: '13px', color: 'var(--color-text-muted)' }}>
                No branches yet. Add your first branch to get started.
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {typedBranches.map(branch => (
                  <BranchRow key={branch.id} branch={branch} currency={currency} />
                ))}
              </div>
            )}
          </Card>
        </div>

        <Card padding="md">
          <CardHeader title="Stock alerts" />
          {typedAlerts.length === 0 ? (
            <p style={{ fontSize: '13px', color: 'var(--color-text-muted)' }}>
              All stock levels are healthy.
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {typedAlerts.map(alert => (
                <StockAlertRow key={alert.id} alert={alert} />
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Pending approvals + Recent transactions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card padding="md">
          <CardHeader title="Pending approvals" />
          {typedPayments.length === 0 && typedPrices.length === 0 ? (
            <p style={{ fontSize: '13px', color: 'var(--color-text-muted)' }}>
              No pending approvals. You&apos;re all caught up.
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {typedPayments.map(payment => (
                <PaymentApprovalRow
                  key={payment.id}
                  payment={payment}
                  currency={currency}
                />
              ))}
              {typedPrices.map(price => (
                <PriceApprovalRow
                  key={price.id}
                  price={price}
                  currency={currency}
                />
              ))}
            </div>
          )}
        </Card>

        <Card padding="md">
          <CardHeader title="Recent transactions" />
          {typedTransactions.length === 0 ? (
            <p style={{ fontSize: '13px', color: 'var(--color-text-muted)' }}>
              No transactions yet today.
            </p>
          ) : (
            <div className="flex flex-col">
              {typedTransactions.map((tx, index) => (
                <TransactionRow
                  key={tx.id}
                  tx={tx}
                  isLast={index === typedTransactions.length - 1}
                  currency={currency}
                />
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
