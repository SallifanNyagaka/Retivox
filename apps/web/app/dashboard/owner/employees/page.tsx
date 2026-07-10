/**
 * Owner employees dashboard page.
 *
 * Loads employees, branch assignments, transaction counts, transfer history,
 * and business currency before rendering the interactive employee dashboard.
 */

import { GlobalRole } from '@smartretail/shared'
import { requireRole } from '../../../../lib/auth/helpers'
import { createClient } from '../../../../lib/supabase/server'
import logger from '../../../../lib/logger'
import { runSoftDeleteAwareQuery } from '../../../../lib/supabase/softDelete'
import { Card } from '../../../../components/ui/Card'
import EmployeesPageClient from './EmployeesPageClient'
import type {
  BranchRow,
  BusinessUserRow,
  EmployeeRow,
  EmployeeTransferRow,
  EmployeeUserRow,
  TransferHistoryRow,
  UserBranchRoleRow,
} from './types'

type EmployeeTransactionCountRow = {
  employeeId: string
  count: number
}

/**
 * Standard empty result used when the data fetch fails.
 */
const EMPTY_EMPLOYEE_METRICS = {
  totalEmployees: 0,
  activeEmployees: 0,
  inactiveEmployees: 0,
  averageTransactions: 0,
}

/**
 * Owner employees page server component.
 */
export default async function EmployeesPage() {
  const profile = await requireRole([GlobalRole.Owner])
  const businessId = profile.business_id

  if (!businessId) {
    throw new Error('Owner profile missing business ID')
  }

  let currency = 'Currency unavailable'
  let employees: EmployeeRow[] = []
  let branches: BranchRow[] = []
  let transferHistory: TransferHistoryRow[] = []
  let metrics = EMPTY_EMPLOYEE_METRICS
  let pageError: string | null = null

  try {
    const supabase = await createClient()

    const [
      rolesResponse,
      transactionCountsResponse,
      transfersResponse,
      businessResponse,
    ] = await Promise.all([
      supabase
        .from('user_branch_roles')
        .select('id, user_id, branch_id, role, assigned_at')
        .eq('business_id', businessId)
        .eq('role', 'employee'),
      supabase.rpc('owner_employee_transaction_counts'),
      supabase
        .from('employee_transfers')
        .select('id, user_id, from_branch_id, to_branch_id, approved_by, status, requested_at, approved_at')
        .eq('business_id', businessId)
        .order('requested_at', { ascending: false }),
      supabase.from('businesses').select('currency').eq('id', businessId).single(),
    ])

    const [usersResponse, branchesResponse] = await Promise.all([
      runSoftDeleteAwareQuery<BusinessUserRow>(
        () =>
          supabase
            .from('users')
            .select('id, name, email, phone, global_role, is_active, created_at')
            .eq('business_id', businessId)
            .is('deleted_at', null)
            .order('created_at', { ascending: true }),
        () =>
          supabase
            .from('users')
            .select('id, name, email, phone, global_role, is_active, created_at')
            .eq('business_id', businessId)
            .order('created_at', { ascending: true }),
        { table: 'users', businessId, page: 'owner_employees' }
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
        { table: 'branches', businessId, page: 'owner_employees' }
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

    if (transactionCountsResponse.error) {
      throw transactionCountsResponse.error
    }

    if (transfersResponse.error) {
      logger.warn('EmployeesPage transfer history query failed', { businessId, error: transfersResponse.error })
    }

    if (businessResponse.error) {
      throw businessResponse.error
    }

    const users = (usersResponse.data ?? []) as BusinessUserRow[]
    branches = (branchesResponse.data ?? []) as BranchRow[]
    const roles = (rolesResponse.data ?? []) as UserBranchRoleRow[]
    const transactionCountRows = (transactionCountsResponse.data ?? []) as EmployeeTransactionCountRow[]
    const transfers = (transfersResponse.error ? [] : transfersResponse.data ?? []) as EmployeeTransferRow[]
    currency = businessResponse.data?.currency ?? currency

    const branchMap: Record<string, string> = {}
    branches.forEach((branch) => {
      branchMap[branch.id] = branch.name
    })

    const userMap: Record<string, BusinessUserRow> = {}
    users.forEach((user) => {
      userMap[user.id] = user
    })

    const transactionCounts: Record<string, number> = {}
    transactionCountRows.forEach((transaction) => {
      transactionCounts[transaction.employeeId] = transaction.count
    })

    employees = users
      .filter((user): user is EmployeeUserRow => user.global_role === 'employee')
      .map((employee) => {
        const assignedRole = roles.find((role) => role.user_id === employee.id) ?? null

        return {
          ...employee,
          assignedBranchId: assignedRole?.branch_id ?? null,
          assignedBranchName: assignedRole?.branch_id ? branchMap[assignedRole.branch_id] ?? null : null,
          transactionCount: transactionCounts[employee.id] ?? 0,
        }
      })

    transferHistory = transfers.map((transfer) => ({
      ...transfer,
      user_name: userMap[transfer.user_id]?.name ?? 'Unknown employee',
      approved_by_name: transfer.approved_by ? userMap[transfer.approved_by]?.name ?? null : null,
      from_branch_name: branchMap[transfer.from_branch_id] ?? 'Unknown branch',
      to_branch_name: branchMap[transfer.to_branch_id] ?? 'Unknown branch',
    }))

    const totalTransactions = employees.reduce((sum, employee) => sum + employee.transactionCount, 0)
    metrics = {
      totalEmployees: employees.length,
      activeEmployees: employees.filter((employee) => employee.is_active).length,
      inactiveEmployees: employees.filter((employee) => !employee.is_active).length,
      averageTransactions: employees.length > 0 ? Math.round(totalTransactions / employees.length) : 0,
    }
  } catch (error: unknown) {
    logger.error('EmployeesPage data fetch failed', { businessId, error })
    pageError = error instanceof Error ? error.message : 'Unable to load employees'
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
            Employees
          </h1>
          <p style={{ fontSize: '14px', color: 'var(--color-text-muted)', marginTop: '4px' }}>
            Manage employee access, branch assignments, activity, and transfers.
          </p>
        </div>

        <Card>
          <p style={{ fontSize: '14px', color: 'var(--color-danger)', margin: 0 }}>
            Failed to load the employees page. Please refresh and try again.
          </p>
        </Card>
      </div>
    )
  }

  return (
    <EmployeesPageClient
      currency={currency}
      employees={employees}
      branches={branches}
      transferHistory={transferHistory}
      metrics={metrics}
    />
  )
}
