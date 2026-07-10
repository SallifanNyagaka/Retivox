/**
 * Employee-scoped authorization helpers for Retivox.
 *
 * Employee pages and server actions must derive branch scope server-side from
 * these helpers. Client-supplied branch IDs are never trusted for employee
 * workflows because employees are limited to exactly one active branch.
 */

import { cache } from 'react'
import logger from '../logger'
import { createClient } from '../supabase/server'

/**
 * Minimal Supabase error shape used by employee helper RPC calls.
 */
type SupabaseEmployeeError = {
  message?: string
  code?: string
  details?: string | null
  hint?: string | null
}

/**
 * Minimal RPC response shape used to avoid untyped Supabase results.
 */
type RpcResponse<Data> = {
  data: Data | null
  error: SupabaseEmployeeError | null
}

/**
 * Supabase network errors that are safe to retry because no business rule has
 * been rejected; the HTTP request itself failed before a stable response.
 */
const TRANSIENT_SUPABASE_ERROR_MARKERS = [
  'fetch failed',
  'ECONNRESET',
  'ETIMEDOUT',
  'ECONNREFUSED',
  'UND_ERR',
  'socket hang up',
  'terminated',
] as const

/**
 * Maximum attempts for employee auth RPCs during transient network failures.
 */
const EMPLOYEE_RPC_MAX_ATTEMPTS = 3

/**
 * Backoff delays in milliseconds for retrying transient Supabase fetch errors.
 */
const EMPLOYEE_RPC_RETRY_DELAYS_MS = [150, 450] as const

/**
 * Raw profile row returned by the get_employee_profile RPC.
 */
type EmployeeProfileRpcRow = {
  id: string
  name: string
  email: string
  phone: string | null
  business_id: string
  is_active: boolean
  branch_id: string | null
  branch_name: string | null
}

/**
 * Public employee profile used by employee portal pages and actions.
 */
export type EmployeeProfile = {
  id: string
  name: string
  email: string
  phone: string | null
  businessId: string
  isActive: boolean
  branchId: string | null
  branchName: string | null
}

/**
 * Error thrown when an employee has no valid branch scope.
 */
export class EmployeeBranchScopeError extends Error {
  /**
   * HTTP-style status code for callers that map this into responses.
   */
  readonly statusCode = 403

  /**
   * Creates an employee branch scope error.
   */
  constructor(readonly userId: string) {
    super('Employee has no active single-branch assignment')
    this.name = 'EmployeeBranchScopeError'
  }
}

/**
 * Error thrown when an employee attempts to access a different branch.
 */
export class EmployeeAccessDeniedError extends Error {
  /**
   * HTTP-style status code for callers that map this into responses.
   */
  readonly statusCode = 403

  /**
   * Creates an employee access denial error.
   */
  constructor(
    readonly userId: string,
    readonly attemptedBranchId: string,
    readonly expectedBranchId: string | null
  ) {
    super('Employee branch access denied')
    this.name = 'EmployeeAccessDeniedError'
  }
}

/**
 * Checks whether an unknown value is an object record.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Checks whether an unknown value is a nullable string.
 */
function isNullableString(value: unknown): value is string | null {
  return typeof value === 'string' || value === null
}

/**
 * Creates a compact string from unknown error shapes for retry classification.
 */
function getErrorText(error: unknown): string {
  if (typeof error === 'string') {
    return error
  }

  if (error instanceof Error) {
    return `${error.name} ${error.message} ${error.stack ?? ''}`
  }

  if (!isRecord(error)) {
    return ''
  }

  const parts = [
    typeof error.message === 'string' ? error.message : '',
    typeof error.details === 'string' ? error.details : '',
    typeof error.hint === 'string' ? error.hint : '',
    typeof error.code === 'string' ? error.code : '',
    getErrorText(error.cause),
  ]

  return parts.join(' ')
}

/**
 * Identifies transient Supabase fetch failures that should be retried.
 */
function isTransientSupabaseError(error: unknown): boolean {
  const errorText = getErrorText(error)
  return TRANSIENT_SUPABASE_ERROR_MARKERS.some((marker) => errorText.includes(marker))
}

/**
 * Waits before retrying a transient employee auth RPC failure.
 */
function waitForRetry(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs)
  })
}

/**
 * Runs an employee auth RPC with a small retry budget for network resets.
 */
async function runEmployeeRpcWithRetry<Data>(
  label: string,
  userId: string,
  operation: () => Promise<RpcResponse<Data>>
): Promise<RpcResponse<Data>> {
  let lastResponse: RpcResponse<Data> | null = null

  for (let attempt = 1; attempt <= EMPLOYEE_RPC_MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await operation()
      lastResponse = response

      if (!response.error || !isTransientSupabaseError(response.error) || attempt === EMPLOYEE_RPC_MAX_ATTEMPTS) {
        return response
      }

      logger.warn(`${label} transient Supabase failure; retrying`, {
        userId,
        attempt,
        error: response.error,
      })
    } catch (error: unknown) {
      if (!isTransientSupabaseError(error) || attempt === EMPLOYEE_RPC_MAX_ATTEMPTS) {
        throw error
      }

      logger.warn(`${label} transient Supabase exception; retrying`, {
        userId,
        attempt,
        error,
      })
    }

    await waitForRetry(EMPLOYEE_RPC_RETRY_DELAYS_MS[attempt - 1] ?? 450)
  }

  return lastResponse ?? { data: null, error: { message: 'Employee RPC failed before receiving a response' } }
}

