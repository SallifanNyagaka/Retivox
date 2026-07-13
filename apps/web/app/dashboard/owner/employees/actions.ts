'use server'
/**
 * Server actions for the owner employees dashboard.
 *
 * These actions create employees, invite employees by email, request and
 * approve employee transfers, and deactivate employee accounts.
 */

import { revalidatePath } from 'next/cache'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { GlobalRole, registerUserSchema } from '@smartretail/shared'
import { createClient } from '../../../../lib/supabase/server'
import { requireRole } from '../../../../lib/auth/helpers'
import logger from '../../../../lib/logger'
import { getSpreadsheetValue, parseSpreadsheetFile } from '../../../../lib/spreadsheets/workbooks'
import type { BranchRow, EmployeeUserRow, UserBranchRoleRow } from './types'

/**
 * Standard server action state for employee forms.
 */
export type FormState = {
  error: string | null
  success: boolean
  message?: string
}

/**
 * Validates employee creation fields.
 */
const createEmployeeSchema = registerUserSchema
  .pick({
    name: true,
    email: true,
    phone: true,
    password: true,
  })
  .extend({
    branchId: z.string().uuid(),
  })

/**
 * Validates invite form fields.
 */
const inviteEmployeeSchema = z.object({
  email: z.string().email(),
})

/**
 * Validates employee transfer requests.
 */
const transferEmployeeSchema = z.object({
  userId: z.string().uuid(),
  fromBranchId: z.string().uuid(),
  toBranchId: z.string().uuid(),
})

/**
 * Validates transfer approval requests.
 */
const approveTransferSchema = z.object({
  transferId: z.string().uuid(),
})

/**
 * Validates employee deactivation requests.
 */
const deactivateEmployeeSchema = z.object({
  userId: z.string().uuid(),
  isActive: z.boolean(),
})

const deleteEmployeeSchema = z.object({
  userId: z.string().uuid(),
  reason: z.string().trim().max(240).optional(),
})

/**
 * Safely reads a trimmed string value from FormData.
 */
