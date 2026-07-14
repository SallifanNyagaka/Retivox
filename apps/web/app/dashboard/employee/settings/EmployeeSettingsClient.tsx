'use client'

/**
 * Employee settings client.
 *
 * Settings here are intentionally personal: employees can view their account
 * context, set this browser's theme preference, and sign out.
 */

import { useEffect, useRef } from 'react'
import { Card, CardHeader } from '../../../../components/ui/Card'
import Toast from '../../../../components/ui/Toast'
import { applyDashboardTheme, getDashboardThemeKey } from '../../../../components/dashboard/DashboardThemeProvider'
import { logoutUser } from '../../../../lib/auth/actions'
import { useToast } from '../../../../lib/hooks/useToast'

type EmployeeSettingsProfile = {
  id: string
  name: string
  email: string
  phone: string | null
  branchName: string | null
  businessName: string
}

type Props = {
  profile: EmployeeSettingsProfile
}

const readonlyValueStyle = {
  minHeight: 44,
  border: '1px solid var(--color-border)',
  borderRadius: 8,
  padding: '11px 12px',
  boxSizing: 'border-box' as const,
  fontSize: 13,
  color: 'var(--color-text-primary)',
  backgroundColor: 'var(--color-background)',
  textAlign: 'left' as const,
}

export default function EmployeeSettingsClient({ profile }: Props) {
  const toggleRef = useRef<HTMLInputElement>(null)
  const { toast, toastState, dismiss } = useToast()

  useEffect(() => {
    const savedMode = window.localStorage.getItem(getDashboardThemeKey(profile.id))
    applyDashboardTheme(savedMode)

    if (toggleRef.current) {
      toggleRef.current.checked = savedMode === 'dark'
    }
  }, [profile.id])

  const onThemeToggle = () => {
    const nextTheme = toggleRef.current?.checked ? 'dark' : 'light'
    window.localStorage.setItem(getDashboardThemeKey(profile.id), nextTheme)
    applyDashboardTheme(nextTheme)
    toast.success(nextTheme === 'dark' ? 'Dark mode enabled' : 'Light mode enabled')
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 text-left">
      {toastState && (
        <Toast
          message={toastState.message}
          type={toastState.type}
          duration={toastState.duration}
          onDismiss={dismiss}
        />
      )}

      <div className="text-center">
        <h1 className="font-bold" style={{ fontSize: 22, color: 'var(--color-text-primary)', letterSpacing: '-0.3px' }}>
          Settings
        </h1>
        <p style={{ fontSize: 14, color: 'var(--color-text-muted)', marginTop: 4 }}>
          Manage your employee workspace preferences.
        </p>
      </div>

      <Card padding="md">
        <CardHeader title="My profile" />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <label style={{ fontSize: 13 }}>
            <span style={{ display: 'block', marginBottom: 6, fontWeight: 600, color: 'var(--color-text-primary)' }}>
              Name
            </span>
            <div style={readonlyValueStyle}>{profile.name}</div>
          </label>
          <label style={{ fontSize: 13 }}>
            <span style={{ display: 'block', marginBottom: 6, fontWeight: 600, color: 'var(--color-text-primary)' }}>
              Email
            </span>
            <div style={readonlyValueStyle}>{profile.email}</div>
          </label>
          <label style={{ fontSize: 13 }}>
            <span style={{ display: 'block', marginBottom: 6, fontWeight: 600, color: 'var(--color-text-primary)' }}>
              Phone
            </span>
            <div style={readonlyValueStyle}>{profile.phone ?? '-'}</div>
          </label>
          <label style={{ fontSize: 13 }}>
            <span style={{ display: 'block', marginBottom: 6, fontWeight: 600, color: 'var(--color-text-primary)' }}>
              Assigned store
            </span>
            <div style={readonlyValueStyle}>{profile.branchName ?? 'No active store assigned'}</div>
          </label>
          <label style={{ fontSize: 13 }}>
            <span style={{ display: 'block', marginBottom: 6, fontWeight: 600, color: 'var(--color-text-primary)' }}>
              Business
            </span>
            <div style={readonlyValueStyle}>{profile.businessName}</div>
          </label>
        </div>
      </Card>

      <Card padding="md">
        <CardHeader title="Appearance" />
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-text-primary)', margin: 0 }}>
              Dark mode
            </p>
            <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 6 }}>
              Saves to this browser for your employee account only.
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
            <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-text-primary)', margin: 0 }}>
              Sign out
            </p>
            <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 6 }}>
              End this employee session and return to the login page.
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
