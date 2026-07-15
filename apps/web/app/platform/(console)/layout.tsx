import type { ReactNode } from 'react'
import Link from 'next/link'
import { BarChart3, Building2, CreditCard, LogOut, MessageSquareQuote, Moon, ShieldCheck, Tags } from 'lucide-react'
import { requirePlatformUser } from '../../../lib/platform/auth'
import { logoutPlatformUser } from '../actions'

const navItems = [
  { href: '/platform', label: 'Overview', icon: BarChart3 },
  { href: '/platform/businesses', label: 'Businesses', icon: Building2 },
  { href: '/platform/pricing', label: 'Pricing', icon: Tags },
  { href: '/platform/payments', label: 'M-Pesa account', icon: CreditCard },
  { href: '/platform/dormant', label: 'Dormancy', icon: Moon },
  { href: '/platform/reviews', label: 'Reviews', icon: MessageSquareQuote },
  { href: '/platform/login-attempts', label: 'Login attempts', icon: ShieldCheck },
]

export default async function PlatformConsoleLayout({ children }: { children: ReactNode }) {
  const user = await requirePlatformUser()

  return (
    <div
      className="min-h-screen lg:grid lg:grid-cols-[280px_1fr]"
      style={{
        background:
          'radial-gradient(circle at top left, rgba(214,161,67,0.16), transparent 28rem), linear-gradient(135deg, #f7f3ea 0%, #fdfbf7 45%, #f5efe3 100%)',
      }}
    >
      <aside
        className="lg:sticky lg:top-0 lg:h-screen"
        style={{
          background: 'linear-gradient(180deg, #17201c 0%, #24332c 55%, #111816 100%)',
          color: '#f8f3e8',
          borderRight: '1px solid rgba(255,255,255,0.08)',
        }}
      >
        <div className="flex h-full flex-col gap-6 px-5 py-6">
          <div>
            <Link href="/platform" style={{ color: '#f8f3e8', fontSize: 22, fontWeight: 950, textDecoration: 'none', letterSpacing: '-0.04em' }}>
              Retivox Dev
            </Link>
            <p style={{ margin: '8px 0 0', color: 'rgba(248,243,232,0.64)', fontSize: 12, lineHeight: 1.5 }}>
              Platform command center for billing, tenants, risk, and public trust signals.
            </p>
          </div>

          <div
            className="rounded-2xl"
            style={{ backgroundColor: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.1)', padding: 14 }}
          >
            <p style={{ margin: 0, fontSize: 13, fontWeight: 850 }}>{user.name}</p>
            <p style={{ margin: '4px 0 0', color: 'rgba(248,243,232,0.64)', fontSize: 12, textTransform: 'capitalize' }}>
              {user.role}
            </p>
          </div>

          <nav className="flex flex-col gap-2">
            {navItems.map((item) => {
              const Icon = item.icon
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="flex items-center gap-3 rounded-xl"
                  style={{
                    color: '#f8f3e8',
                    textDecoration: 'none',
                    padding: '11px 12px',
                    backgroundColor: 'rgba(255,255,255,0.06)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    fontSize: 13,
                    fontWeight: 750,
                  }}
                >
                  <Icon size={17} />
                  {item.label}
                </Link>
              )
            })}
          </nav>

          <div style={{ marginTop: 'auto' }}>
            <form action={logoutPlatformUser}>
              <button
                type="submit"
                className="flex w-full items-center justify-center gap-2 rounded-xl"
                style={{
                  backgroundColor: 'rgba(221,55,67,0.18)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  color: '#ffe8e8',
                  padding: '11px 12px',
                  fontWeight: 850,
                }}
              >
                <LogOut size={16} />
                Logout
              </button>
            </form>
          </div>
        </div>
      </aside>

      <main className="mx-auto w-full max-w-7xl px-4 py-6 md:px-8 lg:py-8">{children}</main>
    </div>
  )
}
