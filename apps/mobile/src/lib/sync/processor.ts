/**
 * Sync queue processor for Retivox mobile.
 *
 * Processes queued offline writes in order, retrying transient failures and
 * preserving queued data when sessions expire.
 */

import { InteractionManager } from 'react-native'
import { getSession, restoreCachedSession } from '../supabase/auth'
import { supabase } from '../supabase/client'
import { createDuplicateConflict } from './conflicts'
import { getPendingQueueItems, markQueueItemFailed, markQueueItemSynced, markQueueItemSyncing } from './queue'
import { getQueueCounts } from './queue'
import { useSyncStore } from '../../store/syncStore'
import { handleError } from '../../utils/errorHandler'
import { withTimeout } from '../../utils/asyncTimeout'
import { markOfflineEmployeeTransactionFailed, markOfflineEmployeeTransactionSynced } from '../offline/employeeSnapshot'

type SyncPayload = {
  table: string
  values: Record<string, unknown>
  localId?: string
} | {
  kind: 'rpc'
  rpc: 'employee_record_transaction_offline'
  args: Record<string, unknown>
}

export type SyncProcessResult = {
  syncedTransactions: Array<{ localId: string; serverId: string; status: string }>
  failedTransactions: Array<{ localId: string; message: string }>
}

let activeProcessing: Promise<SyncProcessResult> | null = null

function isRpcSyncPayload(payload: SyncPayload): payload is Extract<SyncPayload, { kind: 'rpc' }> {
  return 'kind' in payload && payload.kind === 'rpc'
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

  const record = parsed as { table?: unknown; values?: unknown; localId?: unknown; kind?: unknown; rpc?: unknown; args?: unknown }

  if (record.kind === 'rpc') {
    if (record.rpc !== 'employee_record_transaction_offline' || !record.args || typeof record.args !== 'object') {
      throw new Error('Invalid offline transaction payload.')
    }

    return {
      kind: 'rpc',
      rpc: 'employee_record_transaction_offline',
      args: record.args as Record<string, unknown>,
    }
  }

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
async function processSyncQueueInternal(): Promise<SyncProcessResult> {
  const syncStore = useSyncStore.getState()
  syncStore.setSyncing(true)
  const result: SyncProcessResult = { syncedTransactions: [], failedTransactions: [] }

  try {
    const session = (await getSession()) ?? (await restoreCachedSession())

    if (!session) {
      // Keep queued work pending until a valid session is restored. Marking it
      // failed here would make a normal offline login look like a data loss.
      return result
    }

    const items = await getPendingQueueItems()

    for (const item of items) {
      try {
        await markQueueItemSyncing(item)
        const payload = parseSyncPayload(item.payload)

        if (isRpcSyncPayload(payload)) {
          let { data, error } = await withTimeout(
            Promise.resolve(supabase.rpc(payload.rpc, payload.args)),
            30000,
            'Offline sale sync timed out.',
          )

          if (error && isSessionError(error)) {
            const refreshedSession = await restoreCachedSession()
            if (refreshedSession) {
              const retry = await withTimeout(
                Promise.resolve(supabase.rpc(payload.rpc, payload.args)),
                30000,
                'Offline sale sync timed out.',
              )
              data = retry.data
              error = retry.error
            }
          }

          if (error) throw error

          const response = Array.isArray(data) ? data[0] : data
          if (!response || typeof response !== 'object' || !('transaction_id' in response)) {
            throw new Error('The server did not acknowledge the offline transaction.')
          }

          const transactionId = (response as { transaction_id: unknown }).transaction_id
          if (typeof transactionId !== 'string' || transactionId.length === 0) {
            throw new Error('The server returned an invalid transaction acknowledgement.')
          }

          const status = typeof (response as { status?: unknown }).status === 'string'
            ? String((response as { status: string }).status)
            : 'pending_verify'
          await markOfflineEmployeeTransactionSynced(item.localId, transactionId, status)
          await markQueueItemSynced(item)
          result.syncedTransactions.push({ localId: item.localId, serverId: transactionId, status })
          continue
        }

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
        if (item.entityType === 'employee_transaction') {
          await markOfflineEmployeeTransactionFailed(item.localId)
          result.failedTransactions.push({ localId: item.localId, message: handled.message })
        }
      }
    }
  } finally {
    const counts = await getQueueCounts()
    syncStore.setPendingCount(counts.pendingCount)
    syncStore.setFailedCount(counts.failedCount)
    if (result.syncedTransactions.length > 0) {
      syncStore.setLastSynced(new Date())
    }
    syncStore.setSyncing(false)
  }

  return result
}

/**
 * Processes only one queue pass at a time. Several screens can notice the
 * same reconnect, but they must not submit the same local sale twice.
 */
export function processSyncQueue(): Promise<SyncProcessResult> {
  if (activeProcessing) return activeProcessing

  activeProcessing = processSyncQueueInternal().finally(() => {
    activeProcessing = null
  })

  return activeProcessing
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

function isSessionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase()
  return ['jwt', 'token', 'session', 'not authenticated', 'unauthorized'].some((part) => message.includes(part))
}
