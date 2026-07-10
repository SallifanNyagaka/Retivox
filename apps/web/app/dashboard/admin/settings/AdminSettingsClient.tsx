'use client'
/**
 * Client settings panel for admin dashboard preferences.
 *
 * Admin settings are intentionally user-scoped. Appearance changes are stored
 * under the current admin's user ID and do not alter owner or employee themes.
 */

import { useEffect, useRef } from 'react'
import { Card, CardHeader } from '../../../../components/ui/Card'
import Toast from '../../../../components/ui/Toast'
import { applyDashboardTheme, getDashboardThemeKey } from '../../../../components/dashboard/DashboardThemeProvider'
import { useToast } from '../../../../lib/hooks/useToast'
import { logoutUser } from '../../../../lib/auth/actions'

/**
 * Admin settings profile shown on the page.
 */
type AdminSettingsProfile = {
  id: string
  name: string
  email: string
  phone: string | null
}

/**
 * Props for the admin settings client.
 */
type Props = {
  profile: AdminSettingsProfile
  businessName: string
}

/**
 * Shared input-like card row styling for readonly values.
 */
const readonlyValueStyle = {
  minHeight: 44,
  border: '1px solid var(--color-border)',
  borderRadius: 8,
  padding: '11px 12px',
  boxSizing: 'border-box' as const,
  fontSize: 13,
  color: 'var(--color-text-primary)',
  backgroundColor: 'var(--color-background)',
}

/**
 * Admin settings client component.
 */
export default function AdminSettingsClient({ profile, businessName }: Props) {
  const toggleRef = useRef<HTMLInputElement>(null)
  const { toast, toastState, dismiss } = useToast()

  useEffect(() => {
    const savedMode = window.localStorage.getItem(getDashboardThemeKey(profile.id))
    const shouldUseDarkMode = savedMode === 'dark'
    applyDashboardTheme(savedMode)

    if (toggleRef.current) {
      toggleRef.current.checked = shouldUseDarkMode
    }
  }, [profile.id])

  /**
   * Saves and applies the current admin's theme preference.
   */
  const onThemeToggle = () => {
    const nextTheme = toggleRef.current?.checked ? 'dark' : 'light'
    window.localStorage.setItem(getDashboardThemeKey(profile.id), nextTheme)
    applyDashboardTheme(nextTheme)
    toast.success(nextTheme === 'dark' ? 'Dark mode enabled' : 'Light mode enabled')
  }

  return (
    <div className="flex flex-col gap-6">
      {toastState && (
        <Toast
          message={toastState.message}
          type={toastState.type}
          duration={toastState.duration}
          onDismiss={dismiss}
        />
      )}

      <div>
        <h1
          className="font-bold"
          style={{ fontSize: '22px', color: 'var(--color-text-primary)', letterSpacing: '-0.3px' }}
        >
          Settings
        </h1>
        <p style={{ fontSize: '14px', color: 'var(--color-text-muted)', marginTop: '4px' }}>
          Manage your admin workspace preferences.
        </p>
      </div>

      <Card padding="md">
        <CardHeader title="Admin profile" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label style={{ fontSize: 13 }}>
            <span style={{ display: 'block', marginBottom: 6, fontWeight: 500, color: 'var(--color-text-primary)' }}>
              Name
            </span>
            <div style={readonlyValueStyle}>{profile.name}</div>
          </label>
          <label style={{ fontSize: 13 }}>
            <span style={{ display: 'block', marginBottom: 6, fontWeight: 500, color: 'var(--color-text-primary)' }}>
              Email
            </span>
            <div style={readonlyValueStyle}>{profile.email}</div>
          </label>
          <label style={{ fontSize: 13 }}>
            <span style={{ display: 'block', marginBottom: 6, fontWeight: 500, color: 'var(--color-text-primary)' }}>
              Phone
            </span>
            <div style={readonlyValueStyle}>{profile.phone ?? '-'}</div>
          </label>
          <label style={{ fontSize: 13 }}>
            <span style={{ display: 'block', marginBottom: 6, fontWeight: 500, color: 'var(--color-text-primary)' }}>
              Business
            </span>
            <div style={readonlyValueStyle}>{businessName}</div>
          </label>
        </div>
      </Card>

      <Card padding="md">
        <CardHeader title="Appearance" />
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)', margin: 0 }}>
              Dark mode
            </p>
            <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 6 }}>
              Saves to this browser for your admin account only.
            </p>
          </div>

          <label className="flex items-center gap-3" style={{ fontSize: 13, color: 'var(--color-text-primary)' }}>
            <input ref={toggleRef} type="checkbox" onChange={onThemeToggle} />
            Use dark mode
          </label>
        </div>
      </Card>

      <Card padding="md">
        <CardHeader title="Account" />
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)', margin: 0 }}>
              Sign out
            </p>
            <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 6 }}>
              End this admin session and return to the login page.
            </p>
          </div>

          <form action={logoutUser}>
            <button type="submit" className="btn-outline" style={{ padding: '10px 18px', borderRadius: 8 }}>
              Logout
            </button>
          </form>
        </div>
      </Card>
    </div>
  )
}
