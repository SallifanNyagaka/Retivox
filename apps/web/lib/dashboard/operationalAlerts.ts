/**
 * Live operational risk alerts for owner/admin dashboards.
 */

import { getAccessibleBranchIds } from '../auth/branchAccess'
import logger from '../logger'
import { createClient } from '../supabase/server'

export type OperationalAlertSeverity = 'high' | 'medium' | 'low'

export type OperationalAlert = {
  id: string
  severity: OperationalAlertSeverity
  category: 'cash' | 'damage' | 'verification' | 'stock'
  title: string
  description: string
  branchId: string | null
  branchName: string | null
  href: string
}

type BranchRow = {
  id: string
  name: string
}

type DamageReportRow = {
  branch_id: string
  reported_by: string | null
  status: string
  base_quantity: number | string
  created_at: string
}

type CashDepositRow = {
  id: string
  branch_id: string
  amount: number | string
  expected_cash_amount: number | string
  variance_amount: number | string
  status: string
  deposit_date: string
}

type TransactionRow = {
  id: string
  branch_id: string
  employee_id: string | null
  status: string
  total_amount: number | string
}

type StockRow = {
  branch_id: string
  product_id: string
  base_quantity_on_hand: number | string
  products: { name: string } | { name: string }[] | null
}

type SoldItemRow = {
  product_id: string | null
  transactions: { branch_id: string | null; status: string } | { branch_id: string | null; status: string }[] | null
}

function normalizeJoinedOne<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null
  return Array.isArray(value) ? value[0] ?? null : value
}

function toNumber(value: number | string | null | undefined): number {
  const numericValue = Number(value ?? 0)
  return Number.isFinite(numericValue) ? numericValue : 0
}

