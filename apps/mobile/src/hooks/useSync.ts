/**
 * Sync hook for Retivox mobile.
 *
 * Automatically schedules queue processing when the device comes online and
 * exposes manual sync controls for settings/profile screens.
 */

import { useCallback, useEffect } from 'react'
import { runWatermelonSync } from '../lib/watermelon/sync'
import { scheduleSyncQueueProcessing } from '../lib/sync/processor'
import { useAuthStore } from '../store/authStore'
import { useSyncStore } from '../store/syncStore'
import { useOnlineStatus } from './useOnlineStatus'
import { handleError } from '../utils/errorHandler'

/**
 * Exposes sync state and actions.
 *
 * @returns Sync state and manual trigger.
 */
export function useSync() {
  const onlineStatus = useOnlineStatus()
  const profile = useAuthStore((state) => state.user)
  const {
    failedCount,
    isSyncing,
    lastSyncedAt,
    pendingCount,
    setFailedCount,
    setLastSynced,
    setPendingCount,
    setSyncing,
  } = useSyncStore()

  const triggerSync = useCallback(async () => {
    if (!profile || !onlineStatus.isOnline || isSyncing) return

    setSyncing(true)
    try {
      await runWatermelonSync(profile)
      setLastSynced(new Date())
    } catch (error) {
      handleError('useSync.triggerSync', error)
    } finally {
      setSyncing(false)
    }
  }, [isSyncing, onlineStatus.isOnline, profile, setLastSynced, setSyncing])

  useEffect(() => {
    if (onlineStatus.isOnline && profile) {
      scheduleSyncQueueProcessing()
      void (async () => {
        setSyncing(true)
        try {
          await runWatermelonSync(profile)
          setLastSynced(new Date())
        } catch (error) {
          handleError('useSync.onlineSync', error)
        } finally {
          setSyncing(false)
        }
      })()
    }
  }, [onlineStatus.isOnline, profile?.branchId, profile?.businessId, profile?.id, setLastSynced, setSyncing])

  return {
    failedCount,
    isSyncing,
    isOnline: onlineStatus.isOnline,
    lastSyncedAt,
    pendingCount,
    connectionType: onlineStatus.connectionType,
    setFailedCount,
    setPendingCount,
    triggerSync,
  }
}
