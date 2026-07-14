/**
 * Sync queue processor for Retivox mobile.
 *
 * Processes queued offline writes in order, retrying transient failures and
 * preserving queued data when sessions expire.
 */

import { InteractionManager } from 'react-native'
import { getSession } from '../supabase/auth'
import { supabase } from '../supabase/client'
import { createDuplicateConflict, createSessionConflict } from './conflicts'
import { getPendingQueueItems, markQueueItemFailed, markQueueItemSynced, markQueueItemSyncing } from './queue'
import { getQueueCounts } from './queue'
import { useSyncStore } from '../../store/syncStore'
import { handleError } from '../../utils/errorHandler'

type SyncPayload = {
  table: string
  values: Record<string, unknown>
  localId?: string
}

/**
 * Parses a queued JSON payload.
 *
 * @param value - Serialized queue payload.
 * @returns Sync payload.
 */
function parseSyncPayload(value: string): SyncPayload {
  const parsed = JSON.parse(value) as unknown

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid sync payload.')
  }

  const record = parsed as { table?: unknown; values?: unknown; localId?: unknown }

  if (typeof record.table !== 'string' || !record.values || typeof record.values !== 'object') {
    throw new Error('Invalid sync payload shape.')
  }

  return {
    table: record.table,
    values: record.values as Record<string, unknown>,
    localId: typeof record.localId === 'string' ? record.localId : undefined,
  }
}

/**
 * Processes the queue immediately.
 *
 * @returns Promise that resolves after queue processing.
 */
export async function processSyncQueue(): Promise<void> {
  const syncStore = useSyncStore.getState()
  syncStore.setSyncing(true)

  try {
    const session = await getSession()

    if (!session) {
      const sessionConflict = createSessionConflict()
      const items = await getPendingQueueItems()
      await Promise.all(items.map((item) => markQueueItemFailed(item, sessionConflict.message)))
      return
    }

    const items = await getPendingQueueItems()

    for (const item of items) {
      try {
        await markQueueItemSyncing(item)
        const payload = parseSyncPayload(item.payload)

        if (payload.localId) {
          const { data: existing } = await supabase
            .from(payload.table)
            .select('id')
            .eq('local_id', payload.localId)
            .maybeSingle()

          const existingRecord = existing as { id?: string } | null
          if (existingRecord?.id) {
            createDuplicateConflict(existingRecord.id)
            await markQueueItemSynced(item)
            continue
          }
        }

        const { error } = await supabase.from(payload.table).insert(payload.values)

        if (error) {
          throw error
        }

        await markQueueItemSynced(item)
      } catch (error) {
        const handled = handleError('processSyncQueue.item', error)
        await markQueueItemFailed(item, handled.message)
      }
    }
  } finally {
    const counts = await getQueueCounts()
    syncStore.setPendingCount(counts.pendingCount)
    syncStore.setFailedCount(counts.failedCount)
    syncStore.setLastSynced(new Date())
    syncStore.setSyncing(false)
  }
}

/**
 * Schedules queue processing after current UI interactions complete.
 *
 * @returns Void.
 */
export function scheduleSyncQueueProcessing(): void {
  InteractionManager.runAfterInteractions(() => {
    processSyncQueue().catch((error: unknown) => {
      handleError('scheduleSyncQueueProcessing', error)
    })
  })
}