function formatMoneyLike(amount: number) {
  return amount.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

export async function getOperationalAlerts(
  userId: string,
  businessId: string,
  options: { minimumRole?: 'owner' | 'admin'; limit?: number; baseHref?: string } = {}
): Promise<OperationalAlert[]> {
  const supabase = await createClient()
  const limit = options.limit ?? 8
  const baseHref = options.baseHref ?? '/dashboard/owner'
  const isAdminDashboard = baseHref.includes('/dashboard/admin')
  const damageHref = isAdminDashboard ? `${baseHref}/damaged-stock` : `${baseHref}/finances`
  const cashHref = isAdminDashboard ? `${baseHref}/transactions` : `${baseHref}/finances`

  try {
    const branchIds = await getAccessibleBranchIds(userId, options.minimumRole ?? 'admin')

    if (branchIds.length === 0) {
      return []
    }

    const now = new Date()
    const today = new Date(now)
    today.setHours(0, 0, 0, 0)
    const sevenDaysAgo = new Date(now)
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
    const thirtyDaysAgo = new Date(now)
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

    const [branchesResponse, damagesResponse, transactionsResponse, stockResponse, soldItemsResponse] = await Promise.all([
      supabase
        .from('branches')
        .select('id, name')
        .eq('business_id', businessId)
        .eq('is_active', true)
        .is('deleted_at', null)
        .in('id', branchIds),
      supabase
        .from('employee_inventory_loss_reports')
        .select('branch_id, reported_by, status, base_quantity, created_at')
        .eq('business_id', businessId)
        .in('branch_id', branchIds)
        .gte('created_at', sevenDaysAgo.toISOString()),
      supabase
        .from('transactions')
        .select('id, branch_id, employee_id, status, total_amount')
        .eq('business_id', businessId)
        .in('branch_id', branchIds)
        .gte('recorded_at', today.toISOString()),
      supabase
        .from('branch_stock')
        .select('branch_id, product_id, base_quantity_on_hand, products(name)')
        .eq('business_id', businessId)
        .in('branch_id', branchIds)
        .gt('base_quantity_on_hand', 0)
        .range(0, 199),
      supabase
        .from('transaction_items')
        .select('product_id, transactions!inner(branch_id, status, recorded_at)')
        .eq('business_id', businessId)
        .in('transactions.branch_id', branchIds)
        .in('transactions.status', ['verified', 'pending_verify', 'synced'])
        .gte('transactions.recorded_at', thirtyDaysAgo.toISOString())
        .range(0, 999),
    ])

    if (branchesResponse.error) throw branchesResponse.error
    if (damagesResponse.error) throw damagesResponse.error
    if (transactionsResponse.error) throw transactionsResponse.error
    if (stockResponse.error) throw stockResponse.error
    if (soldItemsResponse.error) throw soldItemsResponse.error

    const branchesById = new Map((branchesResponse.data ?? []).map((branch) => [branch.id, branch.name] as const))
    const alerts: OperationalAlert[] = []
    const damages = (damagesResponse.data ?? []) as DamageReportRow[]
    const transactions = (transactionsResponse.data ?? []) as TransactionRow[]

    const damageByBranch = new Map<string, { count: number; quantity: number }>()
    const damageByEmployeeBranch = new Map<string, { branchId: string; employeeId: string; count: number; quantity: number }>()

    damages.forEach((damage) => {
      const branchStats = damageByBranch.get(damage.branch_id) ?? { count: 0, quantity: 0 }
      branchStats.count += 1
      branchStats.quantity += toNumber(damage.base_quantity)
      damageByBranch.set(damage.branch_id, branchStats)

      if (damage.reported_by) {
        const key = `${damage.branch_id}:${damage.reported_by}`
        const employeeStats = damageByEmployeeBranch.get(key) ?? {
          branchId: damage.branch_id,
          employeeId: damage.reported_by,
          count: 0,
          quantity: 0,
        }
        employeeStats.count += 1
        employeeStats.quantity += toNumber(damage.base_quantity)
        damageByEmployeeBranch.set(key, employeeStats)
      }
    })

    damageByBranch.forEach((stats, branchId) => {
      if (stats.count >= 5 || stats.quantity >= 20) {
        alerts.push({
          id: `damage-branch-${branchId}`,
          severity: stats.count >= 8 || stats.quantity >= 50 ? 'high' : 'medium',
          category: 'damage',
          title: 'Frequent damage reports',
          description: `${stats.count} damage reports affecting ${stats.quantity.toLocaleString()} base units in the last 7 days.`,
          branchId,
          branchName: branchesById.get(branchId) ?? 'Unknown branch',
          href: damageHref,
        })
      }
    })

    damageByEmployeeBranch.forEach((stats) => {
      if (stats.count >= 3) {
        alerts.push({
          id: `damage-employee-${stats.branchId}-${stats.employeeId}`,
          severity: 'high',
          category: 'damage',
          title: 'Repeated damage tied to one staff member',
          description: `${stats.count} damage reports from the same staff member in the last 7 days. Review handling and shift records.`,
          branchId: stats.branchId,
          branchName: branchesById.get(stats.branchId) ?? 'Unknown branch',
          href: damageHref,
        })
      }
    })

    const unverifiedByBranch = new Map<string, { count: number; amount: number }>()
    transactions.forEach((transaction) => {
      if (transaction.status !== 'pending_verify') {
        return
      }

      const current = unverifiedByBranch.get(transaction.branch_id) ?? { count: 0, amount: 0 }
      current.count += 1
      current.amount += toNumber(transaction.total_amount)
      unverifiedByBranch.set(transaction.branch_id, current)
    })

    unverifiedByBranch.forEach((stats, branchId) => {
      if (stats.count >= 3 || stats.amount > 0) {
        alerts.push({
          id: `unverified-${branchId}`,
          severity: stats.amount >= 10000 || stats.count >= 8 ? 'high' : 'medium',
          category: 'verification',
          title: 'Unverified sales need owner review',
          description: `${stats.count} unverified transactions today worth ${formatMoneyLike(stats.amount)}.`,
          branchId,
          branchName: branchesById.get(branchId) ?? 'Unknown branch',
          href: `${baseHref}/transactions?branch=${branchId}&status=pending_verify`,
        })
      }
    })

    const soldProductBranchKeys = new Set<string>()
    ;((soldItemsResponse.data ?? []) as SoldItemRow[]).forEach((item) => {
      const transaction = normalizeJoinedOne(item.transactions)

      if (item.product_id && transaction?.branch_id) {
        soldProductBranchKeys.add(`${transaction.branch_id}:${item.product_id}`)
      }
    })

    ;((stockResponse.data ?? []) as StockRow[])
      .filter((stock) => !soldProductBranchKeys.has(`${stock.branch_id}:${stock.product_id}`))
      .slice(0, 4)
      .forEach((stock) => {
        const product = normalizeJoinedOne(stock.products)
        alerts.push({
          id: `slow-stock-${stock.branch_id}-${stock.product_id}`,
          severity: 'low',
          category: 'stock',
          title: 'Stock has not sold recently',
          description: `${product?.name ?? 'A stocked product'} has ${toNumber(stock.base_quantity_on_hand).toLocaleString()} base units on hand and no sales in 30 days.`,
          branchId: stock.branch_id,
          branchName: branchesById.get(stock.branch_id) ?? 'Unknown branch',
          href: `${baseHref}/stock`,
        })
      })

    try {
      const cashDepositsResponse = await supabase
        .from('branch_cash_deposits')
        .select('id, branch_id, amount, expected_cash_amount, variance_amount, status, deposit_date')
        .eq('business_id', businessId)
        .in('branch_id', branchIds)
        .eq('status', 'pending')
        .neq('variance_amount', 0)
        .order('created_at', { ascending: false })
        .range(0, 9)

      if (!cashDepositsResponse.error) {
        ;((cashDepositsResponse.data ?? []) as CashDepositRow[]).forEach((deposit) => {
          alerts.push({
            id: `cash-variance-${deposit.id}`,
            severity: 'high',
            category: 'cash',
            title: 'Cash deposit does not match sales',
            description: `Deposit ${formatMoneyLike(toNumber(deposit.amount))} vs recorded cash ${formatMoneyLike(toNumber(deposit.expected_cash_amount))}. Variance: ${formatMoneyLike(toNumber(deposit.variance_amount))}.`,
            branchId: deposit.branch_id,
            branchName: branchesById.get(deposit.branch_id) ?? 'Unknown branch',
            href: cashHref,
          })
        })
      }
    } catch (error: unknown) {
      logger.warn('Cash deposit alerts unavailable', { businessId, error })
    }

    const severityRank: Record<OperationalAlertSeverity, number> = { high: 3, medium: 2, low: 1 }
    return alerts
      .sort((first, second) => severityRank[second.severity] - severityRank[first.severity])
      .slice(0, limit)
  } catch (error: unknown) {
    logger.error('getOperationalAlerts failed', { userId, businessId, error })
    return []
  }
}
