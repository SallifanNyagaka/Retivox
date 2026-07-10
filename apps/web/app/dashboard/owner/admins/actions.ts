'use server'
/**
 * Server actions for the owner admins dashboard.
 *
 * These actions handle creating admins, sending invites, moving branch
 * assignments, and deactivating admin accounts with full audit logging.
 */

import { revalidatePath } from 'next/cache'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { GlobalRole, registerUserSchema } from '@smartretail/shared'
import { createClient } from '../../../../lib/supabase/server'
import { requireRole } from '../../../../lib/auth/helpers'
import logger from '../../../../lib/logger'
import { getSpreadsheetValue, parseSpreadsheetFile } from '../../../../lib/spreadsheets/workbooks'
import type { AdminUserRow, BranchRow, UserBranchRoleRow } from './types'

/**
 * Standard server-action response used by the admins workflow.
 */
export type FormState = {
  error: string | null
  success: boolean
  message?: string
}

/**
 * Shared validation for creating a new admin account.
 */
const createAdminSchema = registerUserSchema
  .pick({
    name: true,
    email: true,
    phone: true,
    password: true,
  })
  .extend({
    branchIds: z.array(z.string().uuid()).optional().default([]),
  })

/**
 * Shared validation for updating an admin's branch assignments.
 */
const updateAdminBranchesSchema = z.object({
  userId: z.string().uuid(),
  branchIds: z.array(z.string().uuid()).optional().default([]),
})

/**
 * Shared validation for admin transfer requests.
 */
const transferAdminSchema = z.object({
  userId: z.string().uuid(),
  fromBranchId: z.string().uuid(),
  toBranchId: z.string().uuid(),
})

/**
 * Shared validation for admin invite requests.
 */
const inviteAdminSchema = z.object({
  email: z.string().email(),
})

const deleteAdminSchema = z.object({
  userId: z.string().uuid(),
  reason: z.string().trim().max(240).optional(),
})

/**
 * Safely reads a trimmed string from FormData.
 */
