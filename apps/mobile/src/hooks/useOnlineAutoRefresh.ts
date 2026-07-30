/**
 * Online auto-refresh hook for Retivox mobile screens.
 *
 * Refreshes active screens when connectivity returns and periodically while
 * online so operational changes appear without manual pull-to-refresh.
 */

import { useCallback, useEffect } from 'react'
import { AppState } from 'react-native'
import { useFocusEffect, useIsFocused } from '@react-navigation/native'
import { useOnlineStatus } from './useOnlineStatus'
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
  const isFocused = useIsFocused()
  const intervalMs = options.intervalMs ?? 30000
  const label = options.label ?? 'useOnlineAutoRefresh'

  const safeRefresh = useCallback(async () => {
    if (!onlineStatus.isOnline || !isFocused || AppState.currentState !== 'active') {
      return
    }

    try {
      await refresh()
    } catch (error) {
      handleError(label, error)
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

    void safeRefresh()

    const interval = setInterval(() => {
      void safeRefresh()
    }, intervalMs)

    return () => clearInterval(interval)
  }, [intervalMs, isFocused, onlineStatus.isOnline, safeRefresh])
}
