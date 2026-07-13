'use server'
/**
 * Server actions for the admin employees dashboard.
 *
 * Admin actions are intentionally branch-scoped: admins can add employees to
 * branches they administer and can deactivate or restore employee access for
 * those same branches only.
 */

import { revalidatePath } from 'next/cache'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { GlobalRole, registerUserSchema } from '@smartretail/shared'
import { assertBranchAccess } from '../../../../lib/auth/branchAccess'
import { requireRole } from '../../../../lib/auth/helpers'
import logger from '../../../../lib/logger'
import { createClient } from '../../../../lib/supabase/server'

/**
 * Standard state returned to admin employee forms.
 */
export type AdminEmployeeFormState = {
  error: string | null
  success: boolean
  message?: string
}

/**
 * Minimal branch row used while validating branch assignment.
 */
type BranchRow = {
  id: string
  name: string
  is_active: boolean
  deleted_at: string | null
}

/**
 * Minimal employee row used while validating branch access changes.
 */
type EmployeeUserRow = {
  id: string
  name: string
  global_role: 'owner' | 'admin' | 'employee'
  is_active: boolean
  deleted_at: string | null
}

/**
 * Branch-role row returned for branch access changes.
 */
type EmployeeBranchRoleRow = {
  id: string
  user_id: string
  branch_id: string
  business_id: string
  role: 'owner' | 'admin' | 'employee'
  is_active: boolean
  users: EmployeeUserRow[]
}

/**
 * Validates admin employee creation fields.
 */
const addEmployeeSchema = registerUserSchema
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
 * Validates branch access activation/deactivation requests.
 */
const setEmployeeBranchAccessSchema = z.object({
  roleId: z.string().uuid(),
  userId: z.string().uuid(),
  branchId: z.string().uuid(),
  isActive: z.boolean(),
})

/**
 * Safely reads a trimmed string value from FormData.
 */