function getString(formData: FormData, key: string): string {
  const value = formData.get(key)
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Collects repeated checkbox values from FormData.
 */
function getStringArray(formData: FormData, key: string): string[] {
  return formData
    .getAll(key)
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter(Boolean)
}

/**
 * Creates the Supabase admin client used for auth admin operations.
 */
function getServiceClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

/**
 * Builds a map of users keyed by ID from a user row list.
 */
function buildUserMap(users: AdminUserRow[]) {
  const map: Record<string, AdminUserRow> = {}

  users.forEach((user) => {
    map[user.id] = user
  })

  return map
}

/**
 * Adds a new admin account, assigns selected branches, and records an audit log.
 */
export async function addAdmin(_prevState: FormState, formData: FormData): Promise<FormState> {
  const name = getString(formData, 'name')
  const email = getString(formData, 'email')
  const phone = getString(formData, 'phone')
  const password = getString(formData, 'password')
  const branchIds = getStringArray(formData, 'branchIds')

  const validation = createAdminSchema.safeParse({
    name,
    email,
    phone,
    password,
    branchIds,
  })

  if (!validation.success) {
    return {
      error: validation.error.errors[0]?.message ?? 'Invalid admin data',
      success: false,
    }
  }

  const profile = await requireRole([GlobalRole.Owner])
  const businessId = profile.business_id

  if (!businessId) {
    logger.error('addAdmin: missing business id', { userId: profile.id })
    return { error: 'Business context missing', success: false }
  }

  const supabase = await createClient()
  const serviceClient = getServiceClient()
  let createdAuthUserId: string | null = null

  try {
    const [businessUsersResponse, businessRolesResponse, branchResponse] = await Promise.all([
      supabase.from('users').select('id, global_role').eq('business_id', businessId),
      supabase.from('user_branch_roles').select('user_id, branch_id').eq('business_id', businessId),
      supabase.from('branches').select('id').eq('business_id', businessId).in('id', branchIds),
    ])

    if (businessUsersResponse.error) {
      logger.error('addAdmin: user lookup failed', { businessId, error: businessUsersResponse.error })
      return { error: businessUsersResponse.error.message ?? 'Unable to load users', success: false }
    }

    if (businessRolesResponse.error) {
      logger.error('addAdmin: role lookup failed', { businessId, error: businessRolesResponse.error })
      return { error: businessRolesResponse.error.message ?? 'Unable to load branch roles', success: false }
    }

    if (branchResponse.error) {
      logger.error('addAdmin: branch lookup failed', { businessId, error: branchResponse.error })
      return { error: branchResponse.error.message ?? 'Unable to load branches', success: false }
    }

    const branches = (branchResponse.data ?? []) as BranchRow[]
    if (branches.length !== branchIds.length) {
      return { error: 'One or more selected branches are invalid', success: false }
    }

    const users = (businessUsersResponse.data ?? []) as AdminUserRow[]
    const userMap = buildUserMap(users)
    const takenBranchIds = new Set(
      ((businessRolesResponse.data ?? []) as UserBranchRoleRow[])
        .filter((role) => userMap[role.user_id]?.global_role === 'admin')
        .map((role) => role.branch_id)
    )

    const conflictingBranch = branchIds.find((branchId) => takenBranchIds.has(branchId))
    if (conflictingBranch) {
      return { error: 'One or more selected branches already has an admin assigned', success: false }
    }

    const { data: authData, error: authError } = await serviceClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        name,
        phone,
        global_role: 'admin',
      },
    })

    if (authError || !authData.user?.id) {
      logger.error('addAdmin: auth user creation failed', { businessId, error: authError })
      return { error: authError?.message ?? 'Unable to create admin auth account', success: false }
    }

    createdAuthUserId = authData.user.id

    const { error: userInsertError } = await supabase.from('users').insert({
      id: createdAuthUserId,
      business_id: businessId,
      name,
      email,
      phone,
      global_role: 'admin',
      is_active: true,
    })

    if (userInsertError) {
      logger.error('addAdmin: user insert failed', { businessId, error: userInsertError })
      await serviceClient.auth.admin.deleteUser(createdAuthUserId)
      return { error: userInsertError.message ?? 'Unable to save admin profile', success: false }
    }

    if (branchIds.length > 0) {
      const branchRolePayload = branchIds.map((branchId) => ({
        user_id: createdAuthUserId as string,
        branch_id: branchId,
        business_id: businessId,
        role: 'admin' as const,
        assigned_by: profile.id,
      }))

      const { error: branchRoleInsertError } = await supabase.from('user_branch_roles').insert(branchRolePayload)

      if (branchRoleInsertError) {
        logger.error('addAdmin: branch assignment insert failed', { businessId, error: branchRoleInsertError })
        await supabase.from('user_branch_roles').delete().eq('user_id', createdAuthUserId)
        await supabase.from('users').delete().eq('id', createdAuthUserId)
        await serviceClient.auth.admin.deleteUser(createdAuthUserId)
        return { error: branchRoleInsertError.message ?? 'Unable to assign branches', success: false }
      }
    }

    const { error: auditError } = await supabase.from('audit_logs').insert({
      business_id: businessId,
      actor_id: profile.id,
      entity_type: 'user',
      entity_id: createdAuthUserId,
      action: 'created',
      old_value: null,
      new_value: {
        global_role: 'admin',
        name,
        email,
        phone,
        branch_ids: branchIds,
      },
    })

    if (auditError) {
      logger.error('addAdmin: audit log insert failed', { businessId, error: auditError })
      return { error: auditError.message ?? 'Unable to write audit log', success: false }
    }

    revalidatePath('/dashboard/owner/admins')
    logger.info('Admin created', { businessId, adminId: createdAuthUserId, actor: profile.id })

    return { error: null, success: true }
  } catch (error: unknown) {
    if (createdAuthUserId) {
      await supabase.from('user_branch_roles').delete().eq('user_id', createdAuthUserId)
      await supabase.from('users').delete().eq('id', createdAuthUserId)
      await serviceClient.auth.admin.deleteUser(createdAuthUserId)
    }

    logger.error('addAdmin: unexpected error', { businessId, error })
    return { error: error instanceof Error ? error.message : 'Server error', success: false }
  }
}

/**
 * Sends an invite email to a future admin account.
 */
export async function inviteAdmin(_prevState: FormState, formData: FormData): Promise<FormState> {
  const email = getString(formData, 'email')

  const validation = inviteAdminSchema.safeParse({ email })
  if (!validation.success) {
    return {
      error: validation.error.errors[0]?.message ?? 'Invalid invite email',
      success: false,
    }
  }

  const profile = await requireRole([GlobalRole.Owner])
  const businessId = profile.business_id

  if (!businessId) {
    logger.error('inviteAdmin: missing business id', { userId: profile.id })
    return { error: 'Business context missing', success: false }
  }

  try {
    const serviceClient = getServiceClient()
    const redirectTo = `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/login`

    const { error: inviteError } = await serviceClient.auth.admin.inviteUserByEmail(email, {
      redirectTo,
      data: {
        global_role: 'admin',
        business_id: businessId,
      },
    })

    if (inviteError) {
      logger.error('inviteAdmin: invite failed', { businessId, error: inviteError })
      return { error: inviteError.message ?? 'Unable to send invite', success: false }
    }

    const supabase = await createClient()
    const { error: auditError } = await supabase.from('audit_logs').insert({
      business_id: businessId,
      actor_id: profile.id,
      entity_type: 'user',
      entity_id: profile.id,
      action: 'invited',
      old_value: null,
      new_value: {
        email,
        global_role: 'admin',
      },
    })

    if (auditError) {
      logger.error('inviteAdmin: audit log insert failed', { businessId, error: auditError })
      return { error: auditError.message ?? 'Unable to write audit log', success: false }
    }

    revalidatePath('/dashboard/owner/admins')
    logger.info('Admin invite sent', { businessId, email, actor: profile.id })
    return { error: null, success: true }
  } catch (error: unknown) {
    logger.error('inviteAdmin: unexpected error', { businessId, error })
    return { error: error instanceof Error ? error.message : 'Server error', success: false }
  }
}