function getString(formData: FormData, key: string): string {
  const value = formData.get(key)
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Creates a Supabase service-role client for auth admin operations.
 */
function getServiceClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

/**
 * Adds a new employee account and assigns the employee to one branch.
 */
export async function addEmployee(_prevState: FormState, formData: FormData): Promise<FormState> {
  const name = getString(formData, 'name')
  const email = getString(formData, 'email')
  const phone = getString(formData, 'phone')
  const password = getString(formData, 'password')
  const branchId = getString(formData, 'branchId')

  const validation = createEmployeeSchema.safeParse({
    name,
    email,
    phone,
    password,
    branchId,
  })

  if (!validation.success) {
    return {
      error: validation.error.errors[0]?.message ?? 'Invalid employee data',
      success: false,
    }
  }

  const profile = await requireRole([GlobalRole.Owner])
  const businessId = profile.business_id

  if (!businessId) {
    logger.error('addEmployee: missing business id', { userId: profile.id })
    return { error: 'Business context missing', success: false }
  }

  const supabase = await createClient()
  const serviceClient = getServiceClient()
  let createdAuthUserId: string | null = null

  try {
    const { data: branchData, error: branchError } = await supabase
      .from('branches')
      .select('id, name, is_active')
      .eq('business_id', businessId)
      .eq('id', branchId)
      .maybeSingle()

    if (branchError) {
      logger.error('addEmployee: branch lookup failed', { businessId, branchId, error: branchError })
      return { error: branchError.message ?? 'Unable to load branch', success: false }
    }

    const branch = branchData as BranchRow | null
    if (!branch) {
      return { error: 'Selected branch was not found', success: false }
    }

    const { data: authData, error: authError } = await serviceClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        name,
        phone,
        global_role: 'employee',
      },
    })

    if (authError || !authData.user?.id) {
      logger.error('addEmployee: auth user creation failed', { businessId, error: authError })
      return { error: authError?.message ?? 'Unable to create employee auth account', success: false }
    }

    createdAuthUserId = authData.user.id

    const { error: userInsertError } = await supabase.from('users').insert({
      id: createdAuthUserId,
      business_id: businessId,
      name,
      email,
      phone,
      global_role: 'employee',
      is_active: true,
    })

    if (userInsertError) {
      logger.error('addEmployee: user insert failed', { businessId, error: userInsertError })
      await serviceClient.auth.admin.deleteUser(createdAuthUserId)
      return { error: userInsertError.message ?? 'Unable to save employee profile', success: false }
    }

    const { error: roleInsertError } = await supabase.from('user_branch_roles').insert({
      user_id: createdAuthUserId,
      branch_id: branchId,
      business_id: businessId,
      role: 'employee',
      assigned_by: profile.id,
    })

    if (roleInsertError) {
      logger.error('addEmployee: branch assignment failed', { businessId, error: roleInsertError })
      await supabase.from('users').delete().eq('id', createdAuthUserId)
      await serviceClient.auth.admin.deleteUser(createdAuthUserId)
      return { error: roleInsertError.message ?? 'Unable to assign employee branch', success: false }
    }

    const { error: auditError } = await supabase.from('audit_logs').insert({
      business_id: businessId,
      actor_id: profile.id,
      entity_type: 'user',
      entity_id: createdAuthUserId,
      action: 'created',
      old_value: null,
      new_value: {
        global_role: 'employee',
        name,
        email,
        phone,
        branch_id: branchId,
      },
    })

    if (auditError) {
      logger.error('addEmployee: audit insert failed', { businessId, error: auditError })
      return { error: auditError.message ?? 'Unable to write audit log', success: false }
    }

    revalidatePath('/dashboard/owner/employees')
    logger.info('Employee created', { businessId, employeeId: createdAuthUserId, actor: profile.id })
    return { error: null, success: true }
  } catch (error: unknown) {
    if (createdAuthUserId) {
      await supabase.from('user_branch_roles').delete().eq('user_id', createdAuthUserId)
      await supabase.from('users').delete().eq('id', createdAuthUserId)
      await serviceClient.auth.admin.deleteUser(createdAuthUserId)
    }

    logger.error('addEmployee: unexpected error', { businessId, error })
    return { error: error instanceof Error ? error.message : 'Server error', success: false }
  }
}

/**
 * Sends an email invite for a future employee account.
 */
export async function inviteEmployee(_prevState: FormState, formData: FormData): Promise<FormState> {
  const email = getString(formData, 'email')
  const validation = inviteEmployeeSchema.safeParse({ email })

  if (!validation.success) {
    return {
      error: validation.error.errors[0]?.message ?? 'Invalid invite email',
      success: false,
    }
  }

  const profile = await requireRole([GlobalRole.Owner])
  const businessId = profile.business_id

  if (!businessId) {
    logger.error('inviteEmployee: missing business id', { userId: profile.id })
    return { error: 'Business context missing', success: false }
  }

  try {
    const serviceClient = getServiceClient()
    const redirectTo = `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/employee/login`

    const { error: inviteError } = await serviceClient.auth.admin.inviteUserByEmail(email, {
      redirectTo,
      data: {
        global_role: 'employee',
        business_id: businessId,
      },
    })

    if (inviteError) {
      logger.error('inviteEmployee: invite failed', { businessId, error: inviteError })
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
        global_role: 'employee',
      },
    })

    if (auditError) {
      logger.error('inviteEmployee: audit insert failed', { businessId, error: auditError })
      return { error: auditError.message ?? 'Unable to write audit log', success: false }
    }

    revalidatePath('/dashboard/owner/employees')
    logger.info('Employee invite sent', { businessId, email, actor: profile.id })
    return { error: null, success: true }
  } catch (error: unknown) {
    logger.error('inviteEmployee: unexpected error', { businessId, error })
    return { error: error instanceof Error ? error.message : 'Server error', success: false }
  }
}

