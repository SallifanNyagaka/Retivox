/**
 * Expo Network connectivity helpers for Retivox mobile.
 *
 * Provides platform-specific online detection used by hooks and sync triggers.
 */

import * as Network from 'expo-network'

export type ConnectivityState = {
  isOnline: boolean
  connectionType: Network.NetworkStateType | null
}

/**
 * Reads the current connectivity state.
 *
 * @returns Network state with online boolean and connection type.
 */
export async function getConnectivityState(): Promise<ConnectivityState> {
  const state = await Network.getNetworkStateAsync()

  return {
    isOnline: Boolean(state.isConnected && state.isInternetReachable !== false),
    connectionType: state.type ?? null,
  }
}

/**
 * Returns whether the device is currently online.
 *
 * @returns True when connected to the internet.
 */
export async function isOnline(): Promise<boolean> {
  const state = await getConnectivityState()
  return state.isOnline
}