/**
 * Updates the branch assignments for an existing admin account.
 */
export async function updateAdminBranches(_prevState: FormState, formData: FormData): Promise<FormState> {
  const userId = getString(formData, 'userId')
  const branchIds = getStringArray(formData, 'branchIds')

  const validation = updateAdminBranchesSchema.safeParse({ userId, branchIds })
  if (!validation.success) {
    return {
      error: validation.error.errors[0]?.message ?? 'Invalid branch assignment data',
      success: false,
    }
  }

  const profile = await requireRole([GlobalRole.Owner])
  const businessId = profile.business_id

  if (!businessId) {
    logger.error('updateAdminBranches: missing business id', { userId: profile.id })
    return { error: 'Business context missing', success: false }
  }

  try {
    const supabase = await createClient()

    const [userResponse, branchResponse, roleResponse, usersResponse] = await Promise.all([
      supabase
        .from('users')
        .select('id, name, email, global_role, is_active')
        .eq('business_id', businessId)
        .eq('id', userId)
        .maybeSingle(),
      supabase.from('branches').select('id').eq('business_id', businessId).in('id', branchIds),
      supabase.from('user_branch_roles').select('user_id, branch_id').eq('business_id', businessId),
      supabase.from('users').select('id, global_role').eq('business_id', businessId),
    ])

    if (userResponse.error) {
      logger.error('updateAdminBranches: user lookup failed', { businessId, error: userResponse.error })
      return { error: userResponse.error.message ?? 'Unable to load admin', success: false }
    }

    if (branchResponse.error) {
      logger.error('updateAdminBranches: branch lookup failed', { businessId, error: branchResponse.error })
      return { error: branchResponse.error.message ?? 'Unable to load branches', success: false }
    }

    if (roleResponse.error) {
      logger.error('updateAdminBranches: role lookup failed', { businessId, error: roleResponse.error })
      return { error: roleResponse.error.message ?? 'Unable to load branch roles', success: false }
    }

    if (usersResponse.error) {
      logger.error('updateAdminBranches: user map lookup failed', { businessId, error: usersResponse.error })
      return { error: usersResponse.error.message ?? 'Unable to load users', success: false }
    }

    const targetUser = userResponse.data as AdminUserRow | null
    if (!targetUser) {
      return { error: 'Admin not found', success: false }
    }

    if (targetUser.global_role !== 'admin') {
      return { error: 'Only admins can be edited from this screen', success: false }
    }

    const branches = (branchResponse.data ?? []) as BranchRow[]
    if (branches.length !== branchIds.length) {
      return { error: 'One or more selected branches are invalid', success: false }
    }

    const userMap = buildUserMap((usersResponse.data ?? []) as AdminUserRow[])
    const existingRoles = (roleResponse.data ?? []) as UserBranchRoleRow[]
    const currentBranchIds = existingRoles.filter((role) => role.user_id === userId).map((role) => role.branch_id)

    const takenByOtherAdmins = new Set(
      existingRoles
        .filter((role) => role.user_id !== userId && userMap[role.user_id]?.global_role === 'admin')
        .map((role) => role.branch_id)
    )

    const conflictingBranch = branchIds.find((branchId) => takenByOtherAdmins.has(branchId))
    if (conflictingBranch) {
      return { error: 'One or more selected branches already has an admin assigned', success: false }
    }

    const branchIdsToRemove = currentBranchIds.filter((branchId) => !branchIds.includes(branchId))
    const branchIdsToAdd = branchIds.filter((branchId) => !currentBranchIds.includes(branchId))

    if (branchIdsToRemove.length > 0) {
      const { error: deleteError } = await supabase
        .from('user_branch_roles')
        .delete()
        .eq('business_id', businessId)
        .eq('user_id', userId)
        .in('branch_id', branchIdsToRemove)

      if (deleteError) {
        logger.error('updateAdminBranches: branch role delete failed', { businessId, userId, error: deleteError })
        return { error: deleteError.message ?? 'Unable to remove branch assignments', success: false }
      }
    }

    if (branchIdsToAdd.length > 0) {
      const { error: insertError } = await supabase.from('user_branch_roles').insert(
        branchIdsToAdd.map((branchId) => ({
          user_id: userId,
          branch_id: branchId,
          business_id: businessId,
          role: 'admin' as const,
          assigned_by: profile.id,
        }))
      )

      if (insertError) {
        logger.error('updateAdminBranches: branch role insert failed', { businessId, userId, error: insertError })
        return { error: insertError.message ?? 'Unable to add branch assignments', success: false }
      }
    }

    const { error: auditError } = await supabase.from('audit_logs').insert({
      business_id: businessId,
      actor_id: profile.id,
      entity_type: 'user_branch_roles',
      entity_id: userId,
      action: 'updated',
      old_value: { branch_ids: currentBranchIds },
      new_value: { branch_ids: branchIds },
    })

    if (auditError) {
      logger.error('updateAdminBranches: audit insert failed', { businessId, userId, error: auditError })
      return { error: auditError.message ?? 'Unable to write audit log', success: false }
    }

    revalidatePath('/dashboard/owner/admins')
    logger.info('Admin branches updated', { businessId, userId, actor: profile.id })
    return { error: null, success: true }
  } catch (error: unknown) {
    logger.error('updateAdminBranches: unexpected error', { businessId, userId, error })
    return { error: error instanceof Error ? error.message : 'Server error', success: false }
  }
}

