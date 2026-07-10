/**
 * Dashboard layout for Retivox.
 * Includes sidebar navigation and topbar for owner/admin dashboards.
 * Employee users are passed through to the employee-specific minimal layout.
 * Verifies authentication on every render.
 * Server component — auth check happens server side.
 */

import type { ReactNode } from 'react'
import { requireAuth, getUserProfile } from '../../lib/auth/helpers'
import { createClient } from '../../lib/supabase/server'
import { redirect } from 'next/navigation'
import { Sidebar } from '../../components/dashboard/Sidebar'
import DashboardClientPing from '../../components/dashboard/DashboardClientPing'
import DashboardThemeProvider from '../../components/dashboard/DashboardThemeProvider'

function RoleBadge({ role }: { role: string }) {
  const r = (role || 'employee').toLowerCase()
  const bgColor =
    r === 'owner'
      ? 'var(--color-success)'
      : r === 'admin'
      ? 'var(--color-accent)'
      : 'var(--color-border)'
  const textColor = r === 'employee' ? 'var(--color-text-muted)' : 'white'
  const label = role ? role.charAt(0).toUpperCase() + role.slice(1) : 'Employee'

  return (
    <span
      className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium"
      style={{ backgroundColor: bgColor, color: textColor }}
    >
      {label}
    </span>
  )
}

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const user = await requireAuth()
  if (!user) redirect('/login')

  const profile = await getUserProfile(user.id)
  if (!profile) redirect('/login')

  if (profile.is_active === false) {
    if (profile.global_role === 'employee') redirect('/account/deactivated')
    redirect('/login')
  }

  if (profile.global_role === 'employee') {
    return (
      <DashboardThemeProvider userId={profile.id}>
        <div className="min-h-screen" style={{ backgroundColor: 'var(--color-background)' }}>
          {children}
        </div>
      </DashboardThemeProvider>
    )
  }

  // Create a Supabase server-side client for the current request
  const supabase = await createClient()

  // Query the businesses table for the current profile's business name
  const { data: business } = await supabase
  .from('businesses')
  .select('name')
  .eq('id', profile.business_id ?? '')
  .maybeSingle() as { data: { name: string } | null, error: unknown }
  // Use the fetched business name if available, otherwise fall back to the default
  const businessName = business?.name ?? 'My Business'

  return (
    <DashboardThemeProvider userId={profile.id}>
      <div
        className="flex min-h-screen"
        style={{ backgroundColor: 'var(--color-background)' }}
      >
      {/* Sidebar */}
      <Sidebar
        role={profile.global_role ?? 'employee'}
        businessName={businessName}
      />

      {/* Main content area */}
      <div className="flex flex-col flex-1 min-w-0">
        {/* Topbar */}
        <div
          className="flex items-center justify-between flex-shrink-0"
          style={{
            height: '56px',
            backgroundColor: 'var(--color-surface)',
            borderBottom: '1px solid var(--color-border)',
            paddingLeft: '24px',
            paddingRight: '24px',
         }}
        >
          {/* Mobile logo — hidden on desktop since sidebar shows business name */}
          <span
            className="md:hidden font-bold"
            style={{ fontSize: '18px', color: 'var(--color-primary)' }}
          >
            Retivox
          </span>

          {/* Business name shown on desktop in muted text */}
          <span
            className="hidden md:block"
            style={{ fontSize: '13px', color: 'var(--color-text-muted)' }}
          >
            {businessName}
          </span>

          {/* Spacer on desktop */}
          <div className="hidden md:block" />

          {/* Right — profile and role */}
          <div className="flex items-center gap-3">
            <span
              aria-label="Dashboard shell status"
              className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium"
              style={{
                backgroundColor: 'var(--color-success-light)',
                color: 'var(--color-success)',
                border: '1px solid var(--color-success)',
              }}
            >
              Shell ready
            </span>
            <span
              className="text-sm font-medium hidden sm:block"
              style={{ color: 'var(--color-text-primary)' }}
            >
              {profile.name}
            </span>
            <RoleBadge role={profile.global_role ?? 'employee'} />
          </div>
        </div>

        {/* Page content — adds bottom padding on mobile for bottom nav */}
        <main
          className="flex-1 pb-20 md:pb-6"
          style={{
             backgroundColor: 'var(--color-background)',
            padding: '24px',
            paddingBottom: '80px',
           }}
        >
          {children}
        </main>
      </div>
      <DashboardClientPing />
      </div>
    </DashboardThemeProvider>
  )
}