/**
 * Creates a pending transfer request for an employee.
 */
export async function transferEmployee(_prevState: FormState, formData: FormData): Promise<FormState> {
  const userId = getString(formData, 'userId')
  const fromBranchId = getString(formData, 'fromBranchId')
  const toBranchId = getString(formData, 'toBranchId')

  const validation = transferEmployeeSchema.safeParse({ userId, fromBranchId, toBranchId })
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
    logger.error('transferEmployee: missing business id', { userId: profile.id })
    return { error: 'Business context missing', success: false }
  }

  try {
    const supabase = await createClient()

    const [userResponse, roleResponse, branchResponse] = await Promise.all([
      supabase
        .from('users')
        .select('id, name, email, global_role, is_active')
        .eq('business_id', businessId)
        .eq('id', userId)
        .maybeSingle(),
      supabase
        .from('user_branch_roles')
        .select('id, user_id, branch_id, role, assigned_at')
        .eq('business_id', businessId)
        .eq('user_id', userId)
        .eq('role', 'employee'),
      supabase.from('branches').select('id, name, is_active').eq('business_id', businessId).in('id', [fromBranchId, toBranchId]),
    ])

    if (userResponse.error) {
      logger.error('transferEmployee: user lookup failed', { businessId, userId, error: userResponse.error })
      return { error: userResponse.error.message ?? 'Unable to load employee', success: false }
    }

    if (roleResponse.error) {
      logger.error('transferEmployee: role lookup failed', { businessId, userId, error: roleResponse.error })
      return { error: roleResponse.error.message ?? 'Unable to load employee branch', success: false }
    }

    if (branchResponse.error) {
      logger.error('transferEmployee: branch lookup failed', { businessId, userId, error: branchResponse.error })
      return { error: branchResponse.error.message ?? 'Unable to load branches', success: false }
    }

    const employee = userResponse.data as EmployeeUserRow | null
    if (!employee || employee.global_role !== 'employee') {
      return { error: 'Employee not found', success: false }
    }

    const branchRows = (branchResponse.data ?? []) as BranchRow[]
    if (branchRows.length !== 2) {
      return { error: 'One or more selected branches are invalid', success: false }
    }

    const currentRoles = (roleResponse.data ?? []) as UserBranchRoleRow[]
    if (!currentRoles.some((role) => role.branch_id === fromBranchId)) {
      return { error: 'Selected source branch is not assigned to this employee', success: false }
    }

    const now = new Date().toISOString()
    const { data: transferData, error: transferError } = await supabase
      .from('employee_transfers')
      .insert({
        business_id: businessId,
        user_id: userId,
        from_branch_id: fromBranchId,
        to_branch_id: toBranchId,
        approved_by: null,
        status: 'pending',
        requested_at: now,
        approved_at: null,
      })
      .select('id')
      .single()

    if (transferError || !transferData?.id) {
      logger.error('transferEmployee: transfer insert failed', { businessId, userId, error: transferError })
      return { error: transferError?.message ?? 'Unable to create transfer request', success: false }
    }

    const { error: notificationError } = await supabase.from('notifications').insert({
      business_id: businessId,
      recipient_id: profile.id,
      type: 'employee_transfer',
      title: 'Employee transfer requested',
      body: `${employee.name} has a pending branch transfer request.`,
      metadata: {
        transfer_id: transferData.id,
        employee_id: userId,
        from_branch_id: fromBranchId,
        to_branch_id: toBranchId,
      },
      is_read: false,
    })

    if (notificationError) {
      logger.error('transferEmployee: notification insert failed', { businessId, userId, error: notificationError })
      return { error: notificationError.message ?? 'Unable to notify owner', success: false }
    }

    const { error: auditError } = await supabase.from('audit_logs').insert({
      business_id: businessId,
      actor_id: profile.id,
      entity_type: 'employee_transfer',
      entity_id: transferData.id,
      action: 'requested',
      old_value: { from_branch_id: fromBranchId },
      new_value: { from_branch_id: fromBranchId, to_branch_id: toBranchId, status: 'pending' },
    })

    if (auditError) {
      logger.error('transferEmployee: audit insert failed', { businessId, userId, error: auditError })
      return { error: auditError.message ?? 'Unable to write audit log', success: false }
    }

    revalidatePath('/dashboard/owner/employees')
    logger.info('Employee transfer requested', { businessId, userId, fromBranchId, toBranchId, actor: profile.id })
    return { error: null, success: true }
  } catch (error: unknown) {
    logger.error('transferEmployee: unexpected error', { businessId, userId, error })
    return { error: error instanceof Error ? error.message : 'Server error', success: false }
  }
}