/**
 * Transfers a single admin branch assignment to another branch and logs history.
 */
export async function transferAdmin(_prevState: FormState, formData: FormData): Promise<FormState> {
  const userId = getString(formData, 'userId')
  const fromBranchId = getString(formData, 'fromBranchId')
  const toBranchId = getString(formData, 'toBranchId')

  const validation = transferAdminSchema.safeParse({ userId, fromBranchId, toBranchId })
  if (!validation.success) {
    return {
      error: validation.error.errors[0]?.message ?? 'Invalid transfer data',
      success: false,
    }
  }

  if (fromBranchId === toBranchId) {
    return { error: 'Source and destination branches must be different', success: false }
  }

  const profile = await requireRole([GlobalRole.Owner])
  const businessId = profile.business_id

  if (!businessId) {
    logger.error('transferAdmin: missing business id', { userId: profile.id })
    return { error: 'Business context missing', success: false }
  }

  try {
    const supabase = await createClient()

    const [userResponse, roleResponse, branchResponse, usersResponse] = await Promise.all([
      supabase
        .from('users')
        .select('id, name, email, global_role, is_active')
        .eq('business_id', businessId)
        .eq('id', userId)
        .maybeSingle(),
      supabase.from('user_branch_roles').select('user_id, branch_id').eq('business_id', businessId),
      supabase.from('branches').select('id').eq('business_id', businessId).in('id', [fromBranchId, toBranchId]),
      supabase.from('users').select('id, global_role').eq('business_id', businessId),
    ])

    if (userResponse.error) {
      logger.error('transferAdmin: user lookup failed', { businessId, userId, error: userResponse.error })
      return { error: userResponse.error.message ?? 'Unable to load admin', success: false }
    }

    if (roleResponse.error) {
      logger.error('transferAdmin: role lookup failed', { businessId, userId, error: roleResponse.error })
      return { error: roleResponse.error.message ?? 'Unable to load branch roles', success: false }
    }

    if (branchResponse.error) {
      logger.error('transferAdmin: branch lookup failed', { businessId, userId, error: branchResponse.error })
      return { error: branchResponse.error.message ?? 'Unable to load branches', success: false }
    }

    if (usersResponse.error) {
      logger.error('transferAdmin: user map lookup failed', { businessId, userId, error: usersResponse.error })
      return { error: usersResponse.error.message ?? 'Unable to load users', success: false }
    }

    const targetUser = userResponse.data as AdminUserRow | null
    if (!targetUser) {
      return { error: 'Admin not found', success: false }
    }

    if (targetUser.global_role !== 'admin') {
      return { error: 'Only admins can be transferred from this screen', success: false }
    }

    const branchRows = (branchResponse.data ?? []) as BranchRow[]
    if (branchRows.length !== 2) {
      return { error: 'One or more selected branches are invalid', success: false }
    }

    const userMap = buildUserMap((usersResponse.data ?? []) as AdminUserRow[])
    const existingRoles = (roleResponse.data ?? []) as UserBranchRoleRow[]
    const currentBranchIds = existingRoles.filter((role) => role.user_id === userId).map((role) => role.branch_id)

    if (!currentBranchIds.includes(fromBranchId)) {
      return { error: 'Selected source branch is not assigned to this admin', success: false }
    }

    const takenByOtherAdmins = new Set(
      existingRoles
        .filter((role) => role.user_id !== userId && userMap[role.user_id]?.global_role === 'admin')
        .map((role) => role.branch_id)
    )

    if (takenByOtherAdmins.has(toBranchId)) {
      return { error: 'Destination branch already has an admin assigned', success: false }
    }

    if (currentBranchIds.includes(toBranchId)) {
      return { error: 'This admin is already assigned to the destination branch', success: false }
    }

    const { error: deleteError } = await supabase
      .from('user_branch_roles')
      .delete()
      .eq('business_id', businessId)
      .eq('user_id', userId)
      .eq('branch_id', fromBranchId)

    if (deleteError) {
      logger.error('transferAdmin: source role delete failed', { businessId, userId, error: deleteError })
      return { error: deleteError.message ?? 'Unable to remove source branch assignment', success: false }
    }

    const { error: insertError } = await supabase.from('user_branch_roles').insert({
      user_id: userId,
      branch_id: toBranchId,
      business_id: businessId,
      role: 'admin',
      assigned_by: profile.id,
    })

    if (insertError) {
      logger.error('transferAdmin: destination role insert failed', { businessId, userId, error: insertError })
      return { error: insertError.message ?? 'Unable to assign destination branch', success: false }
    }

    const { error: transferInsertError } = await supabase.from('employee_transfers').insert({
      business_id: businessId,
      user_id: userId,
      from_branch_id: fromBranchId,
      to_branch_id: toBranchId,
      approved_by: profile.id,
      status: 'approved',
      requested_at: new Date().toISOString(),
      approved_at: new Date().toISOString(),
    })

    if (transferInsertError) {
      logger.error('transferAdmin: history insert failed', { businessId, userId, error: transferInsertError })
      return { error: transferInsertError.message ?? 'Unable to record transfer history', success: false }
    }

    const { error: auditError } = await supabase.from('audit_logs').insert({
      business_id: businessId,
      actor_id: profile.id,
      entity_type: 'employee_transfer',
      entity_id: userId,
      action: 'transferred',
      old_value: { from_branch_id: fromBranchId },
      new_value: { from_branch_id: fromBranchId, to_branch_id: toBranchId },
    })

    if (auditError) {
      logger.error('transferAdmin: audit insert failed', { businessId, userId, error: auditError })
      return { error: auditError.message ?? 'Unable to write audit log', success: false }
    }

    revalidatePath('/dashboard/owner/admins')
    logger.info('Admin branch transferred', { businessId, userId, fromBranchId, toBranchId, actor: profile.id })
    return { error: null, success: true }
  } catch (error: unknown) {
    logger.error('transferAdmin: unexpected error', { businessId, userId, error })
    return { error: error instanceof Error ? error.message : 'Server error', success: false }
  }
}

