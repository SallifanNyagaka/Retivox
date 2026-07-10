'use client'
/**
 * Applies per-user dashboard theme preferences.
 *
 * Theme state is intentionally keyed by user ID so owners, admins, and
 * employees using the same browser do not overwrite each other's dashboard
 * appearance.
 */

import { useEffect, type ReactNode } from 'react'

/**
 * Props for the dashboard theme provider.
 */
type Props = {
  userId: string
  children: ReactNode
}

/**
 * Builds the localStorage key for one user's dashboard theme.
 */
export function getDashboardThemeKey(userId: string) {
  return `retivox:theme:${userId}`
}

/**
 * Applies a user theme value to the document root.
 */
export function applyDashboardTheme(theme: string | null) {
  document.documentElement.classList.toggle('dark', theme === 'dark')
}

/**
 * Client provider that applies the current user's persisted dashboard theme.
 */
export default function DashboardThemeProvider({ userId, children }: Props) {
  useEffect(() => {
    const userTheme = window.localStorage.getItem(getDashboardThemeKey(userId))
    applyDashboardTheme(userTheme)
  }, [userId])

  return <>{children}</>
}
