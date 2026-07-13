'use server'
/**
 * Server Actions for Owner Branches page
 *
 * Contains server-side write operations for branches: adding a branch and
 * toggling branch active status. All actions validate inputs with Zod,
 * write audit log entries, and revalidate the owner branches page.
 */

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '../../../../lib/supabase/server'
import { requireRole } from '../../../../lib/auth/helpers'
import { createBranchSchema } from '@smartretail/shared'
import logger from '../../../../lib/logger'
import { GlobalRole } from '@smartretail/shared'
import { getSpreadsheetValue, parseSpreadsheetFile } from '../../../../lib/spreadsheets/workbooks'

/**
 * Standard form state returned to clients for server actions
 */
export type FormState = {
  error: string | null
  success: boolean
  message?: string
}

/**
 * Safely extract string values from FormData
 */
const getString = (formData: FormData, key: string): string => {
  const v = formData.get(key)
  return typeof v === 'string' ? v.trim() : ''
}

function revalidateBranchRoutes() {
  revalidatePath('/dashboard/owner/branches')
  revalidatePath('/dashboard/owner/admins')
  revalidatePath('/dashboard/owner/employees')
  revalidatePath('/dashboard/owner/stock')
  revalidatePath('/dashboard/owner/transfers')
  revalidatePath('/dashboard/owner/finances')
  revalidatePath('/dashboard/admin/employees')
  revalidatePath('/dashboard/admin/stock')
  revalidatePath('/dashboard/admin/damaged-stock')
  revalidatePath('/dashboard/employee')
  revalidatePath('/dashboard/employee/damaged-stock')
  revalidatePath('/dashboard/employee/transactions/new')
}

/**
 * Adds a new branch for the current owner's business.
 * Validates with Zod and uses the request's authenticated session.
 */
export async function addBranch(prevState: FormState, formData: FormData): Promise<FormState> {
  const name = getString(formData, 'name')
  const location = getString(formData, 'location')
  const branchType = getString(formData, 'branchType') as 'warehouse' | 'store'

  const validation = createBranchSchema.safeParse({ name, location, branchType })

  if (!validation.success) {
    return { error: validation.error.errors[0]?.message ?? 'Invalid input', success: false }
  }

  const profile = await requireRole([GlobalRole.Owner])
  const businessId = profile.business_id

  if (!businessId) {
    logger.error('addBranch: missing business id on owner profile', { userId: profile.id })
    return { error: 'Business context missing', success: false }
  }

  try {
    const supabase = await createClient()

    const { data: insertData, error: insertError } = await supabase
      .from('branches')
      .insert({ business_id: businessId, name, location, branch_type: branchType })
      .select('id')
      .single()

    if (insertError || !insertData?.id) {
      logger.error('addBranch: insert failed', { businessId, error: insertError })
      return { error: insertError?.message ?? 'Unable to add branch', success: false }
    }

    // Write audit log
    await supabase.from('audit_logs').insert({
      business_id: businessId,
      actor_id: profile.id,
      entity_type: 'branch',
      entity_id: insertData.id,
      action: 'created',
      old_value: null,
      new_value: { name, location, branch_type: branchType },
    })

    revalidateBranchRoutes()

    logger.info('Branch created', { businessId, branchId: insertData.id, actor: profile.id })

    return { error: null, success: true }
  } catch (err) {
    logger.error('addBranch: unexpected error', { error: String(err) })
    return { error: 'Server error', success: false }
  }
}

/**
 * Toggles the is_active flag for a branch and writes an audit log entry.
 */
