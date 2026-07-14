'use client'
/**
 * Global navigation pending indicator for Retivox.
 *
 * Next.js loading boundaries render after navigation begins. This client helper
 * starts visual feedback immediately when users click internal links or submit
 * forms, then clears it when the route changes or after a safety timeout.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'

type NavigationPendingProviderProps = {
  children: ReactNode
}

/**
 * Returns whether an anchor points to an internal Retivox route.
 *
 * @param anchor - Clicked anchor.
 * @returns Whether navigation should show pending feedback.
 */
function isInternalAnchor(anchor: HTMLAnchorElement): boolean {
  if (!anchor.href || anchor.target || anchor.hasAttribute('download')) {
    return false
  }

  const url = new URL(anchor.href)
  return url.origin === window.location.origin && `${url.pathname}${url.search}` !== `${window.location.pathname}${window.location.search}`
}

/**
 * Provides global pending feedback around the app.
 *
 * @param props - Provider props.
 * @returns Children plus pending UI.
 */
export default function NavigationPendingProvider({ children }: NavigationPendingProviderProps) {
  const pathname = usePathname()
  const [pending, setPending] = useState(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!pending) return

    setPending(false)
  }, [pathname, pending])

  useEffect(() => {
    document.documentElement.classList.toggle('retivox-route-pending', pending)

    if (!pending) {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
      return
    }

    timeoutRef.current = setTimeout(() => setPending(false), 8000)

    return () => {
      document.documentElement.classList.remove('retivox-route-pending')
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
    }
  }, [pending])

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return
      }

      const target = event.target instanceof Element ? event.target : null
      const anchor = target?.closest('a')

      if (anchor instanceof HTMLAnchorElement && isInternalAnchor(anchor)) {
        setPending(true)
      }
    }

    const handleSubmit = (event: SubmitEvent) => {
      if (event.defaultPrevented) {
        return
      }

      const form = event.target
      if (form instanceof HTMLFormElement) {
        setPending(true)
      }
    }

    document.addEventListener('click', handleClick, true)
    document.addEventListener('submit', handleSubmit, true)

    return () => {
      document.removeEventListener('click', handleClick, true)
      document.removeEventListener('submit', handleSubmit, true)
    }
  }, [])

  return (
    <>
      {children}
      {pending ? (
        <div className="retivox-navigation-loader" role="status" aria-live="polite">
          <span className="retivox-navigation-loader-bar" />
          <span className="retivox-navigation-loader-pill">Loading...</span>
        </div>
      ) : null}
    </>
  )
}
