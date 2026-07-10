/**
 * Employee web portal layout.
 *
 * Employees receive a minimal read-only web shell: no sidebar, no broad
 * dashboard navigation, only their identity, current branch, and logout.
 */

import type { ReactNode } from 'react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { logoutUser } from '../../../lib/auth/actions'
import { requireAuth } from '../../../lib/auth/helpers'
import { getEmployeeProfile } from '../../../lib/employee/auth'

/**
 * Props for the employee portal layout.
 */
type Props = {
  children: ReactNode
}

/**
 * EmployeeDashboardLayout renders the employee-only web portal shell.
 */
export default async function EmployeeDashboardLayout({ children }: Props) {
  const user = await requireAuth()
  const profile = await getEmployeeProfile(user.id)

  if (!profile) {
    redirect('/unauthorized')
  }

  if (!profile.isActive) {
    redirect('/account/deactivated')
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--color-background)' }}>
      <header
        className="sticky top-0 z-20 flex justify-center"
        style={{
          backgroundColor: 'var(--color-surface)',
          borderBottom: '1px solid var(--color-border)',
        }}
      >
        <div className="flex w-full max-w-2xl flex-col items-center justify-center gap-3 px-4 py-4 text-center sm:px-6">
          {/* Employee identity and single branch assignment */}
          <div>
            <Link
              href="/dashboard/employee"
              className="font-bold"
              style={{ fontSize: 18, color: 'var(--color-primary)', letterSpacing: '-0.2px' }}
            >
              Retivox Employee
            </Link>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--color-text-muted)' }}>
              {profile.name} · {profile.branchName ?? 'No active branch'}
            </p>
          </div>

          {/* Minimal employee actions only */}
          <nav className="flex w-full flex-wrap items-center justify-center gap-2" aria-label="Employee portal navigation">
            <Link href="/dashboard/employee" className="btn-outline" style={{ padding: '5px 14px', borderRadius: 8 }}>
              Overview
            </Link>
            <Link
              href="/dashboard/employee/transactions"
              className="btn-outline"
              style={{ padding: '5px 14px', borderRadius: 8 }}
            >
              Transactions
            </Link>
            <Link
              href="/dashboard/employee/damaged-stock"
              className="btn-outline"
              style={{ padding: '5px 14px', borderRadius: 8 }}
            >
              Damaged stock
            </Link>
            <Link href="/dashboard/employee/settings" className="btn-outline" style={{ padding: '5px 14px', borderRadius: 8 }}>
              Settings
            </Link>
            <form action={logoutUser}>
              <button type="submit" className="btn-danger" style={{ padding: '5px 14px', borderRadius: 8 }}>
                Logout
              </button>
            </form>
          </nav>
        </div>
      </header>

      <main className="flex w-full justify-center px-4 py-6 sm:px-6">
        <div className="flex w-full max-w-2xl justify-center">
          <div className="w-full">{children}</div>
        </div>
      </main>
    </div>
  )
}
