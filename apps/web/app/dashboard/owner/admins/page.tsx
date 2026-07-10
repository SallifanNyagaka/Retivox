/**
 * Owner admins dashboard page.
 *
 * This page loads the business admin directory, branch assignment data, and
 * transfer history, then passes the hydrated data to the client dashboard.
 */

import { requireRole } from '../../../../lib/auth/helpers'
import { GlobalRole } from '@smartretail/shared'
import { createClient } from '../../../../lib/supabase/server'
import logger from '../../../../lib/logger'
import { runSoftDeleteAwareQuery } from '../../../../lib/supabase/softDelete'
import { Card } from '../../../../components/ui/Card'
import AdminsPageClient from './AdminsPageClient'
import type {
  AdminRow,
  AdminUserRow,
  BranchRow,
  EmployeeTransferRow,
  TransferHistoryRow,
  UserBranchRoleRow,
} from './types'

/**
 * Owner admins page server component.
 */
export default async function AdminsPage() {
  const profile = await requireRole([GlobalRole.Owner])
  const businessId = profile.business_id

  if (!businessId) {
    throw new Error('Owner profile missing business ID')
  }

  let currency = ''
  let ownerAccount: AdminRow | null = null
  let adminRows: AdminRow[] = []
  let branches: BranchRow[] = []
  let availableBranches: BranchRow[] = []
  let transferHistory: TransferHistoryRow[] = []
  let metrics = {
    totalAdmins: 0,
    branchesCovered: 0,
    unassignedBranches: 0,
  }
  let pageError: string | null = null

  try {
    const supabase = await createClient()

    const [rolesResponse, transfersResponse, businessResponse] =
      await Promise.all([
        supabase
          .from('user_branch_roles')
          .select('id, user_id, branch_id, role, assigned_at')
          .eq('business_id', businessId),
        supabase
          .from('employee_transfers')
          .select('id, user_id, from_branch_id, to_branch_id, approved_by, status, requested_at, approved_at')
          .eq('business_id', businessId)
          .order('requested_at', { ascending: false }),
        supabase.from('businesses').select('currency').eq('id', businessId).single(),
      ])

    const [usersResponse, branchesResponse] = await Promise.all([
      runSoftDeleteAwareQuery<AdminUserRow>(
        () =>
          supabase
            .from('users')
            .select('id, name, email, phone, global_role, is_active, created_at')
            .eq('business_id', businessId)
            .in('global_role', ['admin', 'owner'])
            .is('deleted_at', null)
            .order('created_at', { ascending: true }),
        () =>
          supabase
            .from('users')
            .select('id, name, email, phone, global_role, is_active, created_at')
            .eq('business_id', businessId)
            .in('global_role', ['admin', 'owner'])
            .order('created_at', { ascending: true }),
        { table: 'users', businessId, page: 'owner_admins' }
      ),
      runSoftDeleteAwareQuery<BranchRow>(
        () =>
          supabase
            .from('branches')
            .select('id, name, is_active')
            .eq('business_id', businessId)
            .is('deleted_at', null)
            .order('name'),
        () => supabase.from('branches').select('id, name, is_active').eq('business_id', businessId).order('name'),
        { table: 'branches', businessId, page: 'owner_admins' }
      ),
    ])

    if (usersResponse.error) {
      throw usersResponse.error
    }

    if (branchesResponse.error) {
      throw branchesResponse.error
    }

    if (rolesResponse.error) {
      throw rolesResponse.error
    }

    if (transfersResponse.error) {
      logger.warn('AdminsPage transfer history query failed', { businessId, error: transfersResponse.error })
    }

    if (businessResponse.error) {
      throw businessResponse.error
    }

    const users = (usersResponse.data ?? []) as AdminUserRow[]
    branches = (branchesResponse.data ?? []) as BranchRow[]
    const roles = (rolesResponse.data ?? []) as UserBranchRoleRow[]
    const transfers = (transfersResponse.error ? [] : transfersResponse.data ?? []) as EmployeeTransferRow[]
    currency = businessResponse.data?.currency ?? ''

    if (!currency) {
      throw new Error('Business currency missing')
    }

    const branchMap: Record<string, string> = {}
    branches.forEach((branch) => {
      branchMap[branch.id] = branch.name
    })

    const userMap: Record<string, AdminUserRow> = {}
    users.forEach((user) => {
      userMap[user.id] = user
    })

    const adminAssignedBranchIds = new Set(
      roles
        .filter((role) => userMap[role.user_id]?.global_role === 'admin')
        .map((role) => role.branch_id)
    )

    availableBranches = branches.filter((branch) => !adminAssignedBranchIds.has(branch.id))
    adminRows = users
      .filter((user) => user.global_role === 'admin')
      .map((user) => {
        const assignedBranchIds = roles
          .filter((role) => role.user_id === user.id)
          .map((role) => role.branch_id)

        return {
          ...user,
          assignedBranchIds,
          assignedBranchNames: assignedBranchIds.map((branchId) => branchMap[branchId]).filter(Boolean),
        }
      })

    const ownerUser = users.find((user) => user.global_role === 'owner') ?? null
    ownerAccount = ownerUser
      ? {
          ...ownerUser,
          assignedBranchIds: roles.filter((role) => role.user_id === ownerUser.id).map((role) => role.branch_id),
          assignedBranchNames: roles
            .filter((role) => role.user_id === ownerUser.id)
            .map((role) => branchMap[role.branch_id])
            .filter(Boolean),
        }
      : null

    transferHistory = transfers.map((transfer) => ({
      ...transfer,
      user_name: userMap[transfer.user_id]?.name ?? 'Unknown user',
      approved_by_name: transfer.approved_by ? userMap[transfer.approved_by]?.name ?? null : null,
      from_branch_name: branchMap[transfer.from_branch_id] ?? 'Unknown branch',
      to_branch_name: branchMap[transfer.to_branch_id] ?? 'Unknown branch',
    }))

    metrics = {
      totalAdmins: adminRows.length,
      branchesCovered: adminAssignedBranchIds.size,
      unassignedBranches: branches.length - adminAssignedBranchIds.size,
    }
  } catch (error: unknown) {
    logger.error('AdminsPage data fetch failed', { businessId, error })
    pageError = error instanceof Error ? error.message : 'Unable to load admins'
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
            Admins
          </h1>
          <p style={{ fontSize: '14px', color: 'var(--color-text-muted)', marginTop: '4px' }}>
            Manage branch administrators and access control from one place.
          </p>
        </div>

        <Card>
          <p style={{ fontSize: '14px', color: 'var(--color-danger)', margin: 0 }}>
            Failed to load the admins page. Please refresh and try again.
          </p>
        </Card>
      </div>
    )
  }

  return (
    <AdminsPageClient
      currency={currency}
      ownerAccount={ownerAccount}
      admins={adminRows}
      branches={branches}
      availableBranches={availableBranches}
      transferHistory={transferHistory}
      metrics={metrics}
    />
  )
}
