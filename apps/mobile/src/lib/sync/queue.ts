/**
 * Offline sync queue manager for Retivox mobile.
 *
 * Queues local writes in WatermelonDB and processes them oldest-first when the
 * device regains connectivity.
 */

import { Q } from '@nozbe/watermelondb'
import { database } from '../watermelon/database'
import { SyncQueueModel } from '../watermelon/models/SyncQueue'

export type QueueStatus = 'pending' | 'syncing' | 'synced' | 'failed'

export type QueuePayload = {
  entityType: string
  localId: string
  payload: Record<string, unknown>
}

/**
 * Adds a local write to the sync queue.
 *
 * @param input - Queue payload.
 * @returns Promise that resolves when queued.
 */
export async function enqueueSyncItem(input: QueuePayload): Promise<void> {
  await database.write(async () => {
    await database.get<SyncQueueModel>('sync_queue').create((record) => {
      record.entityType = input.entityType
      record.localId = input.localId
      record.payload = JSON.stringify(input.payload)
      record.status = 'pending'
      record.retryCount = 0
      record.errorMessage = ''
      record.createdLocallyAt = new Date()
    })
  })
}

/**
 * Loads queued pending or retryable failed items oldest-first.
 *
 * @returns Queue records.
 */
export async function getPendingQueueItems(): Promise<SyncQueueModel[]> {
  return database
    .get<SyncQueueModel>('sync_queue')
    .query(Q.where('status', Q.oneOf(['pending', 'failed'])), Q.where('retry_count', Q.lt(3)), Q.sortBy('created_locally_at', Q.asc))
    .fetch()
}

/**
 * Marks a queue item as syncing.
 *
 * @param item - Queue record.
 * @returns Promise that resolves after update.
 */
export async function markQueueItemSyncing(item: SyncQueueModel): Promise<void> {
  await database.write(async () => {
    await item.update((record) => {
      record.status = 'syncing'
    })
  })
}

/**
 * Marks a queue item as successfully synced.
 *
 * @param item - Queue record.
 * @returns Promise that resolves after update.
 */
export async function markQueueItemSynced(item: SyncQueueModel): Promise<void> {
  await database.write(async () => {
    await item.update((record) => {
      record.status = 'synced'
      record.syncedAt = new Date()
      record.errorMessage = ''
    })
  })
}

/**
 * Marks a queue item failed and increments retry count.
 *
 * @param item - Queue record.
 * @param message - Failure message.
 * @returns Promise that resolves after update.
 */
export async function markQueueItemFailed(item: SyncQueueModel, message: string): Promise<void> {
  await database.write(async () => {
    await item.update((record) => {
      record.status = 'failed'
      record.retryCount += 1
      record.errorMessage = message
    })
  })
}

/**
 * Returns pending and failed queue counts.
 *
 * @returns Pending and failed counts.
 */
export async function getQueueCounts(): Promise<{ pendingCount: number; failedCount: number }> {
  const [pendingCount, failedCount] = await Promise.all([
    database.get<SyncQueueModel>('sync_queue').query(Q.where('status', 'pending')).fetchCount(),
    database.get<SyncQueueModel>('sync_queue').query(Q.where('status', 'failed')).fetchCount(),
  ])

  return { pendingCount, failedCount }
}
