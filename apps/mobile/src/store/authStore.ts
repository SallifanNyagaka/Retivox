/**
 * Zustand auth store for Retivox mobile.
 *
 * Holds the current Supabase session and normalized user profile used by
 * navigation and screen-level access decisions.
 */

import type { Session } from '@supabase/supabase-js'
import type { GlobalRole, User } from '@smartretail/shared'
import { create } from 'zustand'

export type UserProfile = User & {
  branchId: string | null
  branchName: string | null
}

export type AuthState = {
  user: UserProfile | null
  session: Session | null
  isLoading: boolean
  setUser: (user: UserProfile | null) => void
  setSession: (session: Session | null) => void
  setLoading: (isLoading: boolean) => void
  clearAuth: () => void
}

/**
 * Creates the mobile auth store.
 *
 * @returns Zustand auth state.
 */
export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  session: null,
  isLoading: true,
  setUser: (user) => set({ user }),
  setSession: (session) => set({ session }),
  setLoading: (isLoading) => set({ isLoading }),
  clearAuth: () => set({ user: null, session: null, isLoading: false }),
}))

/**
 * Checks whether a role belongs to a logged-in dashboard user.
 *
 * @param role - Potential global role.
 * @returns True if the role is supported.
 */
export function isSupportedRole(role: GlobalRole | null | undefined): role is GlobalRole {
  return role === 'owner' || role === 'admin' || role === 'employee'
}
