/**
 * Lightweight application-wide sync trigger.
 *
 * It only processes durable local writes. Screen data refresh remains scoped to
 * the visible screen, which keeps startup and navigation responsive.
 */

import { useEffect, useRef } from 'react'
import { AppState } from 'react-native'
import { processSyncQueue } from '../lib/sync/processor'
import { getQueueCounts } from '../lib/sync/queue'
import { useAuthStore } from '../store/authStore'
import { useSyncStore } from '../store/syncStore'
import { useOnlineStatus } from './useOnlineStatus'
import { handleError } from '../utils/errorHandler'

export function useAutoSync(): void {
  const profile = useAuthStore((state) => state.user)
  const onlineStatus = useOnlineStatus()
  const setSyncing = useSyncStore((state) => state.setSyncing)
  const setLastSynced = useSyncStore((state) => state.setLastSynced)
  const setPendingCount = useSyncStore((state) => state.setPendingCount)
  const setFailedCount = useSyncStore((state) => state.setFailedCount)
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
        await processSyncQueue()
        const counts = await getQueueCounts()
        if (mounted) {
          setPendingCount(counts.pendingCount)
          setFailedCount(counts.failedCount)
          if (before.pendingCount > 0 || before.failedCount > 0 || counts.pendingCount > 0 || counts.failedCount > 0) {
            setLastSynced(new Date())
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
    }, 30000)
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') void sync()
    })

    return () => {
      mounted = false
      clearInterval(interval)
      subscription.remove()
    }
  }, [onlineStatus.isOnline, profile?.businessId, profile?.id, setFailedCount, setLastSynced, setPendingCount, setSyncing])
}
