/**
 * Branches management page for Retivox owner dashboard.
 *
 * This server-only page fetches branch data from Supabase,
 * calculates transaction counts per branch, and renders
 * a responsive branch management UI with metrics and cards.
 */

import { requireRole } from '../../../../lib/auth/helpers'
import { GlobalRole } from '@smartretail/shared'
import { createClient } from '../../../../lib/supabase/server'
import { runSoftDeleteAwareQuery } from '../../../../lib/supabase/softDelete'
import { Card } from '../../../../components/ui/Card'
import SpreadsheetTools from '../../../../components/dashboard/SpreadsheetTools'
import AddBranchForm from './AddBranchForm'
import OwnerBranchCards, { type BranchInsight } from './OwnerBranchCards'
import { importBranches } from './actions'

// ── Types for branch data and statistics ──

type Branch = {
  id: string
  name: string
  location: string
  branch_type: string
  is_active: boolean
  created_at: string
}

type BranchWithStats = Branch & {
  transactionCount: number
}

type BranchTransactionCountRow = {
  branchId: string
  count: number
}

type BranchRoleSummaryRow = {
  branch_id: string
  role: 'owner' | 'admin' | 'employee'
  is_active: boolean
  users?: {
    id: string
    name: string
    email: string | null
    phone: string | null
    global_role: 'owner' | 'admin' | 'employee'
    is_active: boolean
    deleted_at: string | null
  } | {
    id: string
    name: string
    email: string | null
    phone: string | null
    global_role: 'owner' | 'admin' | 'employee'
    is_active: boolean
    deleted_at: string | null
  }[]
}

type BranchStockSummaryRow = {
  branch_id: string
  base_quantity_on_hand: number | string | null
  base_quantity_reserved: number | string | null
}

type BranchTodayTransactionRow = {
  id: string
  branch_id: string | null
  employee_id: string | null
  total_amount: number | string
  status: string
}

type BranchTransactionItemProfitRow = {
  transaction_id: string
  gross_profit: number | string | null
}

type BranchLossReportSummaryRow = {
  branch_id: string
  status: string
}

function normalizeJoinedUser(row: BranchRoleSummaryRow) {
  if (!row.users) {
    return null
  }

  return Array.isArray(row.users) ? row.users[0] ?? null : row.users
}

/**
 * Icon used for the empty branch state.
 */
function StoreIcon() {
  return (
    <svg width="36" height="36" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path d="M4 9L12 3l8 6v11a1 1 0 01-1 1H5a1 1 0 01-1-1V9z" />
      <path d="M9 22V12h6v10" />
    </svg>
  )
}

/**
 * Owner branches page component.
 */