/**
 * Deactivates an admin account and records an audit log entry.
 */
export async function deactivateAdmin(userId: string, isActive: boolean): Promise<FormState> {
  const profile = await requireRole([GlobalRole.Owner])
  const businessId = profile.business_id

  if (!businessId) {
    logger.error('deactivateAdmin: missing business id', { userId: profile.id })
    return { error: 'Business context missing', success: false }
  }

  try {
    const supabase = await createClient()

    const { data: targetUser, error: fetchError } = await supabase
      .from('users')
      .select('id, name, global_role, is_active, deleted_at')
      .eq('business_id', businessId)
      .eq('id', userId)
      .maybeSingle()

    if (fetchError) {
      logger.error('deactivateAdmin: user lookup failed', { businessId, userId, error: fetchError })
      return { error: fetchError.message ?? 'Unable to load admin', success: false }
    }

    const adminUser = targetUser as (AdminUserRow & { deleted_at: string | null }) | null

    if (!adminUser) {
      return { error: 'Admin not found', success: false }
    }

    if (adminUser.global_role !== 'admin') {
      return { error: 'Only admins can be deactivated from this screen', success: false }
    }

    if (adminUser.deleted_at) {
      return { error: `${adminUser.name} has been deleted`, success: false }
    }

    if (adminUser.is_active === isActive) {
      return {
        error: `${adminUser.name} is already ${isActive ? 'active' : 'inactive'}`,
        success: false,
      }
    }

    const { error: updateError } = await supabase
      .from('users')
      .update({ is_active: isActive })
      .eq('business_id', businessId)
      .eq('id', userId)

    if (updateError) {
      logger.error('deactivateAdmin: update failed', { businessId, userId, error: updateError })
      return { error: updateError.message ?? 'Unable to deactivate admin', success: false }
    }

    const { error: auditError } = await supabase.from('audit_logs').insert({
      business_id: businessId,
      actor_id: profile.id,
      entity_type: 'user',
      entity_id: userId,
      action: isActive ? 'activated' : 'deactivated',
      old_value: { is_active: adminUser.is_active },
      new_value: { is_active: isActive },
    })

    if (auditError) {
      logger.error('deactivateAdmin: audit insert failed', { businessId, userId, error: auditError })
      return { error: auditError.message ?? 'Unable to write audit log', success: false }
    }

    revalidatePath('/dashboard/owner/admins')
    logger.info('Admin status changed', { businessId, userId, isActive, actor: profile.id })
    return { error: null, success: true }
  } catch (error: unknown) {
    logger.error('deactivateAdmin: unexpected error', { businessId, userId, error })
    return { error: error instanceof Error ? error.message : 'Server error', success: false }
  }
}

