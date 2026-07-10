/**
 * Admin employees page.
 *
 * Loads employees assigned to branches where the current admin has admin-level
 * access, then renders branch-scoped employee creation and access controls.
 */

import { GlobalRole } from '@smartretail/shared'
import { Card } from '../../../../components/ui/Card'
import { getAccessibleBranchIds } from '../../../../lib/auth/branchAccess'
import { requireRole } from '../../../../lib/auth/helpers'
import logger from '../../../../lib/logger'
import { createClient } from '../../../../lib/supabase/server'
import AdminEmployeesPageClient, {
  type AdminEmployeeRow,
  type AdminEmployeesMetrics,
} from './AdminEmployeesPageClient'
import type { AdminEmployeeBranchOption } from './AddAdminEmployeeForm'

/**
 * Branch row returned for admin-managed branch options.
 */
type BranchRow = {
  id: string
  name: string
  is_active: boolean
}

/**
 * Employee user row returned from the branch-role join.
 */
type JoinedEmployeeUserRow = {
  id: string
  name: string
  email: string
  phone: string | null
  global_role: 'owner' | 'admin' | 'employee'
  is_active: boolean
  deleted_at: string | null
}

/**
 * Branch row returned from the branch-role join.
 */
type JoinedBranchRow = {
  id: string
  name: string
}

/**
 * User branch role row used by the admin employee directory.
 */
type EmployeeRoleRow = {
  id: string
  user_id: string
  branch_id: string
  role: 'owner' | 'admin' | 'employee'
  assigned_at: string
  is_active: boolean
  branches: JoinedBranchRow | JoinedBranchRow[] | null
  users: JoinedEmployeeUserRow | JoinedEmployeeUserRow[] | null
}

/**
 * Transaction row used to count employee activity in managed branches.
 */
type TransactionEmployeeRow = {
  employee_id: string | null
}

/**
 * Empty metrics used when the page cannot load.
 */
const EMPTY_METRICS: AdminEmployeesMetrics = {
  totalEmployees: 0,
  activeAccess: 0,
  inactiveAccess: 0,
  averageTransactions: 0,
}

/**
 * Supabase joined rows may arrive as an object or an array depending on relation metadata.
 */
function normalizeJoinedOne<T>(value: T | T[] | null | undefined): T | null {
  if (!value) {
    return null
  }

  return Array.isArray(value) ? value[0] ?? null : value
}

/**
 * Builds summary metrics from hydrated employee rows.
 */
function buildEmployeeMetrics(employees: AdminEmployeeRow[]): AdminEmployeesMetrics {
  const totalTransactions = employees.reduce((sum, employee) => sum + employee.transactionCount, 0)
  const activeAccess = employees.filter((employee) => employee.accountIsActive && employee.accessIsActive).length

  return {
    totalEmployees: employees.length,
    activeAccess,
    inactiveAccess: employees.length - activeAccess,
    averageTransactions: employees.length > 0 ? Math.round(totalTransactions / employees.length) : 0,
  }
}

/**
 * Admin employees page server component.
 */
export default async function AdminEmployeesPage() {
  const profile = await requireRole([GlobalRole.Admin])
  const businessId = profile.business_id

  if (!businessId) {
    throw new Error('Admin profile missing business ID')
  }

  let branches: AdminEmployeeBranchOption[] = []
  let employees: AdminEmployeeRow[] = []
  let metrics = EMPTY_METRICS
  let pageError: string | null = null

  try {
    const supabase = await createClient()
    const branchIds = await getAccessibleBranchIds(profile.id, 'admin')

    const branchResponse =
      branchIds.length > 0
        ? await supabase
            .from('branches')
            .select('id, name, is_active')
            .eq('business_id', businessId)
            .is('deleted_at', null)
            .eq('is_active', true)
            .in('id', branchIds)
            .order('name', { ascending: true })
        : { data: [], error: null }

    if (branchResponse.error) {
      throw branchResponse.error
    }

    branches = ((branchResponse.data ?? []) as BranchRow[]).map((branch) => ({
      id: branch.id,
      name: branch.name,
      is_active: branch.is_active,
    }))

    const managedBranchIds = branches.map((branch) => branch.id)
    const employeeResponse =
      managedBranchIds.length > 0
        ? await supabase
            .from('user_branch_roles')
            .select(
              'id, user_id, branch_id, role, assigned_at, is_active, branches!inner(id, name), users!user_branch_roles_user_id_fkey(id, name, email, phone, global_role, is_active, deleted_at)'
            )
            .eq('business_id', businessId)
            .eq('role', 'employee')
            .in('branch_id', managedBranchIds)
            .order('assigned_at', { ascending: false })
            .range(0, 49)
        : { data: [], error: null }

    if (employeeResponse.error) {
      throw employeeResponse.error
    }

    const roleRows = (employeeResponse.data ?? []) as EmployeeRoleRow[]
    const visibleRoleRows = roleRows.filter((row) => {
      const employee = normalizeJoinedOne(row.users)
      return row.role === 'employee' && employee?.global_role === 'employee' && employee.deleted_at === null
    })
    const visibleEmployeeIds = Array.from(new Set(visibleRoleRows.map((row) => row.user_id)))

    const transactionResponse =
      visibleEmployeeIds.length > 0 && managedBranchIds.length > 0
        ? await supabase
            .from('transactions')
            .select('employee_id')
            .eq('business_id', businessId)
            .in('branch_id', managedBranchIds)
            .in('employee_id', visibleEmployeeIds)
            .range(0, 4999)
        : { data: [], error: null }

    if (transactionResponse.error) {
      throw transactionResponse.error
    }

    const transactionCounts = new Map<string, number>()
    ;((transactionResponse.data ?? []) as TransactionEmployeeRow[]).forEach((transaction) => {
      if (!transaction.employee_id) {
        return
      }

      transactionCounts.set(transaction.employee_id, (transactionCounts.get(transaction.employee_id) ?? 0) + 1)
    })

    employees = visibleRoleRows.map((row) => {
      const employee = normalizeJoinedOne(row.users)
      const branch = normalizeJoinedOne(row.branches)

      return {
        roleId: row.id,
        userId: row.user_id,
        name: employee?.name ?? 'Unknown employee',
        email: employee?.email ?? '-',
        phone: employee?.phone ?? null,
        branchId: row.branch_id,
        branchName: branch?.name ?? 'Unknown branch',
        accountIsActive: employee?.is_active ?? false,
        accessIsActive: row.is_active,
        assignedAt: row.assigned_at,
        transactionCount: transactionCounts.get(row.user_id) ?? 0,
      }
    })
    metrics = buildEmployeeMetrics(employees)
  } catch (error: unknown) {
    logger.error('AdminEmployeesPage data fetch failed', { businessId, userId: profile.id, error })
    pageError = error instanceof Error ? error.message : 'Unable to load employees'
  }

  if (pageError) {
    return (
      <Card padding="md">
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-text-primary)', letterSpacing: '-0.3px' }}>
          Employees
        </h1>
        <p style={{ fontSize: 14, color: 'var(--color-danger)', marginTop: 8 }}>
          Failed to load the employees page. Please refresh and try again.
        </p>
      </Card>
    )
  }

  return <AdminEmployeesPageClient employees={employees} branches={branches} metrics={metrics} />
}
