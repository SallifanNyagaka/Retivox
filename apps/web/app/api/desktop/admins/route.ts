import { NextResponse } from 'next/server'
import { z } from 'zod'
import { registerUserSchema } from '@smartretail/shared'
import { createServiceRoleClient } from '../../../../lib/supabase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const createAdminSchema = registerUserSchema
  .pick({ name: true, email: true, phone: true, password: true })
  .extend({ branchIds: z.array(z.string().uuid()).max(100).default([]) })

const inviteSchema = z.object({ action: z.literal('invite'), email: z.string().email() })
const updateBranchesSchema = z.object({
  action: z.literal('update_branches'),
  userId: z.string().uuid(),
  branchIds: z.array(z.string().uuid()).max(100),
})
const setActiveSchema = z.object({
  action: z.literal('set_active'),
  userId: z.string().uuid(),
  isActive: z.boolean(),
})
const requestSchema = z.discriminatedUnion('action', [
  createAdminSchema.extend({ action: z.literal('create') }),
  inviteSchema,
  updateBranchesSchema,
  setActiveSchema,
])

type OwnerProfile = {
  id: string
  business_id: string | null
  global_role: string | null
  is_active: boolean | null
  deleted_at: string | null
}

type AssignmentUser = {
  id: string
  global_role: string | null
  is_active: boolean | null
  deleted_at: string | null
}

type AssignmentRole = {
  user_id: string
  branch_id: string
  is_active: boolean | null
}

