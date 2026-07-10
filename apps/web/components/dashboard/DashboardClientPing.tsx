'use client'
/**
 * DashboardClientPing shows a visible badge that confirms client hydration.
 *
 * The badge renders on the server first and then flips to "Client live" after
 * the browser hydrates the component. This helps distinguish SSR rendering
 * from actual interactive client execution.
 */

import { useEffect, useState } from 'react'

/**
 * DashboardClientPing component.
 */
export default function DashboardClientPing() {
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setHydrated(true)
    })

    return () => window.cancelAnimationFrame(frame)
  }, [])

  return (
    <div
      aria-live="polite"
      style={{
        position: 'fixed',
        right: '12px',
        bottom: '12px',
        zIndex: 90,
        padding: '8px 12px',
        borderRadius: '999px',
        fontSize: '12px',
        fontWeight: 600,
        boxShadow: '0 10px 24px rgba(0,0,0,0.18)',
        background: hydrated ? 'var(--color-success-light)' : 'var(--color-accent-light)',
        color: hydrated ? 'var(--color-success)' : 'var(--color-accent)',
        border: hydrated ? '1px solid var(--color-success)' : '1px solid var(--color-accent)',
        pointerEvents: 'none',
      }}
    >
      {hydrated ? 'Client live' : 'Hydrating...'}
    </div>
  )
}
