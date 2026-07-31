/**
 * Authentication helpers for Retivox mobile.
 *
 * Wraps Supabase auth with profile loading, role normalization, session expiry
 * policy, device-session recording, and shared-device-safe sign-out cleanup.
 */

import type { Session } from '@supabase/supabase-js'
import * as SecureStore from 'expo-secure-store'
import { GlobalRole, loginSchema } from '@smartretail/shared'
import { supabase, clearSupabaseStorage } from './client'
import { getConnectivityState } from '../network/connectivity'
import { handleError } from '../../utils/errorHandler'
import { withTimeout } from '../../utils/asyncTimeout'
import type { UserProfile } from '../../store/authStore'

const OFFLINE_AUTH_CACHE_KEY = 'retivox:offline-auth-cache'

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
  session: Session | null
  user: UserProfile
}

type OfflineAuthCache = {
  email: string
  // Older app versions stored this value. New versions intentionally do not;
  // Supabase persists its encrypted session in SecureStore instead.
  password?: string
  profile: UserProfile
  updatedAt: string
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
  let userData: Awaited<ReturnType<typeof supabase.auth.getUser>>['data']
  let authError: Awaited<ReturnType<typeof supabase.auth.getUser>>['error']

  try {
    const result = await withTimeout(supabase.auth.getUser(), 6000, 'Profile request timed out.')
    userData = result.data
    authError = result.error
  } catch {
    return loadCachedOfflineProfile()
  }

  if (authError || !userData.user) {
    const connectivity = await getSafeConnectivityState()
    return connectivity.isOnline ? null : loadCachedOfflineProfile()
  }

  let profileData: unknown
  let profileError: unknown

  try {
    const result = await withTimeout(
      Promise.resolve(
        supabase
          .from('users')
          .select('id, business_id, name, email, phone, global_role, is_active, last_login_at, created_at')
          .eq('id', userData.user.id)
          .maybeSingle(),
      ),
      6000,
      'Profile request timed out.',
    )
    profileData = result.data
    profileError = result.error
  } catch {
    return loadCachedOfflineProfile()
  }

  if (profileError || !profileData) {
    if (!(await getSafeConnectivityState()).isOnline) {
      return loadCachedOfflineProfile()
    }
    throw profileError ?? new Error('User profile not found.')
  }

  const profileRow = profileData as UserRow

  if (!profileRow.is_active) {
    await signOut()
    throw new Error('Your account has been deactivated. Please contact your manager.')
  }

  let branchRow: EmployeeBranchRow | null = null
  if (profileRow.global_role === GlobalRole.Employee) {
    try {
      branchRow = await loadEmployeeBranch(profileRow.id)
    } catch (error) {
      if (!(await getSafeConnectivityState()).isOnline) {
        return loadCachedOfflineProfile()
      }
      throw error
    }
  }

  const profile = normalizeUserProfile(profileRow, branchRow)
  await updateCachedOfflineProfile(profile)

  return profile
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
  try {
    const { data, error } = await withTimeout(supabase.auth.getSession(), 4000, 'Session request timed out.')

    if (error) return null

    return data.session
  } catch {
    return null
  }
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

  const normalizedEmail = validation.data.email.trim().toLowerCase()
  const connectivity = await getSafeConnectivityState()

  if (!connectivity.isOnline) {
    const cachedUser = await authenticateOffline(normalizedEmail, validation.data.password)

    return {
      session: null,
      user: cachedUser,
    }
  }

  let data: Awaited<ReturnType<typeof supabase.auth.signInWithPassword>>['data']
  let error: Awaited<ReturnType<typeof supabase.auth.signInWithPassword>>['error']

  try {
    const result = await withTimeout(
      supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password: validation.data.password,
      }),
      10000,
      'Login request timed out.',
    )
    data = result.data
    error = result.error
  } catch (caughtError) {
    if (isLikelyNetworkError(caughtError) || !(await getSafeConnectivityState()).isOnline) {
      const cachedUser = await authenticateOffline(normalizedEmail, validation.data.password)
      return { session: null, user: cachedUser }
    }

    throw caughtError
  }

  if (error || !data.session) {
    if (isLikelyNetworkError(error) || !(await getSafeConnectivityState()).isOnline) {
      const cachedUser = await authenticateOffline(normalizedEmail, validation.data.password)
      return { session: null, user: cachedUser }
    }

    throw new Error('Invalid email or password.')
  }

  const profile = await loadCurrentUserProfile()

  if (!profile) {
    throw new Error('Account profile could not be loaded.')
  }

  await saveOfflineAuthCache(normalizedEmail, profile)
  await recordDeviceSession(profile.id)

  return {
    session: data.session,
    user: profile,
  }
}