export async function toggleBranchStatus(prevState: FormState, formData: FormData): Promise<FormState> {
  const branchId = getString(formData, 'branchId')
  const raw = formData.get('isActive')
  const isActive = typeof raw === 'string' ? raw === 'true' : false

  const profile = await requireRole([GlobalRole.Owner])
  const businessId = profile.business_id

  if (!businessId) {
    logger.error('toggleBranchStatus: missing business id', { userId: profile.id })
    return { error: 'Business context missing', success: false }
  }

  try {
    const supabase = await createClient()

    // Fetch current branch for audit old value
    const { data: current, error: fetchError } = await supabase
      .from('branches')
      .select('id, name, is_active, deleted_at')
      .eq('business_id', businessId)
      .eq('id', branchId)
      .maybeSingle()

    if (fetchError || !current) {
      logger.warn('toggleBranchStatus: branch not found', { branchId, businessId, error: fetchError })
      return { error: 'Branch not found', success: false }
    }

    if ((current as { deleted_at?: string | null }).deleted_at) {
      return { error: `${current.name} has been deleted`, success: false }
    }

    if (current.is_active === isActive) {
      return {
        error: `${current.name} is already ${isActive ? 'active' : 'inactive'}`,
        success: false,
      }
    }

    const { error: updateError } = await supabase
      .from('branches')
      .update({ is_active: isActive })
      .eq('id', branchId)

    if (updateError) {
      logger.error('toggleBranchStatus: update failed', { branchId, error: updateError })
      return { error: updateError.message ?? 'Unable to update branch', success: false }
    }

    // Audit
    await supabase.from('audit_logs').insert({
      business_id: businessId,
      actor_id: profile.id,
      entity_type: 'branch',
      entity_id: branchId,
      action: isActive ? 'activated' : 'deactivated',
      old_value: { is_active: current.is_active },
      new_value: { is_active: isActive },
    })

    revalidateBranchRoutes()

    logger.info('Branch status toggled', { branchId, isActive, actor: profile.id })

    return { error: null, success: true }
  } catch (err) {
    logger.error('toggleBranchStatus: unexpected error', { error: String(err) })
    return { error: 'Server error', success: false }
  }
}

const deleteBranchSchema = z.object({
  branchId: z.string().uuid(),
  reason: z.string().trim().max(240).optional(),
})

/**
 * Imports multiple branches from an XLSX or CSV spreadsheet.
 */
export async function importBranches(_prevState: FormState, formData: FormData): Promise<FormState> {
  const file = formData.get('file')

  if (!(file instanceof File) || file.size === 0) {
    return { error: 'Please upload a spreadsheet file', success: false }
  }

  const profile = await requireRole([GlobalRole.Owner])
  const businessId = profile.business_id

  if (!businessId) {
    logger.error('importBranches: missing business id on owner profile', { userId: profile.id })
    return { error: 'Business context missing', success: false }
  }

  try {
    const rows = await parseSpreadsheetFile(file)

    if (rows.length === 0) {
      return { error: 'The spreadsheet has no branch rows', success: false }
    }

    if (rows.length > 500) {
      return { error: 'Import up to 500 branches at a time', success: false }
    }

    const parsedBranches = rows.map((row, index) => {
      const validation = createBranchSchema.safeParse({
        name: getSpreadsheetValue(row, ['name', 'branch name']),
        location: getSpreadsheetValue(row, ['location']),
        branchType: getSpreadsheetValue(row, ['branch type', 'type']).toLowerCase(),
      })

      if (!validation.success) {
        throw new Error(`Row ${index + 2}: ${validation.error.errors[0]?.message ?? 'Invalid branch data'}`)
      }

      return validation.data
    })

    const supabase = await createClient()
    const { data: insertedBranches, error: insertError } = await supabase
      .from('branches')
      .insert(
        parsedBranches.map((branch) => ({
          business_id: businessId,
          name: branch.name,
          location: branch.location,
          branch_type: branch.branchType,
        }))
      )
      .select('id, name, location, branch_type')

    if (insertError || !insertedBranches) {
      logger.error('importBranches: insert failed', { businessId, error: insertError })
      return { error: insertError?.message ?? 'Unable to import branches', success: false }
    }

    const { error: auditError } = await supabase.from('audit_logs').insert(
      insertedBranches.map((branch) => ({
        business_id: businessId,
        actor_id: profile.id,
        entity_type: 'branch',
        entity_id: branch.id,
        action: 'created',
        old_value: null,
        new_value: {
          name: branch.name,
          location: branch.location,
          branch_type: branch.branch_type,
          source: 'spreadsheet_import',
        },
      }))
    )

    if (auditError) {
      logger.error('importBranches: audit insert failed', { businessId, error: auditError })
      return { error: auditError.message ?? 'Unable to write audit logs', success: false }
    }

    revalidateBranchRoutes()
    logger.info('Branches imported', { businessId, count: insertedBranches.length, actor: profile.id })

    return {
      error: null,
      success: true,
      message: `Imported ${insertedBranches.length} branches successfully.`,
    }
  } catch (error: unknown) {
    logger.error('importBranches: unexpected error', { businessId, error })
    return { error: error instanceof Error ? error.message : 'Server error', success: false }
  }
}

/**
 * Soft-deletes a branch and removes it from active operations.
 *
 * Historical records stay auditable, while active branch assignments, live stock,
 * recovery stock, and pending damage reports are cleaned up with the branch.
 */
