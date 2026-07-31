/**
 * React hook for Retivox mobile network status.
 *
 * Polls Expo Network state and exposes a compact online/offline signal for
 * banners, sync triggers, and guarded network actions.
 */

import { useEffect, useState } from 'react'
import type * as Network from 'expo-network'
import { getConnectivityState } from '../lib/network/connectivity'

export type OnlineStatus = {
  isOnline: boolean
  connectionType: Network.NetworkStateType | null
}

/**
 * Tracks network state.
 *
 * @returns Current online status and connection type.
 */
export function useOnlineStatus(): OnlineStatus {
  // Start conservatively until the first real network check completes. This
  // prevents offline startup from launching network requests optimistically.
  const [status, setStatus] = useState<OnlineStatus>({ isOnline: false, connectionType: null })

  useEffect(() => {
    let mounted = true

    /**
     * Refreshes connectivity state.
     *
     * @returns Promise that resolves after state update.
     */
    async function refreshStatus(): Promise<void> {
      const nextStatus = await getConnectivityState()

      if (mounted) {
        setStatus((currentStatus) =>
          currentStatus.isOnline === nextStatus.isOnline &&
          currentStatus.connectionType === nextStatus.connectionType
            ? currentStatus
            : nextStatus,
        )
      }
    }

    refreshStatus()
    const interval = setInterval(refreshStatus, 15000)

    return () => {
      mounted = false
      clearInterval(interval)
    }
  }, [])

  return status
}
