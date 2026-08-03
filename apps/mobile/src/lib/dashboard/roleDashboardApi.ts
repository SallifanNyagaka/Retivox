/**
 * Role dashboard Supabase summaries for Retivox mobile.
 *
 * Provides lightweight owner/admin metrics while deeper mobile management
 * screens are expanded.
 */

import { supabase } from '../supabase/client'
import { getConnectivityState } from '../network/connectivity'
import { readRoleDashboardSnapshot, writeRoleDashboardSnapshot } from '../offline/roleSnapshot'

export type OwnerDashboardSummary = {
  currency: string
  todayRevenue: number
  todayTransactions: number
  activeBranches: number
  activeProducts: number
  pendingDamageReports: number
}

export type AdminDashboardSummary = {
  currency: string
  todayRevenue: number
  todayTransactions: number
  managedBranches: number
  pendingDamageReports: number
}

type BusinessCurrencyRow = {
  currency: string | null
}

type TransactionTotalRow = {
  total_amount: number | string | null
}

type AdminReportRow = {
  report_id: string
  branch_id?: string
}

type AdminProductRow = {
  branch_id: string
}

type AccessibleBranchRow = {
  branch_id: string
}

/**
 * Converts values into finite numbers.
 *
 * @param value - Numeric value.
 * @returns Number.
 */
function toNumber(value: unknown): number {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : 0
}

/**
 * Formats a money amount.
 *
 * @param amount - Amount.
 * @param currency - Currency.
 * @returns Formatted money.
 */
export function formatDashboardMoney(amount: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)
}

/**
 * Loads currency for a business.
 *
 * @param businessId - Business id.
 * @returns Currency.
 */
async function fetchCurrency(businessId: string): Promise<string> {
  const { data, error } = await supabase.from('businesses').select('currency').eq('id', businessId).single()

  if (error) throw error

  return ((data as BusinessCurrencyRow | null)?.currency ?? 'KES')
}

/**
 * Loads owner dashboard summary.
 *
 * @param businessId - Business id.
 * @returns Owner summary.
 */
export async function fetchOwnerDashboardSummary(businessId: string): Promise<OwnerDashboardSummary> {
  const connectivity = await getConnectivityState().catch(() => ({ isOnline: false, connectionType: null }))
  const cached = await readRoleDashboardSnapshot<OwnerDashboardSummary>('owner', businessId)
  if (!connectivity.isOnline && cached) return cached

  try {
    const summary = await fetchOwnerDashboardSummaryOnline(businessId)
    await writeRoleDashboardSnapshot('owner', businessId, summary)
    return summary
  } catch (error) {
    if (cached) return cached
    throw error
  }
}

async function fetchOwnerDashboardSummaryOnline(businessId: string): Promise<OwnerDashboardSummary> {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const [currency, transactionResponse, branchResponse, productResponse, damageResponse] = await Promise.all([
    fetchCurrency(businessId),
    supabase
      .from('transactions')
      .select('total_amount')
      .eq('business_id', businessId)
      .gte('recorded_at', today.toISOString())
      .neq('status', 'rejected'),
    supabase
      .from('branches')
      .select('id', { count: 'exact', head: true })
      .eq('business_id', businessId)
      .is('deleted_at', null),
    supabase
      .from('products')
      .select('id', { count: 'exact', head: true })
      .eq('business_id', businessId)
      .eq('is_active', true)
      .is('deleted_at', null),
    supabase
      .from('employee_inventory_loss_reports')
      .select('id', { count: 'exact', head: true })
      .eq('business_id', businessId)
      .eq('status', 'pending'),
  ])

  if (transactionResponse.error) throw transactionResponse.error
  if (branchResponse.error) throw branchResponse.error
  if (productResponse.error) throw productResponse.error
  if (damageResponse.error) throw damageResponse.error

  const transactions = ((transactionResponse.data ?? []) as TransactionTotalRow[])

  return {
    currency,
    todayRevenue: transactions.reduce((sum, transaction) => sum + toNumber(transaction.total_amount), 0),
    todayTransactions: transactions.length,
    activeBranches: branchResponse.count ?? 0,
    activeProducts: productResponse.count ?? 0,
    pendingDamageReports: damageResponse.count ?? 0,
  }
}

/**
 * Loads admin dashboard summary for managed branches.
 *
 * @param businessId - Business id.
 * @returns Admin summary.
 */
export async function fetchAdminDashboardSummary(businessId: string): Promise<AdminDashboardSummary> {
  const connectivity = await getConnectivityState().catch(() => ({ isOnline: false, connectionType: null }))
  const cached = await readRoleDashboardSnapshot<AdminDashboardSummary>('admin', businessId)
  if (!connectivity.isOnline && cached) return cached

  try {
    const summary = await fetchAdminDashboardSummaryOnline(businessId)
    await writeRoleDashboardSnapshot('admin', businessId, summary)
    return summary
  } catch (error) {
    if (cached) return cached
    throw error
  }
}

async function fetchAdminDashboardSummaryOnline(businessId: string): Promise<AdminDashboardSummary> {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const [currency, reportsResponse, productsResponse, branchScopeResponse] = await Promise.all([
    fetchCurrency(businessId),
    supabase.rpc('admin_managed_inventory_loss_reports', { p_limit: 100 }),
    supabase.rpc('admin_damage_report_products'),
    supabase.rpc('my_accessible_branch_ids', { p_min_role: 'employee' }),
  ])

  if (reportsResponse.error) throw reportsResponse.error
  if (productsResponse.error) throw productsResponse.error
  if (branchScopeResponse.error) throw branchScopeResponse.error

  const reports = (reportsResponse.data ?? []) as AdminReportRow[]
  const adminProducts = (productsResponse.data ?? []) as AdminProductRow[]
  const branchIds = new Set<string>(((branchScopeResponse.data ?? []) as AccessibleBranchRow[]).map((branch) => branch.branch_id))

  reports.forEach((report) => {
    if (report.branch_id) branchIds.add(report.branch_id)
  })
  adminProducts.forEach((product) => branchIds.add(product.branch_id))

  const transactionResponse = branchIds.size > 0
    ? await supabase
      .from('transactions')
      .select('total_amount')
      .eq('business_id', businessId)
      .in('branch_id', [...branchIds])
      .gte('recorded_at', today.toISOString())
      .neq('status', 'rejected')
    : { data: [], error: null }

  if (transactionResponse.error) throw transactionResponse.error

  const transactions = ((transactionResponse.data ?? []) as TransactionTotalRow[])

  return {
    currency,
    todayRevenue: transactions.reduce((sum, transaction) => sum + toNumber(transaction.total_amount), 0),
    todayTransactions: transactions.length,
    managedBranches: branchIds.size,
    pendingDamageReports: reports.length,
  }
}