/**
 * Approves a pending employee transfer and updates the employee branch assignment.
 */
export async function approveTransfer(_prevState: FormState, formData: FormData): Promise<FormState> {
  const transferId = getString(formData, 'transferId')
  const validation = approveTransferSchema.safeParse({ transferId })

  if (!validation.success) {
    return { error: validation.error.errors[0]?.message ?? 'Invalid transfer', success: false }
  }

  const profile = await requireRole([GlobalRole.Owner])
  const businessId = profile.business_id

  if (!businessId) {
    logger.error('approveTransfer: missing business id', { userId: profile.id })
    return { error: 'Business context missing', success: false }
  }

  try {
    const supabase = await createClient()

    const { error } = await supabase.rpc('owner_approve_employee_transfer', {
      p_transfer_id: transferId,
    })

    if (error) {
      logger.error('approveTransfer: RPC failed', { businessId, transferId, error })
      return { error: error.message ?? 'Unable to approve transfer', success: false }
    }

    revalidatePath('/dashboard/owner/employees')
    logger.info('Employee transfer approved', { businessId, transferId, actor: profile.id })
    return { error: null, success: true }
  } catch (error: unknown) {
    logger.error('approveTransfer: unexpected error', { businessId, transferId, error })
    return { error: error instanceof Error ? error.message : 'Server error', success: false }
  }
}

/**
 * Deactivates an employee account.
 */
export async function deactivateEmployee(_prevState: FormState, formData: FormData): Promise<FormState> {
  const userId = getString(formData, 'userId')
  const isActive = formData.get('isActive') === 'true'
  const validation = deactivateEmployeeSchema.safeParse({ userId, isActive })

  if (!validation.success) {
    return { error: validation.error.errors[0]?.message ?? 'Invalid employee id', success: false }
  }

  const profile = await requireRole([GlobalRole.Owner])
  const businessId = profile.business_id

  if (!businessId) {
    logger.error('deactivateEmployee: missing business id', { userId: profile.id })
    return { error: 'Business context missing', success: false }
  }

  try {
    const supabase = await createClient()

    const { data: employeeData, error: employeeError } = await supabase
      .from('users')
      .select('id, name, global_role, is_active, deleted_at')
      .eq('business_id', businessId)
      .eq('id', userId)
      .maybeSingle()

    if (employeeError) {
      logger.error('deactivateEmployee: employee lookup failed', { businessId, userId, error: employeeError })
      return { error: employeeError.message ?? 'Unable to load employee', success: false }
    }

    const employee = employeeData as (EmployeeUserRow & { deleted_at: string | null }) | null
    if (!employee || employee.global_role !== 'employee') {
      return { error: 'Employee not found', success: false }
    }

    if (employee.deleted_at) {
      return { error: `${employee.name} has been deleted`, success: false }
    }

    if (employee.is_active === isActive) {
      return {
        error: `${employee.name} is already ${isActive ? 'active' : 'inactive'}`,
        success: false,
      }
    }

    const { error: updateError } = await supabase
      .from('users')
      .update({ is_active: isActive })
      .eq('business_id', businessId)
      .eq('id', userId)

    if (updateError) {
      logger.error('deactivateEmployee: update failed', { businessId, userId, error: updateError })
      return { error: updateError.message ?? 'Unable to deactivate employee', success: false }
    }

    const { error: roleUpdateError } = await supabase
      .from('user_branch_roles')
      .update({
        is_active: isActive,
        deactivated_at: isActive ? null : new Date().toISOString(),
        deactivated_by: isActive ? null : profile.id,
      })
      .eq('business_id', businessId)
      .eq('user_id', userId)
      .eq('role', 'employee')

    if (roleUpdateError) {
      logger.error('deactivateEmployee: branch role sync failed', { businessId, userId, error: roleUpdateError })
      return { error: roleUpdateError.message ?? 'Employee status changed, but branch access did not sync', success: false }
    }

    const { error: auditError } = await supabase.from('audit_logs').insert({
      business_id: businessId,
      actor_id: profile.id,
      entity_type: 'user',
      entity_id: userId,
      action: isActive ? 'activated' : 'deactivated',
      old_value: { is_active: employee.is_active },
      new_value: { is_active: isActive },
    })

    if (auditError) {
      logger.error('deactivateEmployee: audit insert failed', { businessId, userId, error: auditError })
      return { error: auditError.message ?? 'Unable to write audit log', success: false }
    }

    revalidatePath('/dashboard/owner/employees')
    revalidatePath('/dashboard/owner/branches')
    revalidatePath('/dashboard/admin/employees')
    logger.info('Employee status changed', { businessId, userId, isActive, actor: profile.id })
    return { error: null, success: true }
  } catch (error: unknown) {
    logger.error('deactivateEmployee: unexpected error', { businessId, userId, error })
    return { error: error instanceof Error ? error.message : 'Server error', success: false }
  }
}

