/**
 * Sidebar navigation for the Retivox dashboard.
 * Responsive — full sidebar on desktop, icon-only on tablet, bottom nav on mobile.
 * Role-aware — shows only relevant nav items based on user role.
 */

'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'

type NavItem = {
  label: string
  href: string
  icon: React.ReactNode
}

type SidebarProps = {
  role: string
  businessName: string
}

// ── Icons ──
function DashboardIcon() {
  return (
    <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  )
}

function ChartIcon() {
  return (
    <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  )
}

function StoreIcon() {
  return (
    <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  )
}

function PackageIcon() {
  return (
    <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <line x1="16.5" y1="9.4" x2="7.5" y2="4.21" />
      <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
    </svg>
  )
}

function TagIcon() {
  return (
    <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z" />
      <line x1="7" y1="7" x2="7.01" y2="7" />
    </svg>
  )
}

function TransferIcon() {
  return (
    <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <polyline points="17 1 21 5 17 9" />
      <path d="M3 11V9a4 4 0 014-4h14" />
      <polyline points="7 23 3 19 7 15" />
      <path d="M21 13v2a4 4 0 01-4 4H3" />
    </svg>
  )
}

function UsersIcon() {
  return (
    <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 00-3-3.87" />
      <path d="M16 3.13a4 4 0 010 7.75" />
    </svg>
  )
}

function UserIcon() {
  return (
    <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  )
}

function ReceiptIcon() {
  return (
    <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10 9 9 9 8 9" />
    </svg>
  )
}

function ShieldIcon() {
  return (
    <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  )
}

function SettingsIcon() {
  return (
    <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" />
    </svg>
  )
}

// ── Nav items per role ──
const ownerNav: { section: string; items: NavItem[] }[] = [
  {
    section: '',
    items: [
      { label: 'Overview', href: '/dashboard/owner', icon: <DashboardIcon /> },
      { label: 'Analytics', href: '/dashboard/owner/analytics', icon: <ChartIcon /> },
    ],
  },
  {
    section: 'Management',
    items: [
      { label: 'Branches', href: '/dashboard/owner/branches', icon: <StoreIcon /> },
      { label: 'Stock', href: '/dashboard/owner/stock', icon: <PackageIcon /> },
      { label: 'Products', href: '/dashboard/owner/products', icon: <TagIcon /> },
      { label: 'Transfers', href: '/dashboard/owner/transfers', icon: <TransferIcon /> },
    ],
  },
  {
    section: 'People',
    items: [
      { label: 'Admins', href: '/dashboard/owner/admins', icon: <UsersIcon /> },
      { label: 'Employees', href: '/dashboard/owner/employees', icon: <UserIcon /> },
    ],
  },
  {
    section: 'Finance',
    items: [
      { label: 'Finances', href: '/dashboard/owner/finances', icon: <ChartIcon /> },
      { label: 'Transactions', href: '/dashboard/owner/transactions', icon: <ReceiptIcon /> },
    ],
  },
  {
    section: 'System',
    items: [
      { label: 'Audit log', href: '/dashboard/owner/audit', icon: <ShieldIcon /> },
      { label: 'Settings', href: '/dashboard/owner/settings', icon: <SettingsIcon /> },
    ],
  },
]

const adminNav: { section: string; items: NavItem[] }[] = [
  {
    section: '',
    items: [
      { label: 'Overview', href: '/dashboard/admin', icon: <DashboardIcon /> },
    ],
  },
  {
    section: 'Management',
    items: [
      { label: 'Stock', href: '/dashboard/admin/stock', icon: <PackageIcon /> },
      { label: 'Damages', href: '/dashboard/admin/damaged-stock', icon: <PackageIcon /> },
      { label: 'Products', href: '/dashboard/admin/products', icon: <TagIcon /> },
      { label: 'Transfers', href: '/dashboard/admin/transfers', icon: <TransferIcon /> },
    ],
  },
  {
    section: 'People',
    items: [
      { label: 'Employees', href: '/dashboard/admin/employees', icon: <UserIcon /> },
    ],
  },
  {
    section: 'Finance',
    items: [
      { label: 'Transactions', href: '/dashboard/admin/transactions', icon: <ReceiptIcon /> },
    ],
  },
  {
    section: 'System',
    items: [
      { label: 'Settings', href: '/dashboard/admin/settings', icon: <SettingsIcon /> },
    ],
  },
]

