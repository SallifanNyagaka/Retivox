'use client'

export type TrustedDashboardRole = 'owner' | 'admin' | 'employee'

export type TrustedDeviceSession = {
  userId: string
  role: TrustedDashboardRole
  dashboardPath: string
  savedAt: string
}

const TRUSTED_DEVICE_KEY = 'retivox-pwa-trusted-device'

const dashboardPathByRole: Record<TrustedDashboardRole, string> = {
  owner: '/dashboard/owner',
  admin: '/dashboard/admin',
  employee: '/dashboard/employee',
}

function isTrustedDashboardRole(value: unknown): value is TrustedDashboardRole {
  return value === 'owner' || value === 'admin' || value === 'employee'
}

/** Returns the local, non-secret account marker for this browser only. */
export function getTrustedDeviceSession(): TrustedDeviceSession | null {
  try {
    const rawValue = window.localStorage.getItem(TRUSTED_DEVICE_KEY)

    if (!rawValue) {
      return null
    }

    const value = JSON.parse(rawValue) as Partial<TrustedDeviceSession>

    if (!value.userId || !isTrustedDashboardRole(value.role) || value.dashboardPath !== dashboardPathByRole[value.role]) {
      return null
    }

    return {
      userId: value.userId,
      role: value.role,
      dashboardPath: value.dashboardPath,
      savedAt: value.savedAt ?? '',
    }
  } catch {
    return null
  }
}

/** Saves a route-only marker after the server has already authenticated a user. */
export function saveTrustedDeviceSession(userId: string, role: TrustedDashboardRole) {
  const session: TrustedDeviceSession = {
    userId,
    role,
    dashboardPath: dashboardPathByRole[role],
    savedAt: new Date().toISOString(),
  }

  window.localStorage.setItem(TRUSTED_DEVICE_KEY, JSON.stringify(session))
}

/** Removes the local marker after logout or when a different account signs in. */
export function clearTrustedDeviceSession() {
  window.localStorage.removeItem(TRUSTED_DEVICE_KEY)
}
