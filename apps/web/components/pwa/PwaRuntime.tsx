'use client'

import { useEffect, useRef, useState } from 'react'
import { syncOfflineEmployeeSales } from '../../lib/pwa/offlineEmployeeSales'
import { clearTrustedDeviceSession } from '../../lib/pwa/trustedDevice'
import { createClient } from '../../lib/supabase/client'

const ACTIVE_ACCOUNT_KEY = 'retivox-pwa-active-account'

function clearPrivatePageCache() {
  navigator.serviceWorker?.controller?.postMessage({ type: 'CLEAR_PRIVATE_PWA_CACHE' })
}

/**
 * Registers the PWA worker, keeps private page cache tied to one account, and
 * retries employee sales whenever the browser reconnects.
 */
export default function PwaRuntime() {
  const syncing = useRef(false)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (!('serviceWorker' in navigator)) {
      return
    }

    void navigator.serviceWorker.register('/sw.js').then(async (registration) => {
      const readyRegistration = await navigator.serviceWorker.ready
      const worker = readyRegistration.active ?? registration.active
      worker?.postMessage({ type: 'CACHE_CURRENT_PAGE', url: window.location.href })
      const staticAssets = performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .filter((url) => {
          const assetUrl = new URL(url)
          return assetUrl.origin === window.location.origin && assetUrl.pathname.startsWith('/_next/static/')
        })

      if (staticAssets.length > 0) {
        worker?.postMessage({ type: 'CACHE_STATIC_ASSETS', urls: staticAssets })
      }
    })
  }, [])

  useEffect(() => {
    const supabase = createClient()
    let cancelled = false

    const syncForCurrentAccount = async () => {
      if (cancelled || syncing.current || !navigator.onLine) {
        return
      }

      const { data } = await supabase.auth.getSession()
      const userId = data.session?.user.id
      const previousUserId = window.localStorage.getItem(ACTIVE_ACCOUNT_KEY)

      if (!userId) {
        if (previousUserId) {
          clearPrivatePageCache()
          clearTrustedDeviceSession()
          window.localStorage.removeItem(ACTIVE_ACCOUNT_KEY)
        }
        return
      }

      if (previousUserId && previousUserId !== userId) {
        clearPrivatePageCache()
        clearTrustedDeviceSession()
      }
      window.localStorage.setItem(ACTIVE_ACCOUNT_KEY, userId)

      syncing.current = true
      try {
        const summary = await syncOfflineEmployeeSales(userId)

        if (summary.synced > 0) {
          setNotice(`${summary.synced} offline sale${summary.synced === 1 ? '' : 's'} synced successfully.`)
          window.setTimeout(() => setNotice(null), 6500)
          window.dispatchEvent(new Event('retivox:offline-sales-synced'))
        } else if (summary.needsAttention > 0) {
          setNotice(`${summary.needsAttention} saved sale${summary.needsAttention === 1 ? '' : 's'} needs review before syncing.`)
        }
      } catch {
        // A network change can happen while a sync is in progress. The queued sale remains intact for the next retry.
      } finally {
        syncing.current = false
      }
    }

    void syncForCurrentAccount()
    const onOnline = () => void syncForCurrentAccount()
    const interval = window.setInterval(() => void syncForCurrentAccount(), 30000)
    const { data: authSubscription } = supabase.auth.onAuthStateChange(() => {
      void syncForCurrentAccount()
    })

    window.addEventListener('online', onOnline)
    return () => {
      cancelled = true
      window.removeEventListener('online', onOnline)
      window.clearInterval(interval)
      authSubscription.subscription.unsubscribe()
    }
  }, [])

  if (!notice) {
    return null
  }

  return (
    <div
      role="status"
      className="fixed bottom-4 left-1/2 z-[100] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 rounded-xl border px-4 py-3 text-center text-sm font-semibold shadow-lg"
      style={{ borderColor: 'rgba(15, 118, 110, 0.35)', backgroundColor: 'var(--color-surface)', color: 'var(--color-text-primary)' }}
    >
      {notice}
    </div>
  )
}
