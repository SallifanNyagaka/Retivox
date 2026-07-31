/**
 * Online auto-refresh hook for Retivox mobile screens.
 *
 * Refreshes active screens when connectivity returns and periodically while
 * online so operational changes appear without manual pull-to-refresh.
 */

import { useCallback, useEffect, useRef } from 'react'
import { AppState } from 'react-native'
import { useFocusEffect, useIsFocused } from '@react-navigation/native'
import { useOnlineStatus } from './useOnlineStatus'
import { useSyncStore } from '../store/syncStore'
import { handleError } from '../utils/errorHandler'

export type OnlineAutoRefreshOptions = {
  intervalMs?: number
  label?: string
}

/**
 * Runs a refresh callback on focus, online reconnect, and periodic online ticks.
 *
 * @param refresh - Refresh callback.
 * @param options - Refresh settings.
 * @returns Void.
 */
export function useOnlineAutoRefresh(refresh: () => Promise<void>, options: OnlineAutoRefreshOptions = {}): void {
  const onlineStatus = useOnlineStatus()
  const lastSyncedAt = useSyncStore((state) => state.lastSyncedAt)
  const isFocused = useIsFocused()
  const inFlightRef = useRef(false)
  const intervalMs = options.intervalMs ?? 60000
  const label = options.label ?? 'useOnlineAutoRefresh'

  const safeRefresh = useCallback(async () => {
    if (!onlineStatus.isOnline || !isFocused || AppState.currentState !== 'active') {
      return
    }

    if (inFlightRef.current) {
      return
    }

    inFlightRef.current = true

    try {
      await refresh()
    } catch (error) {
      handleError(label, error)
    } finally {
      inFlightRef.current = false
    }
  }, [isFocused, label, onlineStatus.isOnline, refresh])

  useFocusEffect(
    useCallback(() => {
      void safeRefresh()
    }, [safeRefresh]),
  )

  useEffect(() => {
    if (!onlineStatus.isOnline || !isFocused) {
      return undefined
    }

    const interval = setInterval(() => {
      void safeRefresh()
    }, intervalMs)

    return () => clearInterval(interval)
  }, [intervalMs, isFocused, onlineStatus.isOnline, safeRefresh])

  useEffect(() => {
    if (!lastSyncedAt || !onlineStatus.isOnline || !isFocused) return
    void safeRefresh()
  }, [isFocused, lastSyncedAt, onlineStatus.isOnline, safeRefresh])
}