/**
 * Server-action wrapper used by the client modal for deactivation.
 */
export async function deactivateAdminAction(_prevState: FormState, formData: FormData): Promise<FormState> {
  const userId = getString(formData, 'userId')
  const isActive = formData.get('isActive') === 'true'

  if (!userId) {
    return { error: 'Missing admin id', success: false }
  }

  return deactivateAdmin(userId, isActive)
}

/**
 * Imports multiple admins from an XLSX or CSV spreadsheet.
 */
export async function importAdmins(_prevState: FormState, formData: FormData): Promise<FormState> {
  const file = formData.get('file')

  if (!(file instanceof File) || file.size === 0) {
    return { error: 'Please upload a spreadsheet file', success: false }
  }

  const profile = await requireRole([GlobalRole.Owner])
  const businessId = profile.business_id

  if (!businessId) {
    logger.error('importAdmins: missing business id', { userId: profile.id })
    return { error: 'Business context missing', success: false }
  }

  try {
    const rows = await parseSpreadsheetFile(file)

    if (rows.length === 0) {
      return { error: 'The spreadsheet has no admin rows', success: false }
    }

    if (rows.length > 100) {
      return { error: 'Import up to 100 admins at a time', success: false }
    }

    const supabase = await createClient()
    const { data: branchData, error: branchError } = await supabase
      .from('branches')
      .select('id, name')
      .eq('business_id', businessId)

    if (branchError) {
      logger.error('importAdmins: branch lookup failed', { businessId, error: branchError })
      return { error: branchError.message ?? 'Unable to load branches', success: false }
    }

    const branchMap = new Map(
      ((branchData ?? []) as Array<{ id: string; name: string }>).map((branch) => [
        branch.name.trim().toLowerCase(),
        branch.id,
      ])
    )

    const parsedAdmins = rows.map((row, index) => {
      const branchNames = getSpreadsheetValue(row, ['branches', 'assigned branches'])
        .split(/[;,]/)
        .map((name) => name.trim())
        .filter(Boolean)
      const branchIds = branchNames.map((branchName) => {
        const branchId = branchMap.get(branchName.toLowerCase())

        if (!branchId) {
          throw new Error(`Row ${index + 2}: branch "${branchName}" was not found`)
        }

        return branchId
      })

      const validation = createAdminSchema.safeParse({
        name: getSpreadsheetValue(row, ['name']),
        email: getSpreadsheetValue(row, ['email']),
        phone: getSpreadsheetValue(row, ['phone']),
        password: getSpreadsheetValue(row, ['password', 'temporary password']),
        branchIds,
      })

      if (!validation.success) {
        throw new Error(`Row ${index + 2}: ${validation.error.errors[0]?.message ?? 'Invalid admin data'}`)
      }

      return validation.data
    })

    const uploadedEmails = parsedAdmins.map((admin) => admin.email.toLowerCase())
    const duplicateEmail = uploadedEmails.find((email, index) => uploadedEmails.indexOf(email) !== index)

    if (duplicateEmail) {
      return { error: `Duplicate email in spreadsheet: ${duplicateEmail}`, success: false }
    }

    const uploadedBranchIds = parsedAdmins.flatMap((admin) => admin.branchIds)
    const duplicateBranchId = uploadedBranchIds.find((branchId, index) => uploadedBranchIds.indexOf(branchId) !== index)

    if (duplicateBranchId) {
      const branchName = Array.from(branchMap.entries()).find((entry) => entry[1] === duplicateBranchId)?.[0] ?? duplicateBranchId
      return { error: `Branch "${branchName}" is assigned to more than one uploaded admin`, success: false }
    }

    const [existingUsersResponse, existingRolesResponse, uploadedEmailResponse] = await Promise.all([
      supabase.from('users').select('id, global_role').eq('business_id', businessId),
      supabase.from('user_branch_roles').select('user_id, branch_id').eq('business_id', businessId),
      supabase.from('users').select('email').eq('business_id', businessId).in('email', uploadedEmails),
    ])

    if (existingUsersResponse.error) {
      logger.error('importAdmins: existing users lookup failed', { businessId, error: existingUsersResponse.error })
      return { error: existingUsersResponse.error.message ?? 'Unable to load users', success: false }
    }

    if (existingRolesResponse.error) {
      logger.error('importAdmins: existing roles lookup failed', { businessId, error: existingRolesResponse.error })
      return { error: existingRolesResponse.error.message ?? 'Unable to load branch roles', success: false }
    }

    if (uploadedEmailResponse.error) {
      logger.error('importAdmins: uploaded email lookup failed', { businessId, error: uploadedEmailResponse.error })
      return { error: uploadedEmailResponse.error.message ?? 'Unable to check existing users', success: false }
    }

    const existingEmail = ((uploadedEmailResponse.data ?? []) as Array<{ email: string }>)[0]?.email
    if (existingEmail) {
      return { error: `A user with email ${existingEmail} already exists`, success: false }
    }

    const userMap = buildUserMap((existingUsersResponse.data ?? []) as AdminUserRow[])
    const takenBranchIds = new Set(
      ((existingRolesResponse.data ?? []) as UserBranchRoleRow[])
        .filter((role) => userMap[role.user_id]?.global_role === 'admin')
        .map((role) => role.branch_id)
    )
    const conflictingBranchId = uploadedBranchIds.find((branchId) => takenBranchIds.has(branchId))

    if (conflictingBranchId) {
      const branchName = Array.from(branchMap.entries()).find((entry) => entry[1] === conflictingBranchId)?.[0] ?? conflictingBranchId
      return { error: `Branch "${branchName}" already has an admin assigned`, success: false }
    }

    const serviceClient = getServiceClient()
    const createdAuthUsers: Array<{
      id: string
      name: string
      email: string
      phone: string
      branchIds: string[]
    }> = []

    for (let index = 0; index < parsedAdmins.length; index += 3) {
      const batch = parsedAdmins.slice(index, index + 3)
      const results = await Promise.all(
        batch.map(async (admin) => {
          const { data: authData, error: authError } = await serviceClient.auth.admin.createUser({
            email: admin.email,
            password: admin.password,
            email_confirm: true,
            user_metadata: {
              name: admin.name,
              phone: admin.phone,
              global_role: 'admin',
            },
          })

          if (authError || !authData.user?.id) {
            return {
              error: authError?.message ?? `Unable to create auth account for ${admin.email}`,
              user: null,
            }
          }

          return {
            error: null,
            user: {
              id: authData.user.id,
              name: admin.name,
              email: admin.email,
              phone: admin.phone,
              branchIds: admin.branchIds,
            },
          }
        })
      )

      const failed = results.find((result) => result.error)
      if (failed) {
        await Promise.all(createdAuthUsers.map((user) => serviceClient.auth.admin.deleteUser(user.id)))
        return { error: failed.error ?? 'Unable to create admin auth account', success: false }
      }

      results.forEach((result) => {
        if (result.user) {
          createdAuthUsers.push(result.user)
        }
      })
    }

    const { error: userInsertError } = await supabase.from('users').insert(
      createdAuthUsers.map((user) => ({
        id: user.id,
        business_id: businessId,
        name: user.name,
        email: user.email,
        phone: user.phone,
        global_role: 'admin',
        is_active: true,
      }))
    )

    if (userInsertError) {
      logger.error('importAdmins: user batch insert failed', { businessId, error: userInsertError })
      await Promise.all(createdAuthUsers.map((user) => serviceClient.auth.admin.deleteUser(user.id)))
      return { error: userInsertError.message ?? 'Unable to save admin profiles', success: false }
    }

    const branchRolePayload = createdAuthUsers.flatMap((user) =>
      user.branchIds.map((branchId) => ({
        user_id: user.id,
        branch_id: branchId,
        business_id: businessId,
        role: 'admin' as const,
        assigned_by: profile.id,
      }))
    )

    if (branchRolePayload.length > 0) {
      const { error: roleInsertError } = await supabase.from('user_branch_roles').insert(branchRolePayload)

      if (roleInsertError) {
        logger.error('importAdmins: branch assignment batch insert failed', { businessId, error: roleInsertError })
        await supabase.from('users').delete().eq('business_id', businessId).in('id', createdAuthUsers.map((user) => user.id))
        await Promise.all(createdAuthUsers.map((user) => serviceClient.auth.admin.deleteUser(user.id)))
        return { error: roleInsertError.message ?? 'Unable to assign admin branches', success: false }
      }
    }

    const { error: auditError } = await supabase.from('audit_logs').insert(
      createdAuthUsers.map((user) => ({
        business_id: businessId,
        actor_id: profile.id,
        entity_type: 'user',
        entity_id: user.id,
        action: 'created',
        old_value: null,
        new_value: {
          global_role: 'admin',
          name: user.name,
          email: user.email,
          phone: user.phone,
          branch_ids: user.branchIds,
          source: 'spreadsheet_import',
        },
      }))
    )

    if (auditError) {
      logger.error('importAdmins: audit batch insert failed', { businessId, error: auditError })
      return { error: auditError.message ?? 'Unable to write audit logs', success: false }
    }

    revalidatePath('/dashboard/owner/admins')
    logger.info('Admins imported', { businessId, count: createdAuthUsers.length, actor: profile.id })

    return {
      error: null,
      success: true,
      message: `Imported ${createdAuthUsers.length} admins successfully.`,
    }
  } catch (error: unknown) {
    logger.error('importAdmins: unexpected error', { businessId, error })
    return { error: error instanceof Error ? error.message : 'Server error', success: false }
  }
}

