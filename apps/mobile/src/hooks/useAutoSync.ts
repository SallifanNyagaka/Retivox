/**
 * Lightweight application-wide sync trigger.
 *
 * It only processes durable local writes. Screen data refresh remains scoped to
 * the visible screen, which keeps startup and navigation responsive.
 */

import { useEffect, useRef } from 'react'
import { AppState } from 'react-native'
import { getQueueCounts } from '../lib/sync/queue'
import { runWatermelonSync } from '../lib/watermelon/sync'
import { useAuthStore } from '../store/authStore'
import { useSyncStore } from '../store/syncStore'
import { useUiStore } from '../store/uiStore'
import { useOnlineStatus } from './useOnlineStatus'
import { handleError } from '../utils/errorHandler'

export function useAutoSync(): void {
  const profile = useAuthStore((state) => state.user)
  const onlineStatus = useOnlineStatus()
  const setSyncing = useSyncStore((state) => state.setSyncing)
  const setLastSynced = useSyncStore((state) => state.setLastSynced)
  const setPendingCount = useSyncStore((state) => state.setPendingCount)
  const setFailedCount = useSyncStore((state) => state.setFailedCount)
  const showToast = useUiStore((state) => state.showToast)
  const inFlightRef = useRef(false)

  useEffect(() => {
    if (!profile || !onlineStatus.isOnline) return undefined

    let mounted = true

    const sync = async (): Promise<void> => {
      if (inFlightRef.current || AppState.currentState !== 'active') return
      inFlightRef.current = true
      setSyncing(true)

      try {
        const before = await getQueueCounts()
        const result = await runWatermelonSync(profile)
        const counts = await getQueueCounts()
        if (mounted) {
          setPendingCount(counts.pendingCount)
          setFailedCount(counts.failedCount)
          setLastSynced(new Date())

          if (result.syncedTransactions.length === 1) {
            showToast(`Offline transaction synced as ${result.syncedTransactions[0].status.replace(/_/g, ' ')}.`, 'success')
          } else if (result.syncedTransactions.length > 1) {
            showToast(`${result.syncedTransactions.length} offline transactions synced.`, 'success')
          } else if (result.failedTransactions.length > 0 && (before.pendingCount > 0 || before.failedCount > 0)) {
            showToast('One or more offline transactions need review before they can sync.', 'warning')
          }
        }
      } catch (error) {
        handleError('useAutoSync', error)
      } finally {
        inFlightRef.current = false
        if (mounted) setSyncing(false)
      }
    }

    void sync()
    const interval = setInterval(() => {
      void sync()
    }, 45000)
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') void sync()
    })

    return () => {
      mounted = false
      clearInterval(interval)
      subscription.remove()
    }
  }, [onlineStatus.isOnline, profile, setFailedCount, setLastSynced, setPendingCount, setSyncing, showToast])
}
