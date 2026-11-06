import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createServiceRoleClient } from '../../../../lib/supabase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const deleteSchema = z.object({
  action: z.literal('delete'),
  branchId: z.string().uuid(),
  confirmationName: z.string().trim().min(1).max(100),
  reason: z.string().trim().max(240).optional().transform((value) => value || undefined),
})

type OwnerProfile = {
  id: string
  business_id: string | null
  global_role: string | null
  is_active: boolean | null
  deleted_at: string | null
}

type RelatedUser = {
  id: string
  global_role: string
  is_active: boolean
  deleted_at: string | null
}

type BranchRole = {
  id: string
  user_id: string
  role: string
  is_active: boolean | null
  users: RelatedUser | RelatedUser[] | null
}

export async function POST(request: Request) {
  const parsedBody = await readBody(request)
  const validation = deleteSchema.safeParse(parsedBody)
  if (!validation.success) {
    return json({ error: validation.error.issues[0]?.message ?? 'Invalid branch deletion request.' }, 400)
  }

  const authorization = request.headers.get('authorization') ?? ''
  const token = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length).trim()
    : ''
  if (!token || token.length > 8192) {
    return json({ error: 'Sign in again before deleting a branch.' }, 401)
  }

  let supabase: ReturnType<typeof createServiceRoleClient>
  try {
    supabase = createServiceRoleClient()
  } catch {
    return json({ error: 'Branch management services are not configured.' }, 503)
  }
  const { data: authData, error: authError } = await supabase.auth.getUser(token)
  if (authError || !authData.user) {
    return json({ error: 'Your online session is invalid or expired.' }, 401)
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
    return json({ error: 'Only an active business owner can delete a branch.' }, 403)
  }
  const businessId = profile.business_id
  if (!businessId) return json({ error: 'Business context is missing.' }, 403)

  const branchId = validation.data.branchId
  const [branchResult, rolesResult, stockResult, recoveryResult, damageResult] =
    await Promise.all([
      supabase.from('branches')
        .select('id, name, is_active, deleted_at')
        .eq('business_id', businessId)
        .eq('id', branchId)
        .maybeSingle(),
      supabase.from('user_branch_roles')
        .select('id, user_id, role, is_active, users!user_branch_roles_user_id_fkey(id, global_role, is_active, deleted_at)')
        .eq('business_id', businessId)
        .eq('branch_id', branchId),
      supabase.from('branch_stock')
        .select('id, quantity_on_hand, quantity_reserved, base_quantity_on_hand, base_quantity_reserved')
        .eq('business_id', businessId)
        .eq('branch_id', branchId),
      supabase.from('inventory_recovery_items')
        .select('id')
        .eq('business_id', businessId)
        .eq('branch_id', branchId)
        .gt('remaining_base_quantity', 0),
      supabase.from('employee_inventory_loss_reports')
        .select('id')
        .eq('business_id', businessId)
        .eq('branch_id', branchId)
        .eq('status', 'pending'),
    ])
  const lookupError = branchResult.error ?? rolesResult.error ?? stockResult.error ??
    recoveryResult.error ?? damageResult.error
  if (lookupError) return json({ error: 'Unable to verify branch data for deletion.' }, 500)

  const branch = branchResult.data
  if (!branch) return json({ error: 'Branch not found.' }, 404)
  if (branch.deleted_at) return json({ error: `${branch.name} is already deleted.` }, 409)
  if (validation.data.confirmationName !== branch.name) {
    return json({ error: `Type ${branch.name} exactly to delete this branch.` }, 400)
  }

  const roleRows = (rolesResult.data ?? []) as BranchRole[]
  const liveAssignedUsers = roleRows.filter((role) => {
    const user = Array.isArray(role.users) ? role.users[0] : role.users
    return role.is_active !== false &&
      user?.deleted_at === null &&
      user?.is_active === true &&
      (user.global_role === 'admin' || user.global_role === 'employee')
  })
  const affectedUserIds = Array.from(new Set(liveAssignedUsers.map((role) => role.user_id)))
  let orphanedUserIds: string[] = []
  if (affectedUserIds.length > 0) {
    const { data: remainingRoles, error } = await supabase.from('user_branch_roles')
      .select('user_id, branches!inner(deleted_at)')
      .eq('business_id', businessId)
      .in('user_id', affectedUserIds)
      .neq('branch_id', branchId)
      .eq('is_active', true)
      .is('branches.deleted_at', null)
    if (error) return json({ error: 'Unable to verify staff assignments in other branches.' }, 500)
    const usersWithOtherBranches = new Set((remainingRoles ?? []).map((role) => role.user_id))
    orphanedUserIds = affectedUserIds.filter((userId) => !usersWithOtherBranches.has(userId))
  }

  const deletedAt = new Date().toISOString()
  const cascadeReason = validation.data.reason || `Deleted with branch: ${branch.name}`
  const { error: branchUpdateError } = await supabase.from('branches')
    .update({
      is_active: false,
      deleted_at: deletedAt,
      deleted_by: profile.id,
      delete_reason: validation.data.reason || null,
    })
    .eq('business_id', businessId)
    .eq('id', branch.id)
  if (branchUpdateError) return json({ error: branchUpdateError.message }, 500)

  const { error: roleUpdateError } = await supabase.from('user_branch_roles')
    .update({
      is_active: false,
      deactivated_at: deletedAt,
      deactivated_by: profile.id,
    })
    .eq('business_id', businessId)
    .eq('branch_id', branch.id)
  if (roleUpdateError) {
    return json({ error: 'Branch deleted, but branch assignment cleanup failed.' }, 500)
  }

  if (orphanedUserIds.length > 0) {
    const { error } = await supabase.from('users')
      .update({
        is_active: false,
        deleted_at: deletedAt,
        deleted_by: profile.id,
        delete_reason: cascadeReason,
      })
      .eq('business_id', businessId)
      .in('id', orphanedUserIds)
      .in('global_role', ['admin', 'employee'])
    if (error) return json({ error: 'Branch deleted, but orphaned staff cleanup failed.' }, 500)
  }

  const { error: stockCleanupError } = await supabase.from('branch_stock')
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
    return json({ error: 'Branch deleted, but live stock cleanup failed.' }, 500)
  }

  const { error: recoveryCleanupError } = await supabase.from('inventory_recovery_items')
    .update({ remaining_base_quantity: 0 })
    .eq('business_id', businessId)
    .eq('branch_id', branch.id)
  if (recoveryCleanupError) {
    return json({ error: 'Branch deleted, but recovery stock cleanup failed.' }, 500)
  }

  const { error: damageCleanupError } = await supabase.from('employee_inventory_loss_reports')
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
    return json({ error: 'Branch deleted, but pending damage reports could not be closed.' }, 500)
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
      stock_rows_cleared: stockResult.data?.length ?? 0,
      recovery_rows_cleared: recoveryResult.data?.length ?? 0,
      pending_damage_reports_closed: damageResult.data?.length ?? 0,
    },
  })
  if (auditError) return json({ error: 'Branch deleted, but the audit log could not be written.' }, 500)
  return json({ success: true })
}

async function readBody(request: Request): Promise<unknown | null> {
  const contentLength = Number(request.headers.get('content-length') ?? 0)
  if (contentLength > 16_384) return null
  const reader = request.body?.getReader()
  if (!reader) return null
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > 16_384) {
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

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  })
}