/**
 * Soft-deletes an admin account while preserving audit actor history.
 */
export async function deleteAdmin(_prevState: FormState, formData: FormData): Promise<FormState> {
  const validation = deleteAdminSchema.safeParse({
    userId: getString(formData, 'userId'),
    reason: getString(formData, 'reason') || undefined,
  })

  if (!validation.success) {
    return { error: validation.error.errors[0]?.message ?? 'Invalid admin delete request', success: false }
  }

  const profile = await requireRole([GlobalRole.Owner])
  const businessId = profile.business_id

  if (!businessId) {
    logger.error('deleteAdmin: missing business id', { userId: profile.id })
    return { error: 'Business context missing', success: false }
  }

  try {
    const supabase = await createClient()

    const { data: adminData, error: adminError } = await supabase
      .from('users')
      .select('id, name, email, phone, global_role, is_active, deleted_at')
      .eq('business_id', businessId)
      .eq('id', validation.data.userId)
      .maybeSingle()

    if (adminError) {
      logger.error('deleteAdmin: lookup failed', { businessId, userId: validation.data.userId, error: adminError })
      return { error: adminError.message ?? 'Unable to load admin', success: false }
    }

    const admin = adminData as (AdminUserRow & { deleted_at: string | null }) | null

    if (!admin || admin.global_role !== 'admin') {
      return { error: 'Admin not found', success: false }
    }

    if (admin.deleted_at) {
      return { error: `${admin.name} is already deleted`, success: false }
    }

    const { error: updateError } = await supabase
      .from('users')
      .update({
        is_active: false,
        deleted_at: new Date().toISOString(),
        deleted_by: profile.id,
        delete_reason: validation.data.reason ?? null,
      })
      .eq('business_id', businessId)
      .eq('id', admin.id)

    if (updateError) {
      logger.error('deleteAdmin: update failed', { businessId, userId: admin.id, error: updateError })
      return { error: updateError.message ?? 'Unable to delete admin', success: false }
    }

    const { error: auditError } = await supabase.from('audit_logs').insert({
      business_id: businessId,
      actor_id: profile.id,
      entity_type: 'user',
      entity_id: admin.id,
      action: 'deleted',
      old_value: {
        global_role: admin.global_role,
        name: admin.name,
        email: admin.email,
        phone: admin.phone,
        is_active: admin.is_active,
      },
      new_value: { deleted_at: true, reason: validation.data.reason ?? null },
    })

    if (auditError) {
      logger.error('deleteAdmin: audit insert failed', { businessId, userId: admin.id, error: auditError })
      return { error: auditError.message ?? 'Admin deleted, but audit log failed', success: false }
    }

    revalidatePath('/dashboard/owner/admins')
    logger.info('Admin soft-deleted', { businessId, userId: admin.id, actor: profile.id })
    return { error: null, success: true, message: 'Admin deleted successfully.' }
  } catch (error: unknown) {
    logger.error('deleteAdmin: unexpected error', { businessId, error })
    return { error: error instanceof Error ? error.message : 'Server error', success: false }
  }
}
