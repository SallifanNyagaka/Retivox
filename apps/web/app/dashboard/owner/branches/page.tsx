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
import { Badge } from '../../../../components/ui/Badge'
import SpreadsheetTools from '../../../../components/dashboard/SpreadsheetTools'
import AddBranchForm from './AddBranchForm'
import BranchCardActions from './BranchCardActions'
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

/**
 * Returns the badge variant for a branch type.
 */
function getBranchTypeVariant(branchType: string) {
  return branchType === 'warehouse' ? 'info' : 'success'
}

/**
 * Formats an ISO date as a readable label.
 */
function formatDateLabel(isoDate: string) {
  return new Date(isoDate).toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

/**
 * Icon used for transaction totals.
 */
function TransactionIcon() {
  return (
    <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path d="M3 12h18" />
      <path d="M3 6h18" />
      <path d="M3 18h18" />
    </svg>
  )
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
  const transactionResponse = await supabase
    .rpc('owner_branch_transaction_counts')

  // Fetch admin assignments per branch (joined user active flag)
  const adminRolesResponse = await supabase
    .from('user_branch_roles')
    .select('branch_id, users!user_branch_roles_user_id_fkey(is_active)')
    .eq('business_id', businessId)
    .eq('role', 'admin')

  if (branchesResponse.error) {
    throw branchesResponse.error
  }

  if (transactionResponse.error) {
    throw transactionResponse.error
  }

  if (adminRolesResponse.error) {
    throw adminRolesResponse.error
  }

  const branches = (branchesResponse.data ?? []) as Branch[]
  const transactionCounts = (transactionResponse.data ?? []) as BranchTransactionCountRow[]
  const adminRoles = (adminRolesResponse.data ?? []) as { branch_id: string; users?: { is_active: boolean }[] }[]
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
  adminRoles.forEach((r) => {
    const branchId = r.branch_id
    const active = r.users?.[0]?.is_active ?? true
    if (!adminCountMap[branchId]) adminCountMap[branchId] = 0
    if (active) adminCountMap[branchId] += 1
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
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {branchesWithStats.map((branch) => (
            <Card
              key={branch.id}
              hoverable
              className="flex flex-col justify-between"
              style={{
                borderLeft: `3px solid ${branch.is_active ? 'var(--color-success)' : 'var(--color-text-muted)'}`,
                padding: '20px',
              }}
            >
              <div className="flex flex-col gap-3">
                <div>
                  <p style={{ fontSize: '16px', fontWeight: 600, color: 'var(--color-text-primary)', margin: 0 }}>
                    {branch.name}
                  </p>
                  <p style={{ fontSize: '13px', color: 'var(--color-text-muted)', marginTop: '6px' }}>
                    {branch.location}
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Badge variant={getBranchTypeVariant(branch.branch_type)}>{branch.branch_type}</Badge>
                  <Badge variant={branch.is_active ? 'success' : 'muted'}>
                    {branch.is_active ? 'Active' : 'Inactive'}
                  </Badge>
                </div>

                <div className="flex items-center gap-2" style={{ color: 'var(--color-text-primary)' }}>
                  <TransactionIcon />
                  <span style={{ fontSize: '13px', fontWeight: 500 }}>
                    {branch.transactionCount} transactions
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between" style={{ marginTop: 18 }}>
                <p style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>Created {formatDateLabel(branch.created_at)}</p>
                <div className="flex items-center gap-2">
                  <span style={{ fontSize: 13, color: 'var(--color-text-primary)' }}>{adminCountMap[branch.id] ?? 0} admins</span>
                  <BranchCardActions branchId={branch.id} branchName={branch.name} isActive={branch.is_active} />
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