/**
 * Imports multiple employees from an XLSX or CSV spreadsheet.
 */
export async function importEmployees(_prevState: FormState, formData: FormData): Promise<FormState> {
  const file = formData.get('file')

  if (!(file instanceof File) || file.size === 0) {
    return { error: 'Please upload a spreadsheet file', success: false }
  }

  const profile = await requireRole([GlobalRole.Owner])
  const businessId = profile.business_id

  if (!businessId) {
    logger.error('importEmployees: missing business id', { userId: profile.id })
    return { error: 'Business context missing', success: false }
  }

  try {
    const rows = await parseSpreadsheetFile(file)

    if (rows.length === 0) {
      return { error: 'The spreadsheet has no employee rows', success: false }
    }

    if (rows.length > 200) {
      return { error: 'Import up to 200 employees at a time', success: false }
    }

    const supabase = await createClient()
    const { data: branchData, error: branchError } = await supabase
      .from('branches')
      .select('id, name')
      .eq('business_id', businessId)

    if (branchError) {
      logger.error('importEmployees: branch lookup failed', { businessId, error: branchError })
      return { error: branchError.message ?? 'Unable to load branches', success: false }
    }

    const branchMap = new Map(
      ((branchData ?? []) as Array<{ id: string; name: string }>).map((branch) => [
        branch.name.trim().toLowerCase(),
        branch.id,
      ])
    )

    const parsedEmployees = rows.map((row, index) => {
      const branchName = getSpreadsheetValue(row, ['branch', 'branch name']).toLowerCase()
      const branchId = branchMap.get(branchName)

      if (!branchId) {
        throw new Error(`Row ${index + 2}: branch "${branchName || 'blank'}" was not found`)
      }

      const validation = createEmployeeSchema.safeParse({
        name: getSpreadsheetValue(row, ['name']),
        email: getSpreadsheetValue(row, ['email']),
        phone: getSpreadsheetValue(row, ['phone']),
        password: getSpreadsheetValue(row, ['password', 'temporary password']),
        branchId,
      })

      if (!validation.success) {
        throw new Error(`Row ${index + 2}: ${validation.error.errors[0]?.message ?? 'Invalid employee data'}`)
      }

      return validation.data
    })

    const uploadedEmails = parsedEmployees.map((employee) => employee.email.toLowerCase())
    const duplicateEmail = uploadedEmails.find((email, index) => uploadedEmails.indexOf(email) !== index)

    if (duplicateEmail) {
      return { error: `Duplicate email in spreadsheet: ${duplicateEmail}`, success: false }
    }

    const { data: existingUsers, error: existingUsersError } = await supabase
      .from('users')
      .select('email')
      .eq('business_id', businessId)
      .in('email', uploadedEmails)

    if (existingUsersError) {
      logger.error('importEmployees: existing user lookup failed', { businessId, error: existingUsersError })
      return { error: existingUsersError.message ?? 'Unable to check existing users', success: false }
    }

    const existingEmail = ((existingUsers ?? []) as Array<{ email: string }>)[0]?.email
    if (existingEmail) {
      return { error: `A user with email ${existingEmail} already exists`, success: false }
    }

    const serviceClient = getServiceClient()
    const createdAuthUsers: Array<{
      id: string
      name: string
      email: string
      phone: string
      branchId: string
    }> = []

    for (let index = 0; index < parsedEmployees.length; index += 3) {
      const batch = parsedEmployees.slice(index, index + 3)
      const results = await Promise.all(
        batch.map(async (employee) => {
          const { data: authData, error: authError } = await serviceClient.auth.admin.createUser({
            email: employee.email,
            password: employee.password,
            email_confirm: true,
            user_metadata: {
              name: employee.name,
              phone: employee.phone,
              global_role: 'employee',
            },
          })

          if (authError || !authData.user?.id) {
            return {
              error: authError?.message ?? `Unable to create auth account for ${employee.email}`,
              user: null,
            }
          }

          return {
            error: null,
            user: {
              id: authData.user.id,
              name: employee.name,
              email: employee.email,
              phone: employee.phone,
              branchId: employee.branchId,
            },
          }
        })
      )

      const failed = results.find((result) => result.error)
      if (failed) {
        await Promise.all(createdAuthUsers.map((user) => serviceClient.auth.admin.deleteUser(user.id)))
        return { error: failed.error ?? 'Unable to create employee auth account', success: false }
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
        global_role: 'employee',
        is_active: true,
      }))
    )

    if (userInsertError) {
      logger.error('importEmployees: user batch insert failed', { businessId, error: userInsertError })
      await Promise.all(createdAuthUsers.map((user) => serviceClient.auth.admin.deleteUser(user.id)))
      return { error: userInsertError.message ?? 'Unable to save employee profiles', success: false }
    }

    const { error: roleInsertError } = await supabase.from('user_branch_roles').insert(
      createdAuthUsers.map((user) => ({
        user_id: user.id,
        branch_id: user.branchId,
        business_id: businessId,
        role: 'employee',
        assigned_by: profile.id,
      }))
    )

    if (roleInsertError) {
      logger.error('importEmployees: branch assignment batch insert failed', { businessId, error: roleInsertError })
      await supabase.from('users').delete().eq('business_id', businessId).in('id', createdAuthUsers.map((user) => user.id))
      await Promise.all(createdAuthUsers.map((user) => serviceClient.auth.admin.deleteUser(user.id)))
      return { error: roleInsertError.message ?? 'Unable to assign employee branches', success: false }
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
          global_role: 'employee',
          name: user.name,
          email: user.email,
          phone: user.phone,
          branch_id: user.branchId,
          source: 'spreadsheet_import',
        },
      }))
    )

    if (auditError) {
      logger.error('importEmployees: audit batch insert failed', { businessId, error: auditError })
      return { error: auditError.message ?? 'Unable to write audit logs', success: false }
    }

    revalidatePath('/dashboard/owner/employees')
    logger.info('Employees imported', { businessId, count: createdAuthUsers.length, actor: profile.id })

    return {
      error: null,
      success: true,
      message: `Imported ${createdAuthUsers.length} employees successfully.`,
    }
  } catch (error: unknown) {
    logger.error('importEmployees: unexpected error', { businessId, error })
    return { error: error instanceof Error ? error.message : 'Server error', success: false }
  }
}

