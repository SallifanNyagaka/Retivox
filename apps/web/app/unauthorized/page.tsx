/**
 * Unauthorized page — shown when a user tries to access
 * a page they do not have permission for.
 */

import Link from 'next/link'

export default function UnauthorizedPage() {
  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ backgroundColor: 'var(--color-background)' }}
    >
      <div className="text-center">
        <h1
          className="font-bold mb-2"
          style={{ fontSize: '48px', color: 'var(--color-primary)' }}
        >
          403
        </h1>
        <h2
          className="font-semibold mb-3"
          style={{ fontSize: '20px', color: 'var(--color-text-primary)' }}
        >
          Access denied
        </h2>
        <p
          className="mb-6 text-sm"
          style={{ color: 'var(--color-text-muted)' }}
        >
          You don&apos;t have permission to view this page.
        </p>
        <Link
          href="/login"
          className="text-sm font-semibold"
          style={{ color: 'var(--color-primary)' }}
        >
          Back to login →
        </Link>
      </div>
    </div>
  )
}