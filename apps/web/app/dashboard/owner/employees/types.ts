/**
 * Shared types for the owner employees dashboard.
 *
 * These row shapes keep the server page, client components, and server actions
 * aligned without using untyped Supabase results.
 */

/**
 * Business user row used when loading owner, admin, and employee labels.
 */
export type BusinessUserRow = {
  id: string
  name: string
  email: string
  phone: string | null
  global_role: 'owner' | 'admin' | 'employee'
  is_active: boolean
  created_at: string
}

/**
 * Minimal employee user row shown in the employee directory.
 */
export type EmployeeUserRow = {
  id: string
  name: string
  email: string
  phone: string | null
  global_role: 'employee'
  is_active: boolean
  created_at: string
}

/**
 * Minimal user row used for transfer history labels.
 */
export type UserNameRow = {
  id: string
  name: string
}

/**
 * Minimal branch row used by employee assignment pickers.
 */
export type BranchRow = {
  id: string
  name: string
  is_active: boolean
}

/**
 * Branch-role row used to map employees to their assigned branch.
 */
export type UserBranchRoleRow = {
  id: string
  user_id: string
  branch_id: string
  role: 'owner' | 'admin' | 'employee'
  assigned_at: string
}

/**
 * Transaction count row used to summarize employee activity.
 */
export type TransactionEmployeeRow = {
  employee_id: string
}

/**
 * Raw employee transfer row from employee_transfers.
 */
export type EmployeeTransferRow = {
  id: string
  user_id: string
  from_branch_id: string
  to_branch_id: string
  approved_by: string | null
  status: 'pending' | 'approved' | 'rejected'
  requested_at: string
  approved_at: string | null
}

/**
 * Hydrated employee row with branch label and activity count.
 */
export type EmployeeRow = EmployeeUserRow & {
  assignedBranchId: string | null
  assignedBranchName: string | null
  transactionCount: number
}

/**
 * Transfer row hydrated with names for the history tab.
 */
export type TransferHistoryRow = EmployeeTransferRow & {
  user_name: string
  approved_by_name: string | null
  from_branch_name: string
  to_branch_name: string
}