/**
 * Signs out the active session and removes the remembered-account marker.
 *
 * @returns Promise that resolves when local state is cleared.
 */
export async function signOut(): Promise<void> {
  try {
    await withTimeout(supabase.auth.signOut(), 5000, 'Supabase sign-out timed out.')
  } catch (error) {
    handleError('signOut.auth', error)
  }

  try {
    await withTimeout(clearSupabaseStorage(), 3000, 'Session storage cleanup timed out.')
  } catch (error) {
    handleError('signOut.clearSupabaseStorage', error)
  }

  await clearOfflineAuthCache()
}

/**
 * Restores the encrypted Supabase session when the device comes online.
 *
 * @returns A fresh session or null when no cached credentials exist.
 */
export async function restoreCachedSession(): Promise<Session | null> {
  try {
    const { data, error } = await withTimeout(supabase.auth.refreshSession(), 10000, 'Session restore timed out.')
    if (!error && data.session) return data.session
    return getSession()
  } catch {
    return getSession()
  }
}

/**
 * Authenticates against the device-local cache when the shop is offline.
 *
 * @param email - Normalized email.
 * @param password - Entered password.
 * @returns Cached user profile.
 */
async function authenticateOffline(email: string, password: string): Promise<UserProfile> {
  const cache = await loadOfflineAuthCache()

  if (!cache || cache.email !== email || !cache.password || cache.password !== password) {
    throw new Error('You are offline. Connect once with this account on this device before offline login can work.')
  }

  return cache.profile
}

/**
 * Loads only the cached profile for session bootstrap while offline.
 *
 * @returns Cached profile or null.
 */
export async function loadCachedOfflineProfile(): Promise<UserProfile | null> {
  const cache = await loadOfflineAuthCache()
  return cache?.profile ?? null
}

/**
 * Persists the last successful profile in OS-backed secure storage. Supabase
 * stores the encrypted session separately, so no password is retained here.
 *
 * @param email - Normalized email.
 * @param profile - Fresh online profile.
 * @returns Promise resolving after save.
 */
async function saveOfflineAuthCache(email: string, profile: UserProfile): Promise<void> {
  try {
    await SecureStore.setItemAsync(
      OFFLINE_AUTH_CACHE_KEY,
      JSON.stringify({
        email,
        profile,
        updatedAt: new Date().toISOString(),
      } satisfies OfflineAuthCache),
    )
  } catch (error) {
    handleError('saveOfflineAuthCache', error)
  }
}

/**
 * Updates cached profile after online profile refresh.
 *
 * @param profile - Latest online profile.
 * @returns Promise resolving after best-effort save.
 */
async function updateCachedOfflineProfile(profile: UserProfile): Promise<void> {
  const cache = await loadOfflineAuthCache()

  if (!cache) {
    return
  }

  await saveOfflineAuthCache(cache.email, profile)
}

/**
 * Reads the offline auth cache.
 *
 * @returns Cache row or null.
 */
async function loadOfflineAuthCache(): Promise<OfflineAuthCache | null> {
  try {
    const value = await SecureStore.getItemAsync(OFFLINE_AUTH_CACHE_KEY)

    if (!value) {
      return null
    }

    const parsed = JSON.parse(value) as Partial<OfflineAuthCache>

    if (
      typeof parsed.email === 'string' &&
      parsed.profile &&
      typeof parsed.profile.id === 'string'
    ) {
      return parsed as OfflineAuthCache
    }

    return null
  } catch (error) {
    handleError('loadOfflineAuthCache', error)
    return null
  }
}

async function clearOfflineAuthCache(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(OFFLINE_AUTH_CACHE_KEY)
  } catch (error) {
    handleError('clearOfflineAuthCache', error)
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

async function getSafeConnectivityState() {
  try {
    return await withTimeout(getConnectivityState(), 2500, 'Connectivity check timed out.')
  } catch {
    return { isOnline: false, connectionType: null }
  }
}

function isLikelyNetworkError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase()
  return ['network', 'fetch', 'timeout', 'offline', 'connection', 'internet'].some((part) => message.includes(part))
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
