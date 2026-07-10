'use client'
/**
 * DashboardHydrationProbe surfaces hydration and client runtime errors visibly.
 *
 * The probe listens for console errors, window errors, and unhandled promise
 * rejections, then renders a fixed banner when it detects hydration-related
 * failures inside the dashboard shell.
 */

import { useEffect, useMemo, useState } from 'react'

/**
 * Human-readable error payload shown in the dashboard banner.
 */
type ProbeMessage = {
  title: string
  details: string
}

/**
 * Converts an unknown value into a compact text representation.
 */
function toText(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }

  if (value instanceof Error) {
    return value.message || value.name
  }

  if (typeof value === 'object' && value !== null) {
    const candidate = value as { message?: unknown; toString?: unknown }

    if (typeof candidate.message === 'string') {
      return candidate.message
    }

    if (typeof candidate.toString === 'function') {
      try {
        const rendered = candidate.toString()
        if (typeof rendered === 'string') {
          return rendered
        }
      } catch {
        return '[unprintable object]'
      }
    }
  }

  return String(value)
}

/**
 * Joins a list of console arguments into a single message string.
 */
function formatArgs(args: readonly unknown[]): string {
  return args.map(toText).join(' ')
}

/**
 * Detects whether an error message looks like a hydration failure.
 */
function isHydrationMessage(message: string): boolean {
  return /hydration|did not match|expected server html|text content does not match|hydrating|mismatch/i.test(message)
}

/**
 * DashboardHydrationProbe component.
 */
export default function DashboardHydrationProbe() {
  const [probeMessage, setProbeMessage] = useState<ProbeMessage | null>(null)

  /**
   * Adds listeners that surface hydration issues and restores them on cleanup.
   */
  useEffect(() => {
    const originalConsoleError = console.error

    const report = (message: string) => {
      if (!message || !isHydrationMessage(message)) {
        return
      }

      setProbeMessage({
        title: 'Dashboard hydration issue detected',
        details: message,
      })
    }

    console.error = (...args: unknown[]) => {
      report(formatArgs(args))
      originalConsoleError(...args)
    }

    const onWindowError = (event: ErrorEvent) => {
      report(`${event.message} ${event.error instanceof Error ? event.error.message : ''}`.trim())
    }

    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      report(formatArgs([event.reason]))
    }

    window.addEventListener('error', onWindowError)
    window.addEventListener('unhandledrejection', onUnhandledRejection)

    return () => {
      console.error = originalConsoleError
      window.removeEventListener('error', onWindowError)
      window.removeEventListener('unhandledrejection', onUnhandledRejection)
    }
  }, [])

  /**
   * Memoizes the shortened message so the banner stays compact.
   */
  const details = useMemo(() => {
    if (!probeMessage) {
      return ''
    }

    return probeMessage.details.length > 220
      ? `${probeMessage.details.slice(0, 220)}...`
      : probeMessage.details
  }, [probeMessage])

  if (!probeMessage) {
    return null
  }

  return (
    <div
      role="alert"
      aria-live="assertive"
      style={{
        position: 'fixed',
        left: '16px',
        right: '16px',
        bottom: '16px',
        zIndex: 80,
        backgroundColor: 'var(--color-danger-light)',
        border: '1px solid var(--color-danger)',
        color: 'var(--color-text-primary)',
        borderRadius: 'var(--radius-card)',
        boxShadow: '0 18px 50px rgba(0, 0, 0, 0.22)',
        padding: '16px 18px',
      }}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p style={{ margin: 0, fontSize: '14px', fontWeight: 700 }}>{probeMessage.title}</p>
          <p style={{ margin: '6px 0 0', fontSize: '13px', color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
            {details}
          </p>
        </div>

        <button
          type="button"
          className="btn-outline"
          onClick={() => setProbeMessage(null)}
          style={{ padding: '5px 14px', borderRadius: 8, flexShrink: 0 }}
        >
          Dismiss
        </button>
      </div>
    </div>
  )
}