/**
 * Converts an RPC profile row into the public employee profile shape.
 */
function normalizeEmployeeProfile(row: unknown): EmployeeProfile | null {
  if (
    !isRecord(row) ||
    typeof row.id !== 'string' ||
    typeof row.name !== 'string' ||
    typeof row.email !== 'string' ||
    !isNullableString(row.phone) ||
    typeof row.business_id !== 'string' ||
    typeof row.is_active !== 'boolean' ||
    !isNullableString(row.branch_id) ||
    !isNullableString(row.branch_name)
  ) {
    return null
  }

  const profileRow: EmployeeProfileRpcRow = {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    business_id: row.business_id,
    is_active: row.is_active,
    branch_id: row.branch_id,
    branch_name: row.branch_name,
  }

  return {
    id: profileRow.id,
    name: profileRow.name,
    email: profileRow.email,
    phone: profileRow.phone,
    businessId: profileRow.business_id,
    isActive: profileRow.is_active,
    branchId: profileRow.branch_id,
    branchName: profileRow.branch_name,
  }
}

/**
 * Returns the employee's single active branch ID, or null if scope is invalid.
 *
 * This is the only source of branch scope for employee workflows.
 */
export const getEmployeeBranchId = cache(async function getEmployeeBranchId(userId: string): Promise<string | null> {
  const supabase = await createClient()

  try {
    const response = await runEmployeeRpcWithRetry('getEmployeeBranchId', userId, async () => {
      return (await supabase.rpc('get_employee_branch_id', {
        p_user_id: userId,
      })) as RpcResponse<string | null>
    })

    if (response.error) {
      logger.error('getEmployeeBranchId failed', { userId, error: response.error })
      throw new Error(response.error.message ?? 'Unable to resolve employee branch')
    }

    return typeof response.data === 'string' ? response.data : null
  } catch (error: unknown) {
    logger.error('getEmployeeBranchId unexpected failure', { userId, error })
    throw error
  }
})

/**
 * Verifies that the employee is currently assigned to the provided branch.
 *
 * The check is intentionally double-gated: TypeScript first compares the
 * derived branch scope, then Postgres performs the authoritative audited check.
 */
export async function assertEmployeeAtBranch(userId: string, branchId: string): Promise<void> {
  const employeeBranchId = await getEmployeeBranchId(userId)
  const supabase = await createClient()

  try {
    const response = await runEmployeeRpcWithRetry('assertEmployeeAtBranch', userId, async () => {
      return (await supabase.rpc('assert_employee_at_branch', {
        p_user_id: userId,
        p_branch_id: branchId,
      })) as RpcResponse<boolean>
    })

    if (response.error) {
      if (isTransientSupabaseError(response.error)) {
        logger.error('assertEmployeeAtBranch failed after retrying transient Supabase error', {
          userId,
          branchId,
          expectedBranchId: employeeBranchId,
          error: response.error,
        })
        throw new Error(response.error.message ?? 'Unable to verify employee branch access')
      }

      logger.warn('assertEmployeeAtBranch denied by database', {
        userId,
        branchId,
        expectedBranchId: employeeBranchId,
        error: response.error,
      })
      throw new EmployeeAccessDeniedError(userId, branchId, employeeBranchId)
    }

    if (employeeBranchId === null || employeeBranchId !== branchId || response.data !== true) {
      logger.warn('assertEmployeeAtBranch denied by derived scope', {
        userId,
        branchId,
        expectedBranchId: employeeBranchId,
      })
      throw new EmployeeAccessDeniedError(userId, branchId, employeeBranchId)
    }
  } catch (error: unknown) {
    if (error instanceof EmployeeAccessDeniedError) {
      throw error
    }

    logger.error('assertEmployeeAtBranch unexpected failure', {
      userId,
      branchId,
      expectedBranchId: employeeBranchId,
      error,
    })
    throw error
  }
}

/**
 * Loads an employee profile and validates the active branch when available.
 */
export const getEmployeeProfile = cache(async function getEmployeeProfile(userId: string): Promise<EmployeeProfile | null> {
  const supabase = await createClient()

  try {
    const response = await runEmployeeRpcWithRetry('getEmployeeProfile', userId, async () => {
      return (await supabase.rpc('get_employee_profile', {
        p_user_id: userId,
      })) as RpcResponse<unknown>
    })

    if (response.error) {
      logger.error('getEmployeeProfile failed', { userId, error: response.error })
      throw new Error(response.error.message ?? 'Unable to load employee profile')
    }

    const firstRow = Array.isArray(response.data) ? response.data[0] : response.data
    const profile = normalizeEmployeeProfile(firstRow)

    if (!profile) {
      return null
    }

    if (profile.isActive && profile.branchId) {
      await assertEmployeeAtBranch(userId, profile.branchId)
    }

    return profile
  } catch (error: unknown) {
    logger.error('getEmployeeProfile unexpected failure', { userId, error })
    throw error
  }
})

/**
 * Returns the employee profile only when an active single-branch scope exists.
 */
export async function requireEmployeeProfile(userId: string): Promise<EmployeeProfile> {
  const profile = await getEmployeeProfile(userId)

  if (!profile || !profile.isActive || !profile.branchId) {
    logger.warn('requireEmployeeProfile denied employee portal access', {
      userId,
      hasProfile: Boolean(profile),
      isActive: profile?.isActive ?? null,
      branchId: profile?.branchId ?? null,
    })
    throw new EmployeeBranchScopeError(userId)
  }

  return profile
}
