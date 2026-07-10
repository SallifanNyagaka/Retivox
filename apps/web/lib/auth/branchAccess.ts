/**
 * Shared branch-scoped authorization helpers for Retivox.
 *
 * These server-only helpers centralize the contextual role model used by
 * owner, admin, and employee dashboards. Branch permissions must be resolved
 * through this file instead of checking a user's global role inside pages.
 */

import { cache } from 'react'
import { GlobalRole } from '@smartretail/shared'
import { createClient } from '../supabase/server'
import logger from '../logger'

/**
 * Branch-scoped roles in descending permission order.
 */
export type BranchRole = 'owner' | 'admin' | 'employee'

/**
 * Branch role row returned by the shared access helpers and SQL RPCs.
 */
export type UserBranchRole = {
  branch_id: string
  role: BranchRole
}

/**
 * Supabase/PostgREST error shape used by these helpers.
 */
type SupabaseAccessError = {
  message?: string
  code?: string
  details?: string | null
  hint?: string | null
}

/**
 * Minimal Supabase RPC response shape used to avoid leaking `any` types.
 */
type RpcResponse<Data> = {
  data: Data | null
  error: SupabaseAccessError | null
}

/**
 * Minimal user access profile used by branch authorization fallbacks.
 */
type AccessProfileRow = {
  id: string
  business_id: string | null
  global_role: GlobalRole | null
  is_active: boolean | null
}

/**
 * Minimal branch row used when expanding a global owner to all branches.
 */
type BranchIdRow = {
  id: string
}

/**
 * Error thrown when a user lacks the requested branch permission.
 */
export class BranchAccessDeniedError extends Error {
  /**
   * HTTP-style status code for route handlers or server actions that surface it.
   */
  readonly statusCode = 403

  /**
   * Creates a structured branch access error.
   */
  constructor(
    readonly userId: string,
    readonly branchId: string,
    readonly minRole: BranchRole,
    readonly effectiveRole: BranchRole | null
  ) {
    super('Branch access denied')
    this.name = 'BranchAccessDeniedError'
  }
}

/**
 * Numeric role ranks used for in-process comparisons.
 */
const ROLE_RANK: Record<BranchRole, number> = {
  employee: 1,
  admin: 2,
  owner: 3,
}

/**
 * Checks whether an unknown value is an object record.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Checks whether a value is one of the branch role literals.
 */
function isBranchRole(value: unknown): value is BranchRole {
  return value === 'owner' || value === 'admin' || value === 'employee'
}

/**
 * Checks whether an unknown RPC row is a valid branch-role row.
 */
function isUserBranchRole(value: unknown): value is UserBranchRole {
  return isRecord(value) && typeof value.branch_id === 'string' && isBranchRole(value.role)
}

/**
 * Loads the current authorization profile for owner fallback checks.
 */
async function getAccessProfile(userId: string): Promise<AccessProfileRow | null> {
  const supabase = await createClient()

  try {
    const { data, error } = (await supabase
      .from('users')
      .select('id, business_id, global_role, is_active')
      .eq('id', userId)
      .maybeSingle()) as {
      data: AccessProfileRow | null
      error: SupabaseAccessError | null
    }

    if (error) {
      logger.error('getAccessProfile failed', { userId, error })
      throw new Error(error.message ?? 'Unable to resolve user access profile')
    }

    return data
  } catch (error: unknown) {
    logger.error('getAccessProfile unexpected failure', { userId, error })
    throw error
  }
}

/**
 * Expands a global owner to every branch in their business.
 *
 * This mirrors the SQL RPC behavior and acts as a defensive fallback so owners
 * never lose business-wide oversight if explicit branch role rows are absent.
 */
