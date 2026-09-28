'use client'
/**
 * Global PWA activity feedback for Retivox.
 *
 * A single observer covers internal navigation, form submissions, Server
 * Actions, direct Supabase mutations, and App Router refresh requests. Local
 * forms may still render their own detailed overlay; this indicator ensures a
 * user always receives feedback when a request takes longer than a tap.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'

type NavigationPendingProviderProps = {
  children: ReactNode
}

type Activity = {
  id: number
  label: string
}

type ActivityRecord = Activity & {
  timeout: number
  showTimeout: number
}

/** Returns whether an anchor points to an internal Retivox route. */
function isInternalAnchor(anchor: HTMLAnchorElement): boolean {
  if (!anchor.href || anchor.target || anchor.hasAttribute('download')) {
    return false
  }

  const url = new URL(anchor.href)
  return url.origin === window.location.origin && url.pathname !== window.location.pathname
}

/** Identifies browser requests that represent a user-visible operation. */
function getActivityLabel(input: RequestInfo | URL, init?: RequestInit): string | null {
  const request = input instanceof Request ? input : null
  const requestUrl = request?.url ?? String(input)
  const method = (init?.method ?? request?.method ?? 'GET').toUpperCase()

  try {
    const url = new URL(requestUrl, window.location.origin)

    if (url.origin === window.location.origin) {
      if (method !== 'GET') {
        return 'Saving changes...'
      }
    }

    // Supabase writes and RPC calls power the direct client-side controls.
    if (url.hostname.endsWith('.supabase.co') && method !== 'GET') {
      return 'Saving changes...'
    }
  } catch {
    // A malformed URL should never block the original request.
  }

  return null
}

/**
 * Provides a visible, non-blocking activity indicator for every meaningful
 * PWA operation. Fast requests settle before users notice the indicator.
 */
export default function NavigationPendingProvider({ children }: NavigationPendingProviderProps) {
  const pathname = usePathname()
  const [activity, setActivity] = useState<Activity | null>(null)
  const activitiesRef = useRef(new Map<number, ActivityRecord>())
  const nextActivityIdRef = useRef(0)
  const routeActivityIdRef = useRef<number | null>(null)

  const refreshVisibleActivity = useCallback(() => {
    const currentActivity = activitiesRef.current.values().next().value as ActivityRecord | undefined
    setActivity(currentActivity ? { id: currentActivity.id, label: currentActivity.label } : null)
  }, [])

  const finishActivity = useCallback((id: number) => {
    const record = activitiesRef.current.get(id)

    if (!record) {
      return
    }

    window.clearTimeout(record.timeout)
    window.clearTimeout(record.showTimeout)
    activitiesRef.current.delete(id)

    if (routeActivityIdRef.current === id) {
      routeActivityIdRef.current = null
    }

    refreshVisibleActivity()
  }, [refreshVisibleActivity])

  const beginActivity = useCallback((label: string, timeoutMs = 12000) => {
    const id = ++nextActivityIdRef.current
    const timeout = window.setTimeout(() => finishActivity(id), timeoutMs)
    const showTimeout = window.setTimeout(() => {
      if (activitiesRef.current.has(id)) {
        refreshVisibleActivity()
      }
    }, 200)

    activitiesRef.current.set(id, { id, label, timeout, showTimeout })

    return () => finishActivity(id)
  }, [finishActivity, refreshVisibleActivity])

  useEffect(() => {
    const routeActivityId = routeActivityIdRef.current

    if (routeActivityId !== null) {
      finishActivity(routeActivityId)
    }
  }, [finishActivity, pathname])

  useEffect(() => {
    document.documentElement.classList.toggle('retivox-route-pending', activity !== null)

    return () => {
      document.documentElement.classList.remove('retivox-route-pending')
    }
  }, [activity])

  useEffect(() => {
    const activeActivities = activitiesRef.current
    const handleClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return
      }

      const target = event.target instanceof Element ? event.target : null
      const anchor = target?.closest('a')

      if (anchor instanceof HTMLAnchorElement && isInternalAnchor(anchor)) {
        const stopActivity = beginActivity('Loading page...')
        routeActivityIdRef.current = nextActivityIdRef.current

        // A failed navigation must never leave the PWA visually busy forever.
        window.setTimeout(stopActivity, 10000)
      }
    }

    const handleSubmit = (event: SubmitEvent) => {
      if (event.defaultPrevented || !(event.target instanceof HTMLFormElement)) {
        return
      }

      // The fetch observer below takes over for Server Actions. This short
      // bridge makes a form tap feel responsive even before its request begins.
      const stopActivity = beginActivity('Processing request...', 1000)
      window.setTimeout(stopActivity, 450)
    }

    const originalFetch = window.fetch.bind(window)
    const wrappedFetch: typeof window.fetch = async (input, init) => {
      const label = getActivityLabel(input, init)
      const stopActivity = label ? beginActivity(label) : null

      try {
        return await originalFetch(input, init)
      } finally {
        stopActivity?.()
      }
    }

    window.fetch = wrappedFetch
    document.addEventListener('click', handleClick, true)
    document.addEventListener('submit', handleSubmit, true)

    return () => {
      document.removeEventListener('click', handleClick, true)
      document.removeEventListener('submit', handleSubmit, true)

      if (window.fetch === wrappedFetch) {
        window.fetch = originalFetch
      }

      activeActivities.forEach((record) => {
        window.clearTimeout(record.timeout)
        window.clearTimeout(record.showTimeout)
      })
      activeActivities.clear()
    }
  }, [beginActivity])

  return (
    <>
      {children}
      {activity ? (
        <div className="retivox-navigation-loader" role="status" aria-live="polite" aria-label={activity.label}>
          <span className="retivox-navigation-loader-bar" />
          <span className="retivox-navigation-loader-pill">
            <span className="retivox-navigation-loader-spinner" aria-hidden="true" />
            {activity.label}
          </span>
        </div>
      ) : null}
    </>
  )
}
