/**
 * Employee branch-assignment helpers for Retivox mobile.
 *
 * Employee screens need a current branch before loading scoped stock,
 * transactions, POS products, or damage-report products.
 */

import { loadCurrentUserProfile } from '../supabase/auth'
import { getConnectivityState } from '../network/connectivity'
import type { UserProfile } from '../../store/authStore'

/**
 * Returns the current employee profile with a branch assignment, refreshing if needed.
 *
 * @param user - Current auth-store profile.
 * @param setUser - Auth-store setter used when a fresh profile is loaded.
 * @returns Profile with a non-empty branch id.
 */
export async function resolveEmployeeBranchAssignment(
  user: UserProfile | null,
  setUser: (user: UserProfile | null) => void,
): Promise<UserProfile & { branchId: string }> {
  const connectivity = await getConnectivityState().catch(() => ({ isOnline: false, connectionType: null }))

  // Branch transfers happen on the web as well. When the device is online,
  // always refresh this small profile record before querying scoped stock so
  // the app never keeps using an employee's former store.
  if (connectivity.isOnline) {
    const refreshedUser = await loadCurrentUserProfile()
    setUser(refreshedUser)

    if (!refreshedUser?.branchId) {
      throw new Error('Your branch assignment is missing. Ask your manager to confirm your store is active, then retry.')
    }

    return refreshedUser as UserProfile & { branchId: string }
  }

  if (user?.branchId) {
    return user as UserProfile & { branchId: string }
  }

  const refreshedUser = await loadCurrentUserProfile()
  setUser(refreshedUser)

  if (!refreshedUser?.branchId) {
    throw new Error('Your branch assignment is missing. Ask your manager to confirm your store is active, then retry.')
  }

  return refreshedUser as UserProfile & { branchId: string }
}
