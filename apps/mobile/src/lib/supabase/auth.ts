/**
 * Authentication helpers for Retivox mobile.
 *
 * Wraps Supabase auth with profile loading, role normalization, session expiry
 * policy, device-session recording, and shared-device-safe sign-out cleanup.
 */

import AsyncStorage from '@react-native-async-storage/async-storage'
import type { Session } from '@supabase/supabase-js'
import { GlobalRole, loginSchema } from '@smartretail/shared'
import { supabase, clearSupabaseStorage } from './client'
import { handleError } from '../../utils/errorHandler'
import type { UserProfile } from '../../store/authStore'

type UserRow = {
  id: string
  business_id: string
  name: string
  email: string
  phone: string | null
  global_role: GlobalRole | null
  is_active: boolean
  last_login_at: string | null
  created_at: string
}

type EmployeeBranchRow = {
  branch_id: string | null
  branch_name: string | null
}

type EmployeeProfileRow = EmployeeBranchRow & {
  id: string
}

export type SignInResult = {
  session: Session
  user: UserProfile
}

/**
 * Converts a database user row into the mobile profile shape.
 *
 * @param row - User row from Supabase.
 * @param branch - Optional branch assignment row.
 * @returns Normalized user profile.
 */
function normalizeUserProfile(row: UserRow, branch: EmployeeBranchRow | null): UserProfile {
  if (!row.global_role) {
    throw new Error('Account role is missing.')
  }

  return {
    id: row.id,
    businessId: row.business_id,
    name: row.name,
    email: row.email,
    phone: row.phone ?? '',
    globalRole: row.global_role,
    isActive: row.is_active,
    lastLoginAt: row.last_login_at ?? '',
    createdAt: row.created_at,
    branchId: branch?.branch_id ?? null,
    branchName: branch?.branch_name ?? null,
  }
}

/**
 * Loads the current authenticated user's profile.
 *
 * @returns User profile or null when no valid user exists.
 */
export async function loadCurrentUserProfile(): Promise<UserProfile | null> {
  const { data: userData, error: authError } = await supabase.auth.getUser()

  if (authError || !userData.user) {
    return null
  }

  const { data: profileData, error: profileError } = await supabase
    .from('users')
    .select('id, business_id, name, email, phone, global_role, is_active, last_login_at, created_at')
    .eq('id', userData.user.id)
    .maybeSingle()

  if (profileError || !profileData) {
    throw profileError ?? new Error('User profile not found.')
  }

  const profileRow = profileData as UserRow

  if (!profileRow.is_active) {
    await signOut()
    throw new Error('Your account has been deactivated. Please contact your manager.')
  }

  const branchRow = profileRow.global_role === GlobalRole.Employee ? await loadEmployeeBranch(profileRow.id) : null

  return normalizeUserProfile(profileRow, branchRow)
}

/**
 * Loads the employee's current single active branch from the same RPC used by web.
 *
 * @param userId - Authenticated employee id.
 * @returns Branch row or null when no current branch is assigned.
 */
async function loadEmployeeBranch(userId: string): Promise<EmployeeBranchRow | null> {
  const { data, error } = await supabase.rpc('get_employee_profile', { p_user_id: userId })

  if (error) {
    throw new Error('Unable to load your branch assignment. Please try again.')
  }

  const profileRow = getFirstEmployeeProfileRow(data)

  if (!profileRow) {
    return null
  }

  return {
    branch_id: profileRow.branch_id,
    branch_name: profileRow.branch_name,
  }
}

/**
 * Reads the stored Supabase session.
 *
 * @returns Supabase session or null.
 */
export async function getSession(): Promise<Session | null> {
  const { data, error } = await supabase.auth.getSession()

  if (error) {
    return null
  }

  return data.session
}

/**
 * Signs in and loads the corresponding Retivox profile.
 *
 * @param email - User email.
 * @param password - User password.
 * @returns Supabase session and normalized user profile.
 */
export async function signIn(email: string, password: string): Promise<SignInResult> {
  const validation = loginSchema.safeParse({ email, password })

  if (!validation.success) {
    throw new Error(validation.error.errors[0]?.message ?? 'Invalid login details.')
  }

  const { data, error } = await supabase.auth.signInWithPassword(validation.data)

  if (error || !data.session) {
    throw new Error('Invalid email or password.')
  }

  const profile = await loadCurrentUserProfile()

  if (!profile) {
    throw new Error('Account profile could not be loaded.')
  }

  await recordDeviceSession(profile.id)

  return {
    session: data.session,
    user: profile,
  }
}

/**
 * Signs out and clears all local data for shared-device safety.
 *
 * @returns Promise that resolves when local state is cleared.
 */
export async function signOut(): Promise<void> {
  try {
    await supabase.auth.signOut()
  } catch (error) {
    handleError('signOut.auth', error)
  }

  await clearSupabaseStorage()
  await AsyncStorage.clear()

  try {
    const { database } = await import('../watermelon/database')
    await database.write(async () => {
      await database.unsafeResetDatabase()
    })
  } catch (error) {
    handleError('signOut.clearWatermelon', error)
  }
}

/**
 * Records a mobile device session after login.
 *
 * @param userId - Authenticated user id.
 * @returns Promise that resolves after best-effort insert.
 */
async function recordDeviceSession(userId: string): Promise<void> {
  const deviceFingerprint = `expo-${userId.slice(0, 8)}`

  try {
    await supabase.from('device_sessions').insert({
      user_id: userId,
      device_fingerprint: deviceFingerprint,
      platform: 'expo',
      app_version: '1.0.0',
      last_seen_at: new Date().toISOString(),
    })
  } catch (error) {
    handleError('recordDeviceSession', error)
  }
}

/**
 * Checks whether an unknown RPC response is an employee branch row.
 *
 * @param value - Unknown RPC response.
 * @returns True when the value has branch fields.
 */
function isEmployeeBranchRow(value: unknown): value is EmployeeBranchRow {
  if (!value || typeof value !== 'object') {
    return false
  }

  return (
    ('branch_id' in value || 'branch_name' in value)
  )
}

/**
 * Normalizes Supabase RPC table responses, which can arrive as an array.
 *
 * @param value - Unknown RPC response.
 * @returns First employee profile row or null.
 */
function getFirstEmployeeProfileRow(value: unknown): EmployeeProfileRow | null {
  const row = Array.isArray(value) ? value[0] : value

  if (!isEmployeeBranchRow(row) || !('id' in row)) {
    return null
  }

  return row as EmployeeProfileRow
}
