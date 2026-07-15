import type { ReactNode } from 'react'
import Link from 'next/link'
import { requirePlatformUser } from '../../../lib/platform/auth'
import { logoutPlatformUser } from '../actions'

export default async function PlatformConsoleLayout({ children }: { children: ReactNode }) {
  const user = await requirePlatformUser()

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--color-background)' }}>
      <header
        className="sticky top-0 z-30"
        style={{ backgroundColor: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}
      >
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-4 md:flex-row md:items-center md:justify-between">
          <div>
            <Link href="/platform" style={{ color: 'var(--color-primary)', fontSize: 20, fontWeight: 900, textDecoration: 'none' }}>
              Retivox Platform
            </Link>
            <p style={{ margin: '4px 0 0', color: 'var(--color-text-muted)', fontSize: 12 }}>
              {user.name} - {user.role}
            </p>
          </div>

          <nav className="flex flex-wrap items-center gap-2">
            <Link href="/platform" className="btn-outline" style={{ padding: '7px 14px', borderRadius: 8 }}>
              Overview
            </Link>
            <Link href="/platform/businesses" className="btn-outline" style={{ padding: '7px 14px', borderRadius: 8 }}>
              Businesses
            </Link>
            <Link href="/platform/reviews" className="btn-outline" style={{ padding: '7px 14px', borderRadius: 8 }}>
              Reviews
            </Link>
            <Link href="/platform/login-attempts" className="btn-outline" style={{ padding: '7px 14px', borderRadius: 8 }}>
              Login attempts
            </Link>
            <form action={logoutPlatformUser}>
              <button type="submit" className="btn-danger" style={{ padding: '7px 14px', borderRadius: 8 }}>
                Logout
              </button>
            </form>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </div>
  )
}
