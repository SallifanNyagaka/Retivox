/**
 * Auth hook for Retivox mobile screens and navigators.
 *
 * Provides current user/session state and sign-in/sign-out actions backed by
 * the Supabase auth helpers and Zustand auth store.
 */

import { useCallback } from 'react'
import { getSession, loadCachedOfflineProfile, loadCurrentUserProfile, signIn, signOut } from '../lib/supabase/auth'
import { handleError } from '../utils/errorHandler'
import { useAuthStore } from '../store/authStore'

/**
 * Exposes auth state and actions.
 *
 * @returns Auth state and actions.
 */
export function useAuth() {
  const { user, session, isLoading, setUser, setSession, setLoading, clearAuth } = useAuthStore()

  const bootstrap = useCallback(async () => {
    setLoading(true)

    try {
      const existingSession = await getSession()
      setSession(existingSession)

      if (!existingSession) {
        // A device can have a valid cached profile even when Supabase cannot
        // restore a session without internet. Promote it into the auth store
        // so the role navigator and offline screens are available immediately.
        setUser(await loadCachedOfflineProfile())
        return
      }

      const profile = await loadCurrentUserProfile()
      setUser(profile)
    } catch (error) {
      handleError('useAuth.bootstrap', error)
      clearAuth()
    } finally {
      setLoading(false)
    }
  }, [clearAuth, setLoading, setSession, setUser])

  const login = useCallback(
    async (email: string, password: string) => {
      setLoading(true)

      try {
        const result = await signIn(email, password)
        setSession(result.session)
        setUser(result.user)
      } finally {
        setLoading(false)
      }
    },
    [setLoading, setSession, setUser],
  )

  const logout = useCallback(async () => {
    clearAuth()

    void signOut().catch((error) => {
      handleError('useAuth.logout', error)
    })
  }, [clearAuth])

  return {
    user,
    session,
    isLoading,
    bootstrap,
    login,
    logout,
  }
}
