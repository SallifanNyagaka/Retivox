/**
 * Employee web portal overview page.
 *
 * This read-only fallback portal shows only the current employee's own sales
 * activity at their single assigned branch. It intentionally avoids branch
 * aggregates, other employee data, and broad product/stock visibility.
 */

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Badge } from '../../../components/ui/Badge'
import { Card, CardHeader } from '../../../components/ui/Card'
import { MetricCard } from '../../../components/dashboard/MetricCard'
import TimeGreeting from '../../../components/dashboard/TimeGreeting'
import { requireAuth } from '../../../lib/auth/helpers'
import { getEmployeeProfile } from '../../../lib/employee/auth'
import logger from '../../../lib/logger'
import { createClient } from '../../../lib/supabase/server'
import type { EmployeeProductOption } from './transactions/new/RecordEmployeeTransactionForm'
import { mapEmployeeProductOption, type EmployeeAvailableProductRow } from './transactions/new/productOptions'
import EmployeeSalesTabs from './EmployeeSalesTabs'

/**
 * Business row used to render employee-owned money values.
 */
type BusinessCurrencyRow = {
  currency: string
}

/**
 * Transaction row shown in the employee overview.
 */
type EmployeeTransactionRow = {
  id: string
  status: string
  total_amount: number
  recorded_at: string
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
 * Formats transaction times without exposing branch/user context.
 */
function formatTimeLabel(isoDate: string) {
  return new Date(isoDate).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Returns the status badge variant for an employee-owned transaction.
 */
function getTransactionVariant(status: string) {
  if (status === 'verified' || status === 'synced') return 'success'
  if (status === 'pending_verify' || status === 'pending_sync') return 'warning'
  if (status === 'rejected' || status === 'flagged') return 'danger'
  return 'muted'
}

/**
 * Returns a human-readable transaction status label.
 */
function getTransactionLabel(status: string) {
  return status
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

/**
 * Small sales icon used in employee empty states and CTAs.
 */
function SalesIcon() {
  return (
    <svg width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path d="M4 19V5" />
      <path d="M4 19h16" />
      <path d="M8 16v-5" />
      <path d="M12 16V8" />
      <path d="M16 16v-3" />
    </svg>
  )
}

/**
 * Employee dashboard overview server component.
 */
export default async function EmployeeDashboardPage() {
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

  let currency = 'USD'
  let recentTransactions: EmployeeTransactionRow[] = []
  let todayTransactions: EmployeeTransactionRow[] = []
  let normalSaleProducts: EmployeeProductOption[] = []
  let damagedSaleProducts: EmployeeProductOption[] = []
  let pageError: string | null = null

  try {
    const supabase = await createClient()
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const todayStart = today.toISOString()

    const [businessResponse, todayResponse, recentResponse, productsResponse] = await Promise.all([
      supabase.from('businesses').select('currency').eq('id', employeeProfile.businessId).single(),
      supabase
        .from('transactions')
        .select('id, status, total_amount, recorded_at')
        .eq('business_id', employeeProfile.businessId)
        .eq('branch_id', employeeProfile.branchId)
        .eq('employee_id', employeeProfile.id)
        .gte('recorded_at', todayStart)
        .order('recorded_at', { ascending: false })
        .range(0, 49),
      supabase
        .from('transactions')
        .select('id, status, total_amount, recorded_at')
        .eq('business_id', employeeProfile.businessId)
        .eq('branch_id', employeeProfile.branchId)
        .eq('employee_id', employeeProfile.id)
        .order('recorded_at', { ascending: false })
        .range(0, 9),
      supabase.rpc('employee_available_products', {
        p_branch_id: employeeProfile.branchId,
      }),
    ])

    if (businessResponse.error) {
      throw businessResponse.error
    }

    if (todayResponse.error) {
      throw todayResponse.error
    }

    if (recentResponse.error) {
      throw recentResponse.error
    }

    if (productsResponse.error) {
      throw productsResponse.error
    }

    const business = businessResponse.data as BusinessCurrencyRow | null
    currency = business?.currency ?? currency
    todayTransactions = (todayResponse.data ?? []) as EmployeeTransactionRow[]
    recentTransactions = (recentResponse.data ?? []) as EmployeeTransactionRow[]
    const saleProducts = ((productsResponse.data ?? []) as EmployeeAvailableProductRow[]).map(mapEmployeeProductOption)
    normalSaleProducts = saleProducts.filter((product) => product.stockSource === 'normal')
    damagedSaleProducts = saleProducts.filter((product) => (
      product.stockSource === 'recovery'
      && product.recoveryItemId
      && product.baseQuantityOnHand > product.baseQuantityReserved
    ))
  } catch (error: unknown) {
    logger.error('EmployeeDashboardPage data fetch failed', {
      userId: employeeProfile.id,
      branchId: employeeProfile.branchId,
      businessId: employeeProfile.businessId,
      error,
    })
    pageError = error instanceof Error ? error.message : 'Unable to load employee overview'
  }

  const todayTotal = todayTransactions.reduce((sum, transaction) => sum + Number(transaction.total_amount), 0)

  if (pageError) {
    return (
      <Card padding="md">
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-text-primary)', letterSpacing: '-0.3px' }}>
          My Workday
        </h1>
        <p style={{ fontSize: 14, color: 'var(--color-danger)', marginTop: 8 }}>
          Failed to load your employee overview. Please refresh and try again.
        </p>
      </Card>
    )
  }

  return (
    <div className="mx-auto flex w-full flex-col items-center gap-6 text-center">
      {/* Page header */}
      <div className="flex w-full flex-col items-center justify-center gap-4 text-center">
        <div>
          <h1
            className="font-bold"
            style={{ fontSize: 22, color: 'var(--color-text-primary)', letterSpacing: '-0.3px' }}
          >
            <TimeGreeting />
          </h1>
          <p style={{ fontSize: 14, color: 'var(--color-text-muted)', marginTop: 4 }}>
            {employeeProfile.name} at {employeeProfile.branchName}
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <Link href="/dashboard/employee/transactions/new" className="btn-primary" style={{ padding: '10px 20px', borderRadius: 8 }}>
            Record transaction
          </Link>
          <Link href="/dashboard/employee/damaged-stock" className="btn-outline" style={{ padding: '10px 20px', borderRadius: 8 }}>
            Report damaged stock
          </Link>
        </div>
      </div>

      {/* Own activity metrics only */}
      <div className="grid w-full max-w-xl grid-cols-1 gap-4 sm:grid-cols-2">
        <MetricCard label="My sales today" value={String(todayTransactions.length)} icon={<SalesIcon />} />
        <MetricCard label="My processed total" value={formatMoney(todayTotal, currency)} icon={<SalesIcon />} />
      </div>

      <div className="w-full text-left">
        <EmployeeSalesTabs normalProducts={normalSaleProducts} damagedProducts={damagedSaleProducts} currency={currency} />
      </div>

      {/* Recent transactions are scoped by employee_id and branch_id. */}
      <div className="w-full">
      <Card padding="md">
        <CardHeader
          title="My recent transactions"
          action={
            <Link href="/dashboard/employee/transactions" className="btn-outline" style={{ padding: '5px 14px', borderRadius: 8 }}>
              View all
            </Link>
          }
        />

        {recentTransactions.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center" style={{ padding: '44px 20px', gap: 14 }}>
            <div
              className="rounded-2xl"
              style={{
                width: 84,
                height: 84,
                display: 'grid',
                placeItems: 'center',
                backgroundColor: 'var(--color-primary-light)',
                color: 'var(--color-primary)',
              }}
            >
              <SalesIcon />
            </div>
            <div>
              <h2 style={{ fontSize: 20, fontWeight: 600, color: 'var(--color-text-primary)', margin: 0 }}>
                No transactions yet
              </h2>
              <p style={{ fontSize: 14, color: 'var(--color-text-muted)', marginTop: 8 }}>
                Transactions you record at your assigned branch will appear here.
              </p>
            </div>
            <Link href="/dashboard/employee/transactions/new" className="btn-primary" style={{ padding: '10px 20px', borderRadius: 8 }}>
              Record transaction
            </Link>
            <Link href="/dashboard/employee/damaged-stock" className="btn-outline" style={{ padding: '10px 20px', borderRadius: 8 }}>
              Report damaged stock
            </Link>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderSpacing: 0 }}>
              <thead>
                <tr style={{ textAlign: 'center' }}>
                  {['Time', 'Amount', 'Status'].map((heading) => (
                    <th key={heading} style={{ padding: 12, fontSize: 12, color: 'var(--color-text-muted)' }}>
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recentTransactions.map((transaction, index) => (
                  <tr
                    key={transaction.id}
                    style={{ backgroundColor: index % 2 === 0 ? 'var(--color-background)' : 'var(--color-surface)' }}
                  >
                    <td style={{ padding: 12, fontSize: 13, color: 'var(--color-text-primary)', textAlign: 'center' }}>
                      {formatTimeLabel(transaction.recorded_at)}
                    </td>
                    <td style={{ padding: 12, fontSize: 13, color: 'var(--color-text-primary)', textAlign: 'center' }}>
                      {formatMoney(Number(transaction.total_amount), currency)}
                    </td>
                    <td style={{ padding: 12, textAlign: 'center' }}>
                      <Badge variant={getTransactionVariant(transaction.status)}>
                        {getTransactionLabel(transaction.status)}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      </div>
    </div>
  )
}