export async function deleteBranch(_prevState: FormState, formData: FormData): Promise<FormState> {
  const validation = deleteBranchSchema.safeParse({
    branchId: getString(formData, 'branchId'),
    reason: getString(formData, 'reason') || undefined,
  })
  const confirmationName = getString(formData, 'confirmationName')

  if (!validation.success) {
    return { error: validation.error.errors[0]?.message ?? 'Invalid branch delete request', success: false }
  }

  const profile = await requireRole([GlobalRole.Owner])
  const businessId = profile.business_id

  if (!businessId) {
    logger.error('deleteBranch: missing business id on owner profile', { userId: profile.id })
    return { error: 'Business context missing', success: false }
  }

  try {
    const supabase = await createClient()
    const branchId = validation.data.branchId

    const [branchResponse, roleResponse, stockResponse, recoveryResponse, pendingDamageResponse] = await Promise.all([
      supabase
        .from('branches')
        .select('id, name, is_active, deleted_at')
        .eq('business_id', businessId)
        .eq('id', branchId)
        .maybeSingle(),
      supabase
        .from('user_branch_roles')
        .select('id, user_id, role, is_active, users!user_branch_roles_user_id_fkey(id, global_role, is_active, deleted_at)')
        .eq('business_id', businessId)
        .eq('branch_id', branchId),
      supabase
        .from('branch_stock')
        .select('id, quantity_on_hand, quantity_reserved, base_quantity_on_hand, base_quantity_reserved')
        .eq('business_id', businessId)
        .eq('branch_id', branchId),
      supabase
        .from('inventory_recovery_items')
        .select('id')
        .eq('business_id', businessId)
        .eq('branch_id', branchId)
        .gt('remaining_base_quantity', 0),
      supabase
        .from('employee_inventory_loss_reports')
        .select('id')
        .eq('business_id', businessId)
        .eq('branch_id', branchId)
        .eq('status', 'pending'),
    ])

    if (branchResponse.error) throw branchResponse.error
    if (roleResponse.error) throw roleResponse.error
    if (stockResponse.error) throw stockResponse.error
    if (recoveryResponse.error) throw recoveryResponse.error
    if (pendingDamageResponse.error) throw pendingDamageResponse.error

    const branch = branchResponse.data as { id: string; name: string; is_active: boolean; deleted_at: string | null } | null

    if (!branch) {
      return { error: 'Branch not found', success: false }
    }

    if (branch.deleted_at) {
      return { error: `${branch.name} is already deleted`, success: false }
    }

    if (confirmationName !== branch.name) {
      return { error: `Type ${branch.name} exactly to delete this branch`, success: false }
    }

    type BranchRoleUser = {
      id: string
      global_role: string
      is_active: boolean
      deleted_at: string | null
    }

    type BranchRoleRow = {
      id: string
      user_id: string
      role: string
      is_active: boolean | null
      users: BranchRoleUser | BranchRoleUser[] | null
    }

    const roleRows = (roleResponse.data ?? []) as BranchRoleRow[]
    const liveAssignedUsers = roleRows.filter((role) => {
      const user = Array.isArray(role.users) ? role.users[0] : role.users
      return (
        role.is_active !== false &&
        user?.deleted_at === null &&
        user?.is_active === true &&
        (user.global_role === 'admin' || user.global_role === 'employee')
      )
    })

    const affectedUserIds = Array.from(new Set(liveAssignedUsers.map((role) => role.user_id)))
    let orphanedUserIds: string[] = []

    if (affectedUserIds.length > 0) {
      const { data: remainingRoles, error: remainingRolesError } = await supabase
        .from('user_branch_roles')
        .select('user_id, branches!inner(deleted_at)')
        .eq('business_id', businessId)
        .in('user_id', affectedUserIds)
        .neq('branch_id', branchId)
        .eq('is_active', true)
        .is('branches.deleted_at', null)

      if (remainingRolesError) throw remainingRolesError

      const usersWithOtherBranches = new Set((remainingRoles ?? []).map((role) => role.user_id as string))
      orphanedUserIds = affectedUserIds.filter((userId) => !usersWithOtherBranches.has(userId))
    }

    const stockRows = (stockResponse.data ?? []) as Array<{ id: string }>
    const recoveryRows = (recoveryResponse.data ?? []) as Array<{ id: string }>
    const pendingDamageRows = (pendingDamageResponse.data ?? []) as Array<{ id: string }>
    const deletedAt = new Date().toISOString()
    const cascadeReason = validation.data.reason ?? `Deleted with branch: ${branch.name}`

    const { error: updateError } = await supabase
      .from('branches')
      .update({
        is_active: false,
        deleted_at: deletedAt,
        deleted_by: profile.id,
        delete_reason: validation.data.reason ?? null,
      })
      .eq('business_id', businessId)
      .eq('id', branch.id)

    if (updateError) {
      logger.error('deleteBranch: update failed', { businessId, branchId, error: updateError })
      return { error: updateError.message ?? 'Unable to delete branch', success: false }
    }

    const { error: roleUpdateError } = await supabase
      .from('user_branch_roles')
      .update({
        is_active: false,
        deactivated_at: deletedAt,
        deactivated_by: profile.id,
      })
      .eq('business_id', businessId)
      .eq('branch_id', branch.id)

    if (roleUpdateError) {
      logger.error('deleteBranch: role cleanup failed', { businessId, branchId, error: roleUpdateError })
      return { error: roleUpdateError.message ?? 'Branch deleted, but branch assignments cleanup failed', success: false }
    }

    if (orphanedUserIds.length > 0) {
      const { error: userDeleteError } = await supabase
        .from('users')
        .update({
          is_active: false,
          deleted_at: deletedAt,
          deleted_by: profile.id,
          delete_reason: cascadeReason,
        })
        .eq('business_id', businessId)
        .in('id', orphanedUserIds)
        .in('global_role', ['admin', 'employee'])

      if (userDeleteError) {
        logger.error('deleteBranch: orphaned user cleanup failed', { businessId, branchId, orphanedUserIds, error: userDeleteError })
        return { error: userDeleteError.message ?? 'Branch deleted, but branch staff cleanup failed', success: false }
      }
    }

    const { error: stockCleanupError } = await supabase
      .from('branch_stock')
      .update({
        quantity_on_hand: 0,
        quantity_reserved: 0,
        base_quantity_on_hand: 0,
        base_quantity_reserved: 0,
        last_updated_at: deletedAt,
      })
      .eq('business_id', businessId)
      .eq('branch_id', branch.id)

    if (stockCleanupError) {
      logger.error('deleteBranch: stock cleanup failed', { businessId, branchId, error: stockCleanupError })
      return { error: stockCleanupError.message ?? 'Branch deleted, but stock cleanup failed', success: false }
    }

    const { error: recoveryCleanupError } = await supabase
      .from('inventory_recovery_items')
      .update({ remaining_base_quantity: 0 })
      .eq('business_id', businessId)
      .eq('branch_id', branch.id)

    if (recoveryCleanupError) {
      logger.error('deleteBranch: recovery stock cleanup failed', { businessId, branchId, error: recoveryCleanupError })
      return { error: recoveryCleanupError.message ?? 'Branch deleted, but damaged stock cleanup failed', success: false }
    }

    const { error: damageCleanupError } = await supabase
      .from('employee_inventory_loss_reports')
      .update({
        status: 'rejected',
        reviewed_by: profile.id,
        reviewed_at: deletedAt,
        review_note: `Closed because branch ${branch.name} was deleted.`,
      })
      .eq('business_id', businessId)
      .eq('branch_id', branch.id)
      .eq('status', 'pending')

    if (damageCleanupError) {
      logger.error('deleteBranch: pending damage report cleanup failed', { businessId, branchId, error: damageCleanupError })
      return { error: damageCleanupError.message ?? 'Branch deleted, but pending damage cleanup failed', success: false }
    }

    const { error: auditError } = await supabase.from('audit_logs').insert({
      business_id: businessId,
      actor_id: profile.id,
      entity_type: 'branch',
      entity_id: branch.id,
      action: 'deleted',
      old_value: { name: branch.name, is_active: branch.is_active },
      new_value: {
        deleted_at: true,
        reason: validation.data.reason ?? null,
        branch_role_rows_deactivated: roleRows.length,
        orphaned_users_deleted: orphanedUserIds.length,
        stock_rows_cleared: stockRows.length,
        recovery_rows_cleared: recoveryRows.length,
        pending_damage_reports_closed: pendingDamageRows.length,
      },
    })

    if (auditError) {
      logger.error('deleteBranch: audit insert failed', { businessId, branchId, error: auditError })
      return { error: auditError.message ?? 'Branch deleted, but audit log failed', success: false }
    }

    revalidateBranchRoutes()
    logger.info('Branch soft-deleted', { businessId, branchId, actor: profile.id })
    return { error: null, success: true, message: 'Branch deleted successfully.' }
  } catch (error: unknown) {
    logger.error('deleteBranch: unexpected error', { businessId, error })
    return { error: error instanceof Error ? error.message : 'Server error', success: false }
  }
}
