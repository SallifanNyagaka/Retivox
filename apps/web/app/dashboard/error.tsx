'use client'

/**
 * Dashboard-wide error boundary.
 *
 * Server-rendered dashboard endpoints can still fail because of external
 * services, migrations, or stale browser state. This keeps those failures
 * inside the Retivox UI instead of showing the generic Next.js error page.
 */

import { useEffect } from 'react'
import { Card } from '../../components/ui/Card'

type Props = {
  error: Error & { digest?: string }
  reset: () => void
}

export default function DashboardError({ error, reset }: Props) {
  useEffect(() => {
    console.error('Dashboard route failed', error)
  }, [error])

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10" style={{ backgroundColor: 'var(--color-background)' }}>
      <Card padding="md">
        <div className="flex max-w-lg flex-col items-center gap-4 text-center">
          <div
            className="rounded-2xl"
            style={{
              width: 72,
              height: 72,
              display: 'grid',
              placeItems: 'center',
              backgroundColor: 'var(--color-primary-light)',
              color: 'var(--color-primary)',
              fontSize: 28,
              fontWeight: 800,
            }}
          >
            !
          </div>
          <div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: 'var(--color-text-primary)' }}>
              This section could not load
            </h1>
            <p style={{ margin: '8px 0 0', fontSize: 14, color: 'var(--color-text-muted)' }}>
              Please try again. If it keeps happening, the details have been logged so we can fix it without losing your place.
            </p>
          </div>
          <button type="button" className="btn-primary" style={{ padding: '10px 18px', borderRadius: 8 }} onClick={reset}>
            Reload section
          </button>
        </div>
      </Card>
    </div>
  )
}
