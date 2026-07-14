/**
 * Zustand sync store for Retivox mobile.
 *
 * Tracks background sync status, last successful sync time, and pending/failed
 * queue counts for profile and settings screens.
 */

import { create } from 'zustand'

export type SyncState = {
  isSyncing: boolean
  lastSyncedAt: Date | null
  pendingCount: number
  failedCount: number
  setSyncing: (isSyncing: boolean) => void
  setLastSynced: (date: Date | null) => void
  setPendingCount: (count: number) => void
  setFailedCount: (count: number) => void
}

/**
 * Creates the sync store.
 *
 * @returns Zustand sync state.
 */
export const useSyncStore = create<SyncState>((set) => ({
  isSyncing: false,
  lastSyncedAt: null,
  pendingCount: 0,
  failedCount: 0,
  setSyncing: (isSyncing) => set({ isSyncing }),
  setLastSynced: (lastSyncedAt) => set({ lastSyncedAt }),
  setPendingCount: (pendingCount) => set({ pendingCount }),
  setFailedCount: (failedCount) => set({ failedCount }),
}))
