/**
 * Auth layout — wraps login and register pages.
 * Full screen centered layout with Retivox background.
 */

import type { ReactNode } from 'react'

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div
      style={{ backgroundColor: 'var(--color-background)' }}
      className="min-h-screen w-full flex items-center justify-center p-4"
    >
      {children}
    </div>
  )
}