async function getImplicitOwnerBranchRoles(userId: string): Promise<UserBranchRole[]> {
  const profile = await getAccessProfile(userId)

  if (
    !profile ||
    profile.is_active === false ||
    profile.global_role !== GlobalRole.Owner ||
    profile.business_id === null
  ) {
    return []
  }

  const supabase = await createClient()

  try {
    const { data, error } = (await supabase
      .from('branches')
      .select('id')
      .eq('business_id', profile.business_id)
      .order('id', { ascending: true })) as {
      data: BranchIdRow[] | null
      error: SupabaseAccessError | null
    }

    if (error) {
      logger.error('getImplicitOwnerBranchRoles failed', {
        userId,
        businessId: profile.business_id,
        error,
      })
      throw new Error(error.message ?? 'Unable to resolve owner branch access')
    }

    return (data ?? []).map((branch) => ({
      branch_id: branch.id,
      role: 'owner',
    }))
  } catch (error: unknown) {
    logger.error('getImplicitOwnerBranchRoles unexpected failure', { userId, error })
    throw error
  }
}

/**
 * Returns true when `role` satisfies the requested minimum role.
 */
export function hasMinimumBranchRole(role: BranchRole | null, minRole: BranchRole) {
  return role !== null && ROLE_RANK[role] >= ROLE_RANK[minRole]
}

/**
 * Loads every branch role for a user, including implicit owner expansion.
 *
 * Owners are expanded by the SQL RPC to an `owner` role on every branch in
 * their business. Non-owner users receive their explicit branch assignments.
 */
export const getUserBranchRoles = cache(async function getUserBranchRoles(userId: string): Promise<UserBranchRole[]> {
  const supabase = await createClient()
  const response = (await supabase.rpc('get_user_branch_roles', {
    p_user_id: userId,
  })) as RpcResponse<unknown>

  if (response.error) {
    logger.error('getUserBranchRoles failed', { userId, error: response.error })
    throw new Error(response.error.message ?? 'Unable to resolve branch roles')
  }

  if (!Array.isArray(response.data)) {
    return getImplicitOwnerBranchRoles(userId)
  }

  const roles = response.data.filter(isUserBranchRole)

  if (roles.length > 0) {
    return roles
  }

  return getImplicitOwnerBranchRoles(userId)
})

/**
 * Resolves the highest effective role a user holds for one branch.
 */
export async function getEffectiveRole(userId: string, branchId: string): Promise<BranchRole | null> {
  const roles = await getUserBranchRoles(userId)
  const matchingRole = roles.find((role) => role.branch_id === branchId)

  return matchingRole?.role ?? null
}

/**
 * Returns all branch IDs where the user's effective role meets `minRole`.
 */
export async function getAccessibleBranchIds(userId: string, minRole: BranchRole): Promise<string[]> {
  const roles = await getUserBranchRoles(userId)

  return roles.filter((role) => hasMinimumBranchRole(role.role, minRole)).map((role) => role.branch_id)
}

/**
 * Logs a denied branch-access attempt for later security review.
 */
async function logBranchAccessDenied(
  userId: string,
  branchId: string,
  minRole: BranchRole,
  effectiveRole: BranchRole | null,
  attemptedAction: string
) {
  const supabase = await createClient()
  const response = (await supabase.rpc('log_branch_access_denial', {
    p_user_id: userId,
    p_branch_id: branchId,
    p_min_role: minRole,
    p_effective_role: effectiveRole,
    p_attempted_action: attemptedAction,
  })) as RpcResponse<unknown>

  if (response.error) {
    logger.error('Failed to persist branch access denial', {
      userId,
      branchId,
      minRole,
      effectiveRole,
      attemptedAction,
      error: response.error,
    })
  }

  logger.warn('Branch access denied', {
    userId,
    branchId,
    minRole,
    effectiveRole,
    attemptedAction,
  })
}

/**
 * Enforces branch access before branch-scoped work runs.
 *
 * Call this at the start of server actions and data fetchers. The optional
 * `attemptedAction` is stored with denied attempts for security review.
 */
export async function assertBranchAccess(
  userId: string,
  branchId: string,
  minRole: BranchRole,
  attemptedAction = 'branch_access'
): Promise<BranchRole> {
  const effectiveRole = await getEffectiveRole(userId, branchId)

  if (effectiveRole !== null && hasMinimumBranchRole(effectiveRole, minRole)) {
    return effectiveRole
  }

  await logBranchAccessDenied(userId, branchId, minRole, effectiveRole, attemptedAction)
  throw new BranchAccessDeniedError(userId, branchId, minRole, effectiveRole)
}