export async function POST(request: Request) {
  const parsed = await readRequest(request)
  if (!parsed) return response({ error: 'Invalid request body.' }, 400)

  const authorization = request.headers.get('authorization') ?? ''
  const token = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length).trim()
    : ''
  if (!token || token.length > 8192) {
    return response({ error: 'Sign in again before managing administrators.' }, 401)
  }

  let supabase: ReturnType<typeof createServiceRoleClient>
  try {
    supabase = createServiceRoleClient()
  } catch {
    return response({ error: 'Administrator services are not configured.' }, 503)
  }

  const { data: authData, error: authError } = await supabase.auth.getUser(token)
  if (authError || !authData.user) {
    return response({ error: 'Your online session is invalid or expired.' }, 401)
  }

  const { data: profileData, error: profileError } = await supabase
    .from('users')
    .select('id, business_id, global_role, is_active, deleted_at')
    .eq('id', authData.user.id)
    .maybeSingle()

  const profile = profileData as OwnerProfile | null
  if (
    profileError ||
    !profile ||
    profile.global_role !== 'owner' ||
    profile.is_active !== true ||
    profile.deleted_at !== null
  ) {
    return response({ error: 'Only an active business owner can manage administrators.' }, 403)
  }
  if (!profile.business_id) {
    return response({ error: 'Business context is missing.' }, 403)
  }

  const validation = requestSchema.safeParse(parsed)
  if (!validation.success) {
    return response({ error: validation.error.issues[0]?.message ?? 'Invalid administrator request.' }, 400)
  }

  const businessId = profile.business_id
  const actorId = profile.id

  if (validation.data.action === 'invite') {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL
    if (!appUrl) return response({ error: 'Administrator invitations are not configured.' }, 503)

    const { error } = await supabase.auth.admin.inviteUserByEmail(validation.data.email, {
      redirectTo: `${appUrl.replace(/\/+$/, '')}/admin/login`,
      data: { global_role: 'admin', business_id: businessId },
    })
    if (error) return response({ error: error.message }, 400)

    const { error: auditError } = await supabase.from('audit_logs').insert({
      business_id: businessId,
      actor_id: actorId,
      entity_type: 'user',
      entity_id: actorId,
      action: 'invited',
      old_value: null,
      new_value: { email: validation.data.email, global_role: 'admin' },
    })
    if (auditError) return response({ error: auditError.message }, 500)
    return response({ success: true })
  }

  if (validation.data.action === 'create') {
    const { name, email, phone, password, branchIds } = validation.data
    if (new Set(branchIds).size !== branchIds.length) {
      return response({ error: 'Remove duplicate branch selections.' }, 400)
    }

    const [usersResult, rolesResult] = await Promise.all([
      supabase.from('users').select('id, global_role, is_active, deleted_at').eq('business_id', businessId),
      supabase.from('user_branch_roles').select('user_id, branch_id, is_active').eq('business_id', businessId),
    ])
    if (usersResult.error || rolesResult.error) {
      return response({ error: 'Unable to verify the selected branches and existing assignments.' }, 500)
    }
    if (branchIds.length > 0) {
      const { data: branches, error } = await supabase.from('branches').select('id')
        .eq('business_id', businessId).eq('is_active', true)
        .is('deleted_at', null).in('id', branchIds)
      if (error) return response({ error: 'Unable to verify the selected branches.' }, 500)
      if ((branches ?? []).length !== branchIds.length) {
        return response({ error: 'One or more selected branches are unavailable.' }, 400)
      }
    }
    const users = (usersResult.data ?? []) as AssignmentUser[]
    const userMap = new Map(users.map((user) => [user.id, user]))
    const occupied = new Set(
      ((rolesResult.data ?? []) as AssignmentRole[])
        .filter((role) => {
          const assignedUser = userMap.get(role.user_id)
          return role.is_active !== false &&
            assignedUser?.global_role === 'admin' &&
            assignedUser.is_active !== false &&
            assignedUser.deleted_at == null
        })
        .map((role) => role.branch_id),
    )
    if (branchIds.some((branchId) => occupied.has(branchId))) {
      return response({ error: 'One or more selected branches already has an active admin.' }, 409)
    }

    const { data: authResult, error: authCreateError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name, phone, global_role: 'admin' },
    })
    const newUserId = authResult.user?.id
    if (authCreateError || !newUserId) {
      return response({ error: authCreateError?.message ?? 'Unable to create the admin account.' }, 400)
    }

    const { error: userInsertError } = await supabase.from('users').insert({
      id: newUserId,
      business_id: businessId,
      name,
      email,
      phone,
      global_role: 'admin',
      is_active: true,
    })
    if (userInsertError) {
      await supabase.auth.admin.deleteUser(newUserId)
      return response({ error: userInsertError.message }, 500)
    }

    if (branchIds.length > 0) {
      const { error: roleInsertError } = await supabase.from('user_branch_roles').insert(
        branchIds.map((branchId) => ({
          user_id: newUserId,
          branch_id: branchId,
          business_id: businessId,
          role: 'admin',
          assigned_by: actorId,
        })),
      )
      if (roleInsertError) {
        await supabase.from('users').delete().eq('business_id', businessId).eq('id', newUserId)
        await supabase.auth.admin.deleteUser(newUserId)
        return response({ error: roleInsertError.message }, 500)
      }
    }

    const { error: auditError } = await supabase.from('audit_logs').insert({
      business_id: businessId,
      actor_id: actorId,
      entity_type: 'user',
      entity_id: newUserId,
      action: 'created',
      old_value: null,
      new_value: { global_role: 'admin', name, email, phone, branch_ids: branchIds },
    })
    if (auditError) {
      await supabase.from('user_branch_roles').delete().eq('business_id', businessId).eq('user_id', newUserId)
      await supabase.from('users').delete().eq('business_id', businessId).eq('id', newUserId)
      await supabase.auth.admin.deleteUser(newUserId)
      return response({ error: auditError.message }, 500)
    }
    return response({ success: true })
  }

  if (validation.data.action === 'update_branches') {
    const { userId, branchIds } = validation.data
    if (new Set(branchIds).size !== branchIds.length) {
      return response({ error: 'Remove duplicate branch selections.' }, 400)
    }
    const [targetResult, rolesResult, usersResult] = await Promise.all([
      supabase.from('users').select('id, global_role').eq('business_id', businessId)
        .eq('id', userId).is('deleted_at', null).maybeSingle(),
      supabase.from('user_branch_roles').select('user_id, branch_id, is_active').eq('business_id', businessId),
      supabase.from('users').select('id, global_role, is_active, deleted_at').eq('business_id', businessId),
    ])
    if (targetResult.error || rolesResult.error || usersResult.error) {
      return response({ error: 'Unable to verify the admin and branch assignments.' }, 500)
    }
    if (!targetResult.data || targetResult.data.global_role !== 'admin') {
      return response({ error: 'The selected administrator was not found.' }, 404)
    }
    let branches: Array<{ id: string; is_active: boolean }> = []
    if (branchIds.length > 0) {
      const { data, error } = await supabase.from('branches').select('id, is_active')
        .eq('business_id', businessId)
        .is('deleted_at', null).in('id', branchIds)
      if (error) return response({ error: 'Unable to verify the selected branches.' }, 500)
      branches = (data ?? []) as Array<{ id: string; is_active: boolean }>
      if (branches.length !== branchIds.length) {
        return response({ error: 'One or more selected branches are unavailable.' }, 400)
      }
    }

    const users = (usersResult.data ?? []) as AssignmentUser[]
    const userMap = new Map(users.map((user) => [user.id, user]))
    const roles = (rolesResult.data ?? []) as AssignmentRole[]
    const occupied = new Set(
      roles.filter((role) => {
        const assignedUser = userMap.get(role.user_id)
        return role.user_id !== userId &&
          role.is_active !== false &&
          assignedUser?.global_role === 'admin' &&
          assignedUser.is_active !== false &&
          assignedUser.deleted_at == null
      }).map((role) => role.branch_id),
    )
    if (branchIds.some((branchId) => occupied.has(branchId))) {
      return response({ error: 'One or more selected branches already has an active admin.' }, 409)
    }

    const oldBranchIds = roles.filter((role) => role.user_id === userId).map((role) => role.branch_id)
    const toAdd = branchIds.filter((branchId) => !oldBranchIds.includes(branchId))
    const toRemove = oldBranchIds.filter((branchId) => !branchIds.includes(branchId))
    if (toAdd.some((branchId) => !branches.some(
      (branch) => branch.id === branchId && branch.is_active === true,
    ))) {
      return response({ error: 'New assignments can only be made to active branches.' }, 400)
    }
    if (toAdd.length > 0) {
      const { error } = await supabase.from('user_branch_roles').insert(
        toAdd.map((branchId) => ({
          user_id: userId, branch_id: branchId, business_id: businessId,
          role: 'admin', assigned_by: actorId,
        })),
      )
      if (error) return response({ error: error.message }, 500)
    }
    if (toRemove.length > 0) {
      const { error } = await supabase.from('user_branch_roles').delete()
        .eq('business_id', businessId).eq('user_id', userId).in('branch_id', toRemove)
      if (error) return response({ error: error.message }, 500)
    }
    const { error: auditError } = await supabase.from('audit_logs').insert({
      business_id: businessId,
      actor_id: actorId,
      entity_type: 'user_branch_roles',
      entity_id: userId,
      action: 'updated',
      old_value: { branch_ids: oldBranchIds },
      new_value: { branch_ids: branchIds },
    })
    if (auditError) return response({ error: auditError.message }, 500)
    return response({ success: true })
  }

  const { userId, isActive } = validation.data
  const { data: target, error: targetError } = await supabase
    .from('users')
    .select('id, name, global_role, is_active, deleted_at')
    .eq('business_id', businessId)
    .eq('id', userId)
    .maybeSingle()
  if (targetError) return response({ error: targetError.message }, 500)
  if (!target || target.global_role !== 'admin' || target.deleted_at !== null) {
    return response({ error: 'The selected administrator was not found.' }, 404)
  }
  if (target.is_active === isActive) {
    return response({ error: `${target.name} is already ${isActive ? 'active' : 'inactive'}.` }, 409)
  }

  const timestamp = new Date().toISOString()
  const { error: userUpdateError } = await supabase.from('users')
    .update({ is_active: isActive }).eq('business_id', businessId).eq('id', userId)
  if (userUpdateError) return response({ error: userUpdateError.message }, 500)
  const { error: rolesUpdateError } = await supabase.from('user_branch_roles')
    .update({
      is_active: isActive,
      deactivated_at: isActive ? null : timestamp,
      deactivated_by: isActive ? null : actorId,
    })
    .eq('business_id', businessId).eq('user_id', userId).eq('role', 'admin')
  if (rolesUpdateError) {
    await supabase.from('users').update({ is_active: target.is_active })
      .eq('business_id', businessId).eq('id', userId)
    return response({ error: rolesUpdateError.message }, 500)
  }
  const { error: auditError } = await supabase.from('audit_logs').insert({
    business_id: businessId,
    actor_id: actorId,
    entity_type: 'user',
    entity_id: userId,
    action: isActive ? 'activated' : 'deactivated',
    old_value: { is_active: target.is_active },
    new_value: { is_active: isActive },
  })
  if (auditError) return response({ error: auditError.message }, 500)
  return response({ success: true })
}

async function readRequest(request: Request): Promise<unknown | null> {
  const contentLength = Number(request.headers.get('content-length') ?? 0)
  if (contentLength > 32_768) return null
  const reader = request.body?.getReader()
  if (!reader) return null
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > 32_768) {
        await reader.cancel()
        return null
      }
      chunks.push(value)
    }
    const body = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      body.set(chunk, offset)
      offset += chunk.byteLength
    }
    return JSON.parse(new TextDecoder().decode(body))
  } catch {
    return null
  } finally {
    reader.releaseLock()
  }
}

function response(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  })
}