export default async function BranchesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; type?: string }>
}) {
  const params = await searchParams
  const search = (params.q ?? '').trim()
  const statusFilter = params.status === 'active' || params.status === 'inactive' ? params.status : 'all'
  const typeFilter = params.type === 'store' || params.type === 'warehouse' ? params.type : 'all'

  // Enforce owner access and load business context.
  const profile = await requireRole([GlobalRole.Owner])
  const businessId = profile.business_id

  if (!businessId) {
    throw new Error('Owner profile missing business ID')
  }

  // Create Supabase client for server-side data loading.
  const supabase = await createClient()

  // Fetch branch records for the business.
  const branchesResponse = await runSoftDeleteAwareQuery<Branch>(
    () =>
      supabase
        .from('branches')
        .select('id, name, location, branch_type, is_active, created_at')
        .eq('business_id', businessId)
        .is('deleted_at', null)
        .order('created_at', { ascending: true }),
    () =>
      supabase
        .from('branches')
        .select('id, name, location, branch_type, is_active, created_at')
        .eq('business_id', businessId)
        .order('created_at', { ascending: true }),
    { table: 'branches', businessId, page: 'owner_branches' }
  )

  // Fetch transaction counts grouped by branch through a compact RPC.
  const transactionResponse = await supabase.rpc('owner_branch_transaction_counts')

  if (branchesResponse.error) {
    throw branchesResponse.error
  }

  if (transactionResponse.error) {
    throw transactionResponse.error
  }

  const branches = (branchesResponse.data ?? []) as Branch[]
  const branchIds = branches.map((branch) => branch.id)
  const transactionCounts = (transactionResponse.data ?? []) as BranchTransactionCountRow[]

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const todayStart = today.toISOString()

  const [businessResponse, rolesResponse, stockResponse, todayTransactionsResponse, lossReportsResponse] = await Promise.all([
    supabase.from('businesses').select('currency').eq('id', businessId).single(),
    branchIds.length > 0
      ? supabase
          .from('user_branch_roles')
          .select('branch_id, role, is_active, users!user_branch_roles_user_id_fkey(id, name, email, phone, global_role, is_active, deleted_at)')
          .eq('business_id', businessId)
          .in('branch_id', branchIds)
          .in('role', ['admin', 'employee'])
      : Promise.resolve({ data: [], error: null }),
    branchIds.length > 0
      ? supabase
          .from('branch_stock')
          .select('branch_id, base_quantity_on_hand, base_quantity_reserved')
          .eq('business_id', businessId)
          .in('branch_id', branchIds)
      : Promise.resolve({ data: [], error: null }),
    branchIds.length > 0
      ? supabase
          .from('transactions')
          .select('id, branch_id, employee_id, total_amount, status')
          .eq('business_id', businessId)
          .in('branch_id', branchIds)
          .gte('recorded_at', todayStart)
      : Promise.resolve({ data: [], error: null }),
    branchIds.length > 0
      ? supabase
          .from('employee_inventory_loss_reports')
          .select('branch_id, status')
          .eq('business_id', businessId)
          .in('branch_id', branchIds)
      : Promise.resolve({ data: [], error: null }),
  ])

  if (businessResponse.error) {
    throw businessResponse.error
  }

  if (rolesResponse.error) {
    throw rolesResponse.error
  }

  if (stockResponse.error) {
    throw stockResponse.error
  }

  if (todayTransactionsResponse.error) {
    throw todayTransactionsResponse.error
  }

  if (lossReportsResponse.error) {
    throw lossReportsResponse.error
  }

  const currency = businessResponse.data?.currency ?? 'USD'
  const roleRows = (rolesResponse.data ?? []) as BranchRoleSummaryRow[]
  const stockRows = (stockResponse.data ?? []) as BranchStockSummaryRow[]
  const todayTransactions = (todayTransactionsResponse.data ?? []) as BranchTodayTransactionRow[]
  const lossRows = (lossReportsResponse.data ?? []) as BranchLossReportSummaryRow[]
  const todayTransactionIds = todayTransactions.map((transaction) => transaction.id)
  const transactionItemsResponse =
    todayTransactionIds.length > 0
      ? await supabase
          .from('transaction_items')
          .select('transaction_id, gross_profit')
          .eq('business_id', businessId)
          .in('transaction_id', todayTransactionIds)
      : { data: [], error: null }

  if (transactionItemsResponse.error) {
    throw transactionItemsResponse.error
  }

  const transactionItemRows = (transactionItemsResponse.data ?? []) as BranchTransactionItemProfitRow[]
  const transactionCountMap: Record<string, number> = {}
  transactionCounts.forEach((transaction) => {
    transactionCountMap[transaction.branchId] = transaction.count
  })

  const branchesWithStats: BranchWithStats[] = branches
    .map((branch) => ({
      ...branch,
      transactionCount: transactionCountMap[branch.id] ?? 0,
    }))
    .filter((branch) => {
      const normalized = search.toLowerCase()
      const matchesSearch = normalized
        ? `${branch.name} ${branch.location} ${branch.branch_type}`.toLowerCase().includes(normalized)
        : true
      const matchesStatus =
        statusFilter === 'all' ? true : statusFilter === 'active' ? branch.is_active : !branch.is_active
      const matchesType = typeFilter === 'all' ? true : branch.branch_type === typeFilter

      return matchesSearch && matchesStatus && matchesType
    })

  // Compute summary metrics for the page.
  const totalBranches = branchesWithStats.length
  const activeStores = branchesWithStats.filter((branch) => branch.branch_type === 'store' && branch.is_active).length
  const warehouseCount = branchesWithStats.filter((branch) => branch.branch_type === 'warehouse').length

  // Compute admin counts per branch and total admins across the business
  const adminCountMap: Record<string, number> = {}
  roleRows.forEach((role) => {
    const branchId = role.branch_id
    const user = normalizeJoinedUser(role)
    const active = role.is_active !== false && user?.is_active === true && user.deleted_at === null

    if (role.role === 'admin' && active) {
      if (!adminCountMap[branchId]) adminCountMap[branchId] = 0
      adminCountMap[branchId] += 1
    }
  })

  const usersById = new Map<string, NonNullable<ReturnType<typeof normalizeJoinedUser>>>()
  const branchInsights: Record<string, BranchInsight> = {}

  branches.forEach((branch) => {
    branchInsights[branch.id] = {
      branchId: branch.id,
      admins: [],
      employees: [],
      stockItems: 0,
      stockBaseQuantity: 0,
      todaySales: 0,
      todayVerifiedSales: 0,
      todayProfit: 0,
      pendingDamageReports: 0,
      approvedLossReports: 0,
      bestEmployeeName: null,
      bestEmployeeSales: 0,
      bestAdminName: null,
      bestAdminSales: 0,
    }
  })

  roleRows.forEach((role) => {
    const user = normalizeJoinedUser(role)
    const insight = branchInsights[role.branch_id]

    if (!user || !insight || role.is_active === false || !user.is_active || user.deleted_at !== null) {
      return
    }

    usersById.set(user.id, user)

    const person = {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
    }

    if (role.role === 'admin') {
      insight.admins.push(person)
    }

    if (role.role === 'employee') {
      insight.employees.push(person)
    }
  })

  stockRows.forEach((stock) => {
    const insight = branchInsights[stock.branch_id]

    if (!insight) {
      return
    }

    const onHand = Number(stock.base_quantity_on_hand ?? 0)
    const reserved = Number(stock.base_quantity_reserved ?? 0)
    const available = Math.max(onHand - reserved, 0)

    if (available > 0) {
      insight.stockItems += 1
    }

    insight.stockBaseQuantity += available
  })

  const profitByTransaction = new Map<string, number>()
  transactionItemRows.forEach((item) => {
    profitByTransaction.set(item.transaction_id, (profitByTransaction.get(item.transaction_id) ?? 0) + Number(item.gross_profit ?? 0))
  })

  const salesByUserBranch = new Map<string, number>()
  todayTransactions.forEach((transaction) => {
    if (!transaction.branch_id) {
      return
    }

    const insight = branchInsights[transaction.branch_id]

    if (!insight) {
      return
    }

    const amount = Number(transaction.total_amount ?? 0)
    insight.todaySales += amount
    insight.todayProfit += profitByTransaction.get(transaction.id) ?? 0

    if (transaction.status === 'verified') {
      insight.todayVerifiedSales += amount
    }

    if (transaction.employee_id) {
      const key = `${transaction.branch_id}:${transaction.employee_id}`
      salesByUserBranch.set(key, (salesByUserBranch.get(key) ?? 0) + amount)
    }
  })

  salesByUserBranch.forEach((amount, key) => {
    const [branchId, userId] = key.split(':')
    const insight = branchInsights[branchId]
    const user = usersById.get(userId)

    if (!insight || !user) {
      return
    }

    if (user.global_role === 'employee' && amount > insight.bestEmployeeSales) {
      insight.bestEmployeeName = user.name
      insight.bestEmployeeSales = amount
    }

    if (user.global_role === 'admin' && amount > insight.bestAdminSales) {
      insight.bestAdminName = user.name
      insight.bestAdminSales = amount
    }
  })

  lossRows.forEach((loss) => {
    const insight = branchInsights[loss.branch_id]

    if (!insight) {
      return
    }

    if (loss.status === 'pending') {
      insight.pendingDamageReports += 1
    }

    if (loss.status === 'approved') {
      insight.approvedLossReports += 1
    }
  })

  const totalAdmins = Object.values(adminCountMap).reduce((s, v) => s + v, 0)
  const exportParams = new URLSearchParams()
  if (search) exportParams.set('q', search)
  if (statusFilter !== 'all') exportParams.set('status', statusFilter)
  if (typeFilter !== 'all') exportParams.set('type', typeFilter)
  const exportHref = `/dashboard/owner/branches/export${exportParams.toString() ? `?${exportParams.toString()}` : ''}`

  return (
    <div className="flex flex-col gap-6">
      {/* Page header with title, subtitle and action button */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1
            className="font-bold"
            style={{
              fontSize: '22px',
              color: 'var(--color-text-primary)',
              letterSpacing: '-0.3px',
            }}
          >
            Branches
          </h1>
          <p style={{ fontSize: '14px', color: 'var(--color-text-muted)', marginTop: '4px' }}>
            Manage your stores and warehouse
          </p>
        </div>

        {/* Branch actions: spreadsheet tools and add form */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <SpreadsheetTools
            entityLabel="Branches"
            exportHref={exportHref}
            templateHref="/dashboard/owner/branches/template"
            importAction={importBranches}
          />
          <AddBranchForm />
        </div>
      </div>

      <Card padding="md">
        <form className="grid grid-cols-1 gap-3 lg:grid-cols-4">
          <label className="flex flex-col gap-2" style={{ fontSize: 13, color: 'var(--color-text-primary)' }}>
            Search
            <input
              name="q"
              defaultValue={search}
              placeholder="Name, location, or type"
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
          <label className="flex flex-col gap-2" style={{ fontSize: 13, color: 'var(--color-text-primary)' }}>
            Status
            <select
              name="status"
              defaultValue={statusFilter}
              style={{
                height: 44,
                borderRadius: 8,
                border: '1px solid var(--color-border)',
                padding: '0 14px',
                backgroundColor: 'var(--color-background)',
                color: 'var(--color-text-primary)',
              }}
            >
              <option value="all">All statuses</option>
              <option value="active">Active only</option>
              <option value="inactive">Inactive only</option>
            </select>
          </label>
          <label className="flex flex-col gap-2" style={{ fontSize: 13, color: 'var(--color-text-primary)' }}>
            Type
            <select
              name="type"
              defaultValue={typeFilter}
              style={{
                height: 44,
                borderRadius: 8,
                border: '1px solid var(--color-border)',
                padding: '0 14px',
                backgroundColor: 'var(--color-background)',
                color: 'var(--color-text-primary)',
              }}
            >
              <option value="all">All types</option>
              <option value="store">Stores</option>
              <option value="warehouse">Warehouses</option>
            </select>
          </label>
          <div className="flex items-end gap-2">
            <button type="submit" className="btn-primary" style={{ padding: '8px 16px', borderRadius: 8 }}>
              Apply filters
            </button>
            <a href="/dashboard/owner/branches" className="btn-outline" style={{ padding: '8px 16px', borderRadius: 8 }}>
              Clear
            </a>
          </div>
        </form>
      </Card>

      {/* Summary metrics row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { label: 'Total branches', value: String(totalBranches) },
          { label: 'Active stores', value: String(activeStores) },
          { label: 'Warehouses', value: String(warehouseCount) },
        ].map((metric) => (
          <Card key={metric.label} padding="lg">
            <p style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginBottom: '9px' }}>
              {metric.label}
            </p>
            <p style={{ fontSize: '24px', fontWeight: 600, color: 'var(--color-text-primary)' }}>
              {metric.value}
            </p>
          </Card>
        ))}
        <Card padding="lg">
          <p style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginBottom: '9px' }}>Total admins</p>
          <p style={{ fontSize: '24px', fontWeight: 600, color: 'var(--color-text-primary)' }}>{String(totalAdmins)}</p>
        </Card>
      </div>

      {/* Branch cards grid or empty state */}
      {branchesWithStats.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-5 rounded-xl border border-dashed" style={{ borderColor: 'var(--color-border)', padding: '48px', backgroundColor: 'var(--color-background)' }}>
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
            <StoreIcon />
          </div>
          <div className="text-center">
            <h2 style={{ fontSize: '20px', fontWeight: 600, color: 'var(--color-text-primary)', margin: 0 }}>
              No branches yet
            </h2>
            <p style={{ fontSize: '14px', color: 'var(--color-text-muted)', marginTop: '8px' }}>
              Add your first branch to start tracking sales
            </p>
          </div>
          {/* Empty state CTA — large button with primary hover state */}
          <AddBranchForm />
        </div>
      ) : (
        <OwnerBranchCards
          branches={branchesWithStats}
          adminCountMap={adminCountMap}
          insights={branchInsights}
          currency={currency}
        />
      )}
    </div>
  )
}
