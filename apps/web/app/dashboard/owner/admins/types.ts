/**
 * Shared types for the owner admins dashboard.
 *
 * These types keep the page, client components, and server actions aligned
 * without repeating raw Supabase row shapes in every file.
 */

/**
 * Minimal user row used by the owner admins page.
 */
export type AdminUserRow = {
  id: string
  name: string
  email: string
  phone: string | null
  global_role: 'owner' | 'admin'
  is_active: boolean
  created_at: string
}

/**
 * Minimal branch row used for admin assignment and transfer pickers.
 */
export type BranchRow = {
  id: string
  name: string
  is_active: boolean
}

/**
 * Minimal branch-role row used to map admins to branches.
 */
export type UserBranchRoleRow = {
  id: string
  user_id: string
  branch_id: string
  role: 'owner' | 'admin' | 'employee'
  assigned_at: string
}

/**
 * Minimal employee transfer row used for the history tab.
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
 * Hydrated admin row with human-readable branch information.
 */
export type AdminRow = AdminUserRow & {
  assignedBranchIds: string[]
  assignedBranchNames: string[]
  transactionCount: number
}

/**
 * Hydrated transfer history row with branch and user labels.
 */
export type TransferHistoryRow = EmployeeTransferRow & {
  user_name: string
  approved_by_name: string | null
  from_branch_name: string
  to_branch_name: string
}