/**
 * Soft-deletes an employee account while preserving transaction and audit history.
 */
export async function deleteEmployee(_prevState: FormState, formData: FormData): Promise<FormState> {
  const validation = deleteEmployeeSchema.safeParse({
    userId: getString(formData, 'userId'),
    reason: getString(formData, 'reason') || undefined,
  })

  if (!validation.success) {
    return { error: validation.error.errors[0]?.message ?? 'Invalid employee delete request', success: false }
  }

  const profile = await requireRole([GlobalRole.Owner])
  const businessId = profile.business_id

  if (!businessId) {
    logger.error('deleteEmployee: missing business id', { userId: profile.id })
    return { error: 'Business context missing', success: false }
  }

  try {
    const supabase = await createClient()

    const { data: employeeData, error: employeeError } = await supabase
      .from('users')
      .select('id, name, email, phone, global_role, is_active, deleted_at')
      .eq('business_id', businessId)
      .eq('id', validation.data.userId)
      .maybeSingle()

    if (employeeError) {
      logger.error('deleteEmployee: lookup failed', { businessId, userId: validation.data.userId, error: employeeError })
      return { error: employeeError.message ?? 'Unable to load employee', success: false }
    }

    const employee = employeeData as (EmployeeUserRow & { deleted_at: string | null }) | null

    if (!employee || employee.global_role !== 'employee') {
      return { error: 'Employee not found', success: false }
    }

    if (employee.deleted_at) {
      return { error: `${employee.name} is already deleted`, success: false }
    }

    const deletedAt = new Date().toISOString()

    const { error: updateError } = await supabase
      .from('users')
      .update({
        is_active: false,
        deleted_at: deletedAt,
        deleted_by: profile.id,
        delete_reason: validation.data.reason ?? null,
      })
      .eq('business_id', businessId)
      .eq('id', employee.id)

    if (updateError) {
      logger.error('deleteEmployee: update failed', { businessId, userId: employee.id, error: updateError })
      return { error: updateError.message ?? 'Unable to delete employee', success: false }
    }

    const { error: roleUpdateError } = await supabase
      .from('user_branch_roles')
      .update({
        is_active: false,
        deactivated_at: deletedAt,
        deactivated_by: profile.id,
      })
      .eq('business_id', businessId)
      .eq('user_id', employee.id)
      .eq('role', 'employee')

    if (roleUpdateError) {
      logger.error('deleteEmployee: branch role sync failed', { businessId, userId: employee.id, error: roleUpdateError })
      return { error: roleUpdateError.message ?? 'Employee deleted, but branch access did not sync', success: false }
    }

    const { error: auditError } = await supabase.from('audit_logs').insert({
      business_id: businessId,
      actor_id: profile.id,
      entity_type: 'user',
      entity_id: employee.id,
      action: 'deleted',
      old_value: {
        global_role: employee.global_role,
        name: employee.name,
        email: employee.email,
        phone: employee.phone,
        is_active: employee.is_active,
      },
      new_value: { deleted_at: true, reason: validation.data.reason ?? null },
    })

    if (auditError) {
      logger.error('deleteEmployee: audit insert failed', { businessId, userId: employee.id, error: auditError })
      return { error: auditError.message ?? 'Employee deleted, but audit log failed', success: false }
    }

    revalidatePath('/dashboard/owner/employees')
    revalidatePath('/dashboard/owner/branches')
    revalidatePath('/dashboard/admin/employees')
    logger.info('Employee soft-deleted', { businessId, userId: employee.id, actor: profile.id })
    return { error: null, success: true, message: 'Employee deleted successfully.' }
  } catch (error: unknown) {
    logger.error('deleteEmployee: unexpected error', { businessId, error })
    return { error: error instanceof Error ? error.message : 'Server error', success: false }
  }
}
