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
 * Soft-deletes a branch after checking that no users or stock are still assigned.
 */
export async function deleteBranch(_prevState: FormState, formData: FormData): Promise<FormState> {
  const validation = deleteBranchSchema.safeParse({
    branchId: getString(formData, 'branchId'),
    reason: getString(formData, 'reason') || undefined,
  })

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

    const [branchResponse, roleResponse, stockResponse] = await Promise.all([
      supabase
        .from('branches')
        .select('id, name, is_active, deleted_at')
        .eq('business_id', businessId)
        .eq('id', branchId)
        .maybeSingle(),
      supabase
        .from('user_branch_roles')
        .select('id, is_active, users!user_branch_roles_user_id_fkey(id, global_role, is_active, deleted_at)')
        .eq('business_id', businessId)
        .eq('branch_id', branchId),
      supabase
        .from('branch_stock')
        .select('id, quantity_on_hand, quantity_reserved')
        .eq('business_id', businessId)
        .eq('branch_id', branchId),
    ])

    if (branchResponse.error) throw branchResponse.error
    if (roleResponse.error) throw roleResponse.error
    if (stockResponse.error) throw stockResponse.error

    const branch = branchResponse.data as { id: string; name: string; is_active: boolean; deleted_at: string | null } | null

    if (!branch) {
      return { error: 'Branch not found', success: false }
    }

    if (branch.deleted_at) {
      return { error: `${branch.name} is already deleted`, success: false }
    }

    const liveAssignedUsers = (roleResponse.data ?? []).filter((role) => {
      const user = Array.isArray(role.users) ? role.users[0] : role.users
      return (
        role.is_active !== false &&
        user?.deleted_at === null &&
        user?.is_active === true &&
        (user.global_role === 'admin' || user.global_role === 'employee')
      )
    })

    if (liveAssignedUsers.length > 0) {
      return { error: 'Move assigned admins/employees away from this branch before deleting it', success: false }
    }

    const stockRows = (stockResponse.data ?? []) as Array<{ quantity_on_hand: number; quantity_reserved: number }>
    const hasStock = stockRows.some((stock) => Number(stock.quantity_on_hand) > 0 || Number(stock.quantity_reserved) > 0)

    if (hasStock) {
      return { error: 'Move or clear branch stock before deleting this branch', success: false }
    }

    const { error: updateError } = await supabase
      .from('branches')
      .update({
        is_active: false,
        deleted_at: new Date().toISOString(),
        deleted_by: profile.id,
        delete_reason: validation.data.reason ?? null,
      })
      .eq('business_id', businessId)
      .eq('id', branch.id)

    if (updateError) {
      logger.error('deleteBranch: update failed', { businessId, branchId, error: updateError })
      return { error: updateError.message ?? 'Unable to delete branch', success: false }
    }

    const { error: auditError } = await supabase.from('audit_logs').insert({
      business_id: businessId,
      actor_id: profile.id,
      entity_type: 'branch',
      entity_id: branch.id,
      action: 'deleted',
      old_value: { name: branch.name, is_active: branch.is_active },
      new_value: { deleted_at: true, reason: validation.data.reason ?? null },
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