export function Sidebar({ role, businessName }: SidebarProps) {
  const pathname = usePathname()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const navGroups = role === 'admin' ? adminNav : ownerNav
  const currentYear = new Date().getFullYear()

  return (
    <>
      {/* Desktop sidebar */}
      <aside
        className="hidden md:flex flex-col flex-shrink-0"
        style={{
          width: collapsed ? '76px' : '220px',
          backgroundColor: 'var(--color-surface)',
          borderRight: '1px solid var(--color-border)',
          height: '100vh',
          position: 'sticky',
          top: 0,
          overflowY: 'auto',
          transition: 'width 160ms ease',
        }}
      >
        {/* Logo and business name */}
        <div
          style={{
            flexShrink: 0,
            borderBottom: '1px solid var(--color-border)',
            paddingLeft: collapsed ? '12px' : '20px',
            paddingRight: collapsed ? '12px' : '20px',
            paddingTop: '14px',
            paddingBottom: '14px',
          }}
        >
          <div className="flex items-center justify-between gap-2">
            {/* Retivox wordmark */}
            <span
              title="Retivox"
              style={{
                fontSize: collapsed ? '18px' : '20px',
                fontWeight: 800,
                color: 'var(--color-primary)',
                letterSpacing: '-0.3px',
                display: 'block',
              }}
            >
              {collapsed ? 'R' : 'Retivox'}
            </span>
            <button
              type="button"
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              onClick={() => setCollapsed((current) => !current)}
              className="btn-outline"
              style={{
                width: 30,
                height: 30,
                padding: 0,
                borderRadius: 8,
                display: 'grid',
                placeItems: 'center',
                fontSize: 16,
                lineHeight: 1,
              }}
            >
              {collapsed ? '>' : '<'}
            </button>
          </div>

          {/* Business name below logo */}
          {!collapsed && (
            <span
              style={{
                fontSize: '12px',
                color: 'var(--color-text-muted)',
                display: 'block',
                marginTop: '2px',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {businessName}
            </span>
          )}
        </div>

        {/* Nav groups */}
        <nav className="flex flex-col gap-1 flex-1" style={{ paddingLeft: '12px', paddingRight: '12px', paddingTop: '16px', paddingBottom: '16px' }}>
          {navGroups.map((group) => (
            <div key={group.section}>
              {group.section && !collapsed && (
                <p
                  className="px-2"
                  style={{
                    fontSize: '11px',
                    fontWeight: 500,
                    color: 'var(--color-text-muted)',
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                    marginTop: '24px',
                    marginBottom: '6px',
                  }}
                >
                  {group.section}
                </p>
              )}
              {group.items.map((item) => {
                const isActive = pathname === item.href
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="flex items-center rounded-lg transition-all duration-150"
                    title={collapsed ? item.label : undefined}
                    style={{
                      justifyContent: collapsed ? 'center' : 'flex-start',
                      gap: collapsed ? 0 : '10px',
                      paddingLeft: '10px',
                      paddingRight: '10px',
                      paddingTop: '9px',
                      paddingBottom: '9px',
                      marginBottom: '2px',
                      fontSize: '13px',
                      fontWeight: isActive ? 500 : 400,
                      color: isActive ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                      backgroundColor: isActive ? 'var(--color-primary-light)' : 'transparent',
                      textDecoration: 'none',
                    }}
                  >
                    <span style={{ opacity: isActive ? 1 : 0.6 }}>{item.icon}</span>
                    {!collapsed && item.label}
                  </Link>
                )
              })}
            </div>
          ))}
        </nav>

        <p
          style={{
            margin: 0,
            padding: collapsed ? '12px 8px' : '12px 20px',
            borderTop: '1px solid var(--color-border)',
            color: 'var(--color-text-muted)',
            fontSize: 11,
            textAlign: collapsed ? 'center' : 'left',
          }}
        >
          {collapsed ? `© ${currentYear}` : `© ${currentYear} Retivox`}
        </p>
      </aside>

      {/* Mobile bottom navigation — shows most important items only */}
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 flex items-center justify-around z-50"
        style={{
          height: '60px',
          backgroundColor: 'var(--color-surface)',
          borderTop: '1px solid var(--color-border)',
        }}
      >
        {[
          { label: 'Home', href: role === 'admin' ? '/dashboard/admin' : '/dashboard/owner', icon: <DashboardIcon /> },
          { label: 'Stock', href: role === 'admin' ? '/dashboard/admin/stock' : '/dashboard/owner/stock', icon: <PackageIcon /> },
          { label: 'Sales', href: role === 'admin' ? '/dashboard/admin/transactions' : '/dashboard/owner/transactions', icon: <ReceiptIcon /> },
        ].map((item) => {
          const isActive = pathname === item.href
          return (
            <Link
              key={item.href}
              href={item.href}
              className="flex flex-col items-center gap-1"
              style={{
                color: isActive ? 'var(--color-primary)' : 'var(--color-text-muted)',
                textDecoration: 'none',
              }}
            >
              {item.icon}
              <span style={{ fontSize: '10px' }}>{item.label}</span>
            </Link>
          )
        })}
        <button
          type="button"
          className="flex flex-col items-center gap-1"
          style={{
            color: mobileMenuOpen ? 'var(--color-primary)' : 'var(--color-text-muted)',
            background: 'transparent',
            border: 0,
            padding: 0,
          }}
          onClick={() => setMobileMenuOpen(true)}
        >
          <SettingsIcon />
          <span style={{ fontSize: '10px' }}>Menu</span>
        </button>
      </nav>

      {mobileMenuOpen && (
        <div className="md:hidden fixed inset-0 z-50">
          <button
            type="button"
            aria-label="Close mobile navigation"
            onClick={() => setMobileMenuOpen(false)}
            style={{
              position: 'absolute',
              inset: 0,
              backgroundColor: 'rgba(0,0,0,0.4)',
              border: 0,
            }}
          />
          <div
            className="flex flex-col"
            style={{
              position: 'absolute',
              left: 12,
              right: 12,
              bottom: 72,
              maxHeight: 'calc(100vh - 112px)',
              overflowY: 'auto',
              backgroundColor: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-card)',
              boxShadow: 'var(--shadow-modal)',
              padding: 16,
            }}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p style={{ margin: 0, fontSize: 18, fontWeight: 800, color: 'var(--color-primary)' }}>Retivox</p>
                <p style={{ marginTop: 4, marginBottom: 0, fontSize: 12, color: 'var(--color-text-muted)' }}>
                  {businessName}
                </p>
              </div>
              <button
                type="button"
                className="btn-outline"
                style={{ padding: '5px 14px', borderRadius: 8 }}
                onClick={() => setMobileMenuOpen(false)}
              >
                Close
              </button>
            </div>

            <nav className="flex flex-col gap-1" style={{ marginTop: 16 }}>
              {navGroups.map((group) => (
                <div key={group.section || 'main'}>
                  {group.section && (
                    <p
                      style={{
                        marginTop: 16,
                        marginBottom: 6,
                        fontSize: 11,
                        fontWeight: 600,
                        letterSpacing: '0.06em',
                        textTransform: 'uppercase',
                        color: 'var(--color-text-muted)',
                      }}
                    >
                      {group.section}
                    </p>
                  )}
                  {group.items.map((item) => {
                    const isActive = pathname === item.href

                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className="flex items-center gap-3 rounded-lg"
                        style={{
                          padding: '10px 12px',
                          marginBottom: 4,
                          color: isActive ? 'var(--color-primary)' : 'var(--color-text-primary)',
                          backgroundColor: isActive ? 'var(--color-primary-light)' : 'var(--color-background)',
                          textDecoration: 'none',
                          fontSize: 14,
                          fontWeight: isActive ? 600 : 500,
                        }}
                        onClick={() => setMobileMenuOpen(false)}
                      >
                        <span style={{ opacity: isActive ? 1 : 0.7 }}>{item.icon}</span>
                        {item.label}
                      </Link>
                    )
                  })}
                </div>
              ))}
            </nav>
            <p style={{ margin: '16px 0 0', fontSize: 12, color: 'var(--color-text-muted)', textAlign: 'center' }}>
              © {currentYear} Retivox. All rights reserved.
            </p>
          </div>
        </div>
      )}
    </>
  )
}