function getString(formData: FormData, key: string): string {
  const value = formData.get(key)
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Creates a service-role client for auth admin work after branch authorization.
 */
function getServiceClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

/**
 * Revalidates employee pages touched by admin access changes.
 */
function revalidateEmployeeDashboards() {
  revalidatePath('/dashboard/admin/employees')
  revalidatePath('/dashboard/owner/employees')
  revalidatePath('/dashboard/owner/branches')
}

/**
 * Adds an employee to a branch administered by the current admin.
 */
export async function addAdminEmployee(
  _prevState: AdminEmployeeFormState,
  formData: FormData
): Promise<AdminEmployeeFormState> {
  const profile = await requireRole([GlobalRole.Admin])
  const businessId = profile.business_id

  if (!businessId) {
    logger.error('addAdminEmployee: missing business id', { userId: profile.id })
    return { error: 'Business context missing', success: false }
  }

  const payload = {
    name: getString(formData, 'name'),
    email: getString(formData, 'email'),
    phone: getString(formData, 'phone'),
    password: getString(formData, 'password'),
    branchId: getString(formData, 'branchId'),
  }
  const validation = addEmployeeSchema.safeParse(payload)

  if (!validation.success) {
    return {
      error: validation.error.errors[0]?.message ?? 'Invalid employee data',
      success: false,
    }
  }

  try {
    await assertBranchAccess(profile.id, validation.data.branchId, 'admin', 'add_admin_employee')

    const supabase = await createClient()
    const serviceClient = getServiceClient()
    let createdAuthUserId: string | null = null

    const { data: branchData, error: branchError } = await supabase
      .from('branches')
      .select('id, name, is_active, deleted_at')
      .eq('business_id', businessId)
      .eq('id', validation.data.branchId)
      .maybeSingle()

    if (branchError) {
      logger.error('addAdminEmployee: branch lookup failed', {
        businessId,
        branchId: validation.data.branchId,
        error: branchError,
      })
      return { error: branchError.message ?? 'Unable to load branch', success: false }
    }

    const branch = branchData as BranchRow | null
    if (!branch || branch.deleted_at || !branch.is_active) {
      return { error: 'Selected branch is not available', success: false }
    }

    try {
      const { data: authData, error: authError } = await serviceClient.auth.admin.createUser({
        email: validation.data.email,
        password: validation.data.password,
        email_confirm: true,
        user_metadata: {
          name: validation.data.name,
          phone: validation.data.phone,
          global_role: 'employee',
        },
      })

      if (authError || !authData.user?.id) {
        logger.error('addAdminEmployee: auth user creation failed', { businessId, error: authError })
        return { error: authError?.message ?? 'Unable to create employee auth account', success: false }
      }

      createdAuthUserId = authData.user.id

      const { error: userInsertError } = await serviceClient.from('users').insert({
        id: createdAuthUserId,
        business_id: businessId,
        name: validation.data.name,
        email: validation.data.email,
        phone: validation.data.phone,
        global_role: 'employee',
        is_active: true,
      })

      if (userInsertError) {
        logger.error('addAdminEmployee: user insert failed', { businessId, error: userInsertError })
        await serviceClient.auth.admin.deleteUser(createdAuthUserId)
        return { error: userInsertError.message ?? 'Unable to save employee profile', success: false }
      }

      const { error: roleInsertError } = await serviceClient.from('user_branch_roles').insert({
        user_id: createdAuthUserId,
        branch_id: validation.data.branchId,
        business_id: businessId,
        role: 'employee',
        assigned_by: profile.id,
        is_active: true,
      })

      if (roleInsertError) {
        logger.error('addAdminEmployee: branch assignment failed', { businessId, error: roleInsertError })
        await serviceClient.from('users').delete().eq('id', createdAuthUserId)
        await serviceClient.auth.admin.deleteUser(createdAuthUserId)
        return { error: roleInsertError.message ?? 'Unable to assign employee branch', success: false }
      }

      const { error: auditError } = await supabase.from('audit_logs').insert({
        business_id: businessId,
        actor_id: profile.id,
        entity_type: 'user',
        entity_id: createdAuthUserId,
        action: 'created_by_admin',
        old_value: null,
        new_value: {
          global_role: 'employee',
          branch_id: validation.data.branchId,
          branch_name: branch.name,
        },
      })

      if (auditError) {
        logger.error('addAdminEmployee: audit insert failed', { businessId, error: auditError })
        return { error: auditError.message ?? 'Unable to write audit log', success: false }
      }

      revalidateEmployeeDashboards()
      logger.info('Admin employee created', {
        businessId,
        employeeId: createdAuthUserId,
        branchId: validation.data.branchId,
        actor: profile.id,
      })
      return { error: null, success: true, message: 'Employee added successfully' }
    } catch (error: unknown) {
      if (createdAuthUserId) {
        await serviceClient.from('user_branch_roles').delete().eq('user_id', createdAuthUserId)
        await serviceClient.from('users').delete().eq('id', createdAuthUserId)
        await serviceClient.auth.admin.deleteUser(createdAuthUserId)
      }

      logger.error('addAdminEmployee: creation rollback failed', { businessId, error })
      return { error: error instanceof Error ? error.message : 'Server error', success: false }
    }
  } catch (error: unknown) {
    logger.error('addAdminEmployee: unexpected error', { businessId, error })
    return { error: error instanceof Error ? error.message : 'Server error', success: false }
  }
}

/**
 * Activates or deactivates employee access for one administered branch.
 */
export async function setEmployeeBranchAccess(
  _prevState: AdminEmployeeFormState,
  formData: FormData
): Promise<AdminEmployeeFormState> {
  const profile = await requireRole([GlobalRole.Admin])
  const businessId = profile.business_id

  if (!businessId) {
    logger.error('setEmployeeBranchAccess: missing business id', { userId: profile.id })
    return { error: 'Business context missing', success: false }
  }

  const payload = {
    roleId: getString(formData, 'roleId'),
    userId: getString(formData, 'userId'),
    branchId: getString(formData, 'branchId'),
    isActive: formData.get('isActive') === 'true',
  }
  const validation = setEmployeeBranchAccessSchema.safeParse(payload)

  if (!validation.success) {
    return { error: validation.error.errors[0]?.message ?? 'Invalid employee access request', success: false }
  }

  try {
    await assertBranchAccess(profile.id, validation.data.branchId, 'admin', 'set_employee_branch_access')

    const supabase = await createClient()
    const serviceClient = getServiceClient()

    const { data: roleData, error: roleError } = await supabase
      .from('user_branch_roles')
      .select(
        'id, user_id, branch_id, business_id, role, is_active, users!user_branch_roles_user_id_fkey(id, name, global_role, is_active, deleted_at)'
      )
      .eq('business_id', businessId)
      .eq('id', validation.data.roleId)
      .eq('user_id', validation.data.userId)
      .eq('branch_id', validation.data.branchId)
      .maybeSingle()

    if (roleError) {
      logger.error('setEmployeeBranchAccess: role lookup failed', { businessId, payload: validation.data, error: roleError })
      return { error: roleError.message ?? 'Unable to load employee access', success: false }
    }

    const role = roleData as EmployeeBranchRoleRow | null
    const employee = role?.users?.[0]

    if (!role || role.role !== 'employee' || !employee || employee.global_role !== 'employee') {
      return { error: 'Employee branch access was not found', success: false }
    }

    if (employee.deleted_at) {
      return { error: `${employee.name} has been deleted`, success: false }
    }

    if (role.is_active === validation.data.isActive) {
      return {
        error: `${employee.name} already has ${validation.data.isActive ? 'active' : 'inactive'} access for this branch`,
        success: false,
      }
    }

    const now = new Date().toISOString()
    const { error: updateError } = await serviceClient
      .from('user_branch_roles')
      .update({
        is_active: validation.data.isActive,
        deactivated_at: validation.data.isActive ? null : now,
        deactivated_by: validation.data.isActive ? null : profile.id,
      })
      .eq('business_id', businessId)
      .eq('id', role.id)
      .eq('role', 'employee')

    if (updateError) {
      logger.error('setEmployeeBranchAccess: update failed', { businessId, roleId: role.id, error: updateError })
      return { error: updateError.message ?? 'Unable to update employee access', success: false }
    }

    const { error: auditError } = await supabase.from('audit_logs').insert({
      business_id: businessId,
      actor_id: profile.id,
      entity_type: 'user_branch_role',
      entity_id: role.id,
      action: validation.data.isActive ? 'branch_access_activated' : 'branch_access_deactivated',
      old_value: {
        user_id: role.user_id,
        branch_id: role.branch_id,
        is_active: role.is_active,
      },
      new_value: {
        user_id: role.user_id,
        branch_id: role.branch_id,
        is_active: validation.data.isActive,
      },
    })

    if (auditError) {
      logger.error('setEmployeeBranchAccess: audit insert failed', { businessId, roleId: role.id, error: auditError })
      return { error: auditError.message ?? 'Unable to write audit log', success: false }
    }

    revalidateEmployeeDashboards()
    logger.info('Admin employee branch access changed', {
      businessId,
      roleId: role.id,
      userId: role.user_id,
      branchId: role.branch_id,
      isActive: validation.data.isActive,
      actor: profile.id,
    })

    return {
      error: null,
      success: true,
      message: validation.data.isActive ? 'Employee branch access restored' : 'Employee branch access deactivated',
    }
  } catch (error: unknown) {
    logger.error('setEmployeeBranchAccess: unexpected error', { businessId, payload: validation.data, error })
    return { error: error instanceof Error ? error.message : 'Server error', success: false }
  }
}
