/**
 * Durable employee UI snapshot and offline-sale staging.
 *
 * The snapshot, local transaction, payment, line items, and queue entry are
 * written in one WatermelonDB transaction. A sale therefore survives an app
 * restart or a connectivity change at any point in the submission flow.
 */

import { Q } from '@nozbe/watermelondb'
import AsyncStorage from '@react-native-async-storage/async-storage'
import type {
  DamageReportProductOption,
  EmployeeDashboardData,
  EmployeeProductOption,
  EmployeeTransaction,
  PaymentMethod,
} from '../employee/employeeApi'
import { database } from '../watermelon/database'
import { MobileCacheModel } from '../watermelon/models/MobileCache'
import { PaymentModel } from '../watermelon/models/Payment'
import { SyncQueueModel } from '../watermelon/models/SyncQueue'
import { TransactionItemModel } from '../watermelon/models/TransactionItem'
import { TransactionModel } from '../watermelon/models/Transaction'
import { readAllMobileCache, readMobileCache, writeMobileCache } from '../watermelon/cache'

let snapshotWriteChain: Promise<unknown> = Promise.resolve()

export type OfflineEmployeeSnapshot = EmployeeDashboardData & {
  businessId: string
  branchId: string
  employeeId: string
  transactions: EmployeeTransaction[]
  damageProducts: DamageReportProductOption[]
  pendingStockDeductions?: Array<{ localId: string; optionId: string; baseQuantity: number }>
  updatedAt: string
}

export type OfflineSaleLine = {
  optionId: string
  productId: string
  quantityInUom: number
  baseQuantity: number
  unitPrice: number
  lineTotal: number
}

export type OfflineSaleStageInput = {
  identity: Pick<OfflineEmployeeSnapshot, 'businessId' | 'branchId' | 'employeeId'>
  localId: string
  recordedAt: string
  transaction: EmployeeTransaction
  lines: OfflineSaleLine[]
  paymentMethod: PaymentMethod
  paymentReference: string
  subtotal: number
  discountAmount: number
  totalAmount: number
  rpcArgs: Record<string, unknown>
}

function snapshotKey(businessId: string, employeeId: string): string {
  return `employee:${businessId}:${employeeId}`
}

function legacySnapshotKey(businessId: string, employeeId: string): string {
  return `retivox:employee-snapshot:${businessId}:${employeeId}`
}

async function withSnapshotWrite<T>(operation: () => Promise<T>): Promise<T> {
  const previous = snapshotWriteChain
  let release!: () => void
  snapshotWriteChain = new Promise<void>((resolve) => {
    release = resolve
  })

  await previous
  try {
    return await operation()
  } finally {
    release()
  }
}

function isSnapshot(value: unknown): value is OfflineEmployeeSnapshot {
  if (!value || typeof value !== 'object') return false

  const snapshot = value as Partial<OfflineEmployeeSnapshot>
  return (
    typeof snapshot.businessId === 'string' &&
    typeof snapshot.branchId === 'string' &&
    typeof snapshot.employeeId === 'string' &&
    typeof snapshot.currency === 'string' &&
    Array.isArray(snapshot.products) &&
    Array.isArray(snapshot.todayTransactions) &&
    Array.isArray(snapshot.recentTransactions) &&
    Array.isArray(snapshot.transactions) &&
    Array.isArray(snapshot.damageProducts)
  )
}

function createEmptySnapshot(identity: Pick<OfflineEmployeeSnapshot, 'businessId' | 'branchId' | 'employeeId'>): OfflineEmployeeSnapshot {
  return {
    ...identity,
    currency: 'KES',
    todayTransactions: [],
    recentTransactions: [],
    transactions: [],
    products: [],
    damageProducts: [],
    updatedAt: new Date().toISOString(),
  }
}

function withTimestamp(snapshot: OfflineEmployeeSnapshot): OfflineEmployeeSnapshot {
  return { ...snapshot, updatedAt: new Date().toISOString() }
}

function isLocalTransaction(transaction: EmployeeTransaction): boolean {
  return transaction.id.startsWith('offline-') && ['pending_sync', 'syncing', 'sync_failed'].includes(transaction.status)
}

function mergeTransactions(remote: EmployeeTransaction[], local: EmployeeTransaction[], limit: number, todayOnly = false): EmployeeTransaction[] {
  return [...local, ...remote]
    .filter((transaction) => !todayOnly || isSameLocalDay(transaction.recordedAt, new Date()))
    .filter((transaction, index, all) => all.findIndex((candidate) => candidate.id === transaction.id) === index)
    .sort((left, right) => new Date(right.recordedAt).getTime() - new Date(left.recordedAt).getTime())
    .slice(0, limit)
}

function isSameLocalDay(value: string, reference: Date): boolean {
  const date = new Date(value)
  return date.getFullYear() === reference.getFullYear() && date.getMonth() === reference.getMonth() && date.getDate() === reference.getDate()
}

/**
 * Reads the last complete employee state stored on this device.
 */
export async function readEmployeeSnapshot(businessId: string, employeeId: string): Promise<OfflineEmployeeSnapshot | null> {
  const value = await readMobileCache<OfflineEmployeeSnapshot>(snapshotKey(businessId, employeeId))
  if (isSnapshot(value)) return value

  // Import the previous app version's cache once so upgrading does not leave
  // a previously signed-in employee with an empty offline dashboard.
  try {
    const legacyValue = await AsyncStorage.getItem(legacySnapshotKey(businessId, employeeId))
    const legacySnapshot = legacyValue ? (JSON.parse(legacyValue) as unknown) : null
    if (isSnapshot(legacySnapshot)) {
      await writeMobileCache(snapshotKey(businessId, employeeId), withTimestamp(legacySnapshot))
      return legacySnapshot
    }
  } catch {
    // No legacy cache is a normal first-install case.
  }

  return null
}

/**
 * Reads a branch snapshot when the screen has not yet resolved the user id.
 */
export async function readEmployeeSnapshotByBranch(branchId: string): Promise<OfflineEmployeeSnapshot | null> {
  const entries = await readAllMobileCache<OfflineEmployeeSnapshot>()
  return entries.map((entry) => entry.value).find((value) => isSnapshot(value) && value.branchId === branchId) ?? null
}

/**
 * Replaces the durable snapshot after a successful online pull.
 */
export async function writeEmployeeSnapshot(snapshot: OfflineEmployeeSnapshot): Promise<void> {
  await withSnapshotWrite(async () => {
    await writeMobileCache(snapshotKey(snapshot.businessId, snapshot.employeeId), withTimestamp(snapshot))
  })
}

/**
 * Merges an online response without erasing visible local sales waiting to sync.
 */
export async function mergeEmployeeSnapshot(
  identity: Pick<OfflineEmployeeSnapshot, 'businessId' | 'branchId' | 'employeeId'>,
  patch: Partial<Pick<OfflineEmployeeSnapshot, 'currency' | 'todayTransactions' | 'recentTransactions' | 'transactions' | 'products' | 'damageProducts'>>,
): Promise<OfflineEmployeeSnapshot> {
  return withSnapshotWrite(async () => {
    const current = (await readEmployeeSnapshot(identity.businessId, identity.employeeId)) ?? createEmptySnapshot(identity)
    const local = current.transactions.filter(isLocalTransaction)
    const next: OfflineEmployeeSnapshot = withTimestamp({
      ...current,
      ...patch,
      ...identity,
      products: patch.products ? deductCachedStock(patch.products, current.pendingStockDeductions ?? []) : current.products,
      transactions: patch.transactions ? mergeTransactions(patch.transactions, local, 50) : current.transactions,
      recentTransactions: patch.recentTransactions ? mergeTransactions(patch.recentTransactions, local, 20) : current.recentTransactions,
      todayTransactions: patch.todayTransactions ? mergeTransactions(patch.todayTransactions, local, 50, true) : current.todayTransactions,
    })
    await writeMobileCache(snapshotKey(identity.businessId, identity.employeeId), next)
    return next
  })
}

/**
 * Stages a sale locally. This is intentionally used for both online and
 * offline sales; online mode simply runs synchronization immediately after it.
 */
export async function stageEmployeeTransaction(input: OfflineSaleStageInput): Promise<void> {
  await withSnapshotWrite(async () => {
    await database.write(async () => {
      const cacheCollection = database.get<MobileCacheModel>('mobile_cache')
      const cacheRecords = await cacheCollection.query(Q.where('cache_key', snapshotKey(input.identity.businessId, input.identity.employeeId))).fetch()
      const parsed = cacheRecords[0] ? safeSnapshot(cacheRecords[0].payload) : null
      const current = parsed ?? createEmptySnapshot(input.identity)
      const pendingStockDeductions = [
        ...(current.pendingStockDeductions ?? []),
        ...input.lines.map((line) => ({ localId: input.localId, optionId: line.optionId, baseQuantity: line.baseQuantity })),
      ]
      const products = deductCachedStock(current.products, input.lines)
      const transactions = [input.transaction, ...current.transactions.filter((item) => item.id !== input.localId)].slice(0, 50)
      const next = withTimestamp({
        ...current,
        ...input.identity,
        products,
        pendingStockDeductions,
        transactions,
        recentTransactions: transactions.slice(0, 20),
        todayTransactions: transactions.filter((item) => isSameLocalDay(item.recordedAt, new Date())).slice(0, 50),
      })

      await database.get<TransactionModel>('transactions').create((record) => {
        record.branchId = input.identity.branchId
        record.employeeId = input.identity.employeeId
        record.businessId = input.identity.businessId
        record.status = 'pending_sync'
        record.subtotal = input.subtotal
        record.discountAmount = input.discountAmount
        record.totalAmount = input.totalAmount
        record.origin = 'offline'
        record.localSyncStatus = 'pending'
        record.localId = input.localId
        record.recordedAt = new Date(input.recordedAt)
      })

      for (const line of input.lines) {
        await database.get<TransactionItemModel>('transaction_items').create((record) => {
          record.transactionId = input.localId
          record.productId = line.productId
          record.quantity = line.quantityInUom
          record.unitPriceAtSale = line.unitPrice
          record.lineTotal = line.lineTotal
          record.stockStatus = line.optionId.startsWith('recovery:') ? 'recovery_deducted' : 'deducted'
          record.localSyncStatus = 'pending'
        })
      }

      await database.get<PaymentModel>('payments').create((record) => {
        record.transactionId = input.localId
        record.paymentMethod = input.paymentMethod
        record.amount = input.totalAmount
        record.status = 'pending_verify'
        record.mpesaRefCode = input.paymentMethod === 'mpesa_manual' ? input.paymentReference : ''
        record.cashDepositCode = ''
        record.accountReference = input.localId
        record.localSyncStatus = 'pending'
      })

      await database.get<SyncQueueModel>('sync_queue').create((record) => {
        record.entityType = 'employee_transaction'
        record.localId = input.localId
        record.payload = JSON.stringify({
          kind: 'rpc',
          rpc: 'employee_record_transaction_offline',
          args: { ...input.rpcArgs, p_local_id: input.localId },
        })
        record.status = 'pending'
        record.retryCount = 0
        record.errorMessage = ''
        record.createdLocallyAt = new Date(input.recordedAt)
      })

      if (cacheRecords[0]) {
        await cacheRecords[0].update((record) => {
          record.payload = JSON.stringify(next)
          record.updatedAt = new Date()
        })
      } else {
        await cacheCollection.create((record) => {
          record.cacheKey = snapshotKey(input.identity.businessId, input.identity.employeeId)
          record.payload = JSON.stringify(next)
          record.updatedAt = new Date()
        })
      }
    })
  })
}

/**
 * Reconciles a staged transaction once the server confirms its idempotent RPC.
 */
export async function markOfflineEmployeeTransactionSynced(localId: string, serverId: string, status: string): Promise<void> {
  await withSnapshotWrite(async () => {
    await database.write(async () => {
      const transactions = await database.get<TransactionModel>('transactions').query(Q.where('local_id', localId)).fetch()
      if (transactions[0]) {
        await transactions[0].update((record) => {
          record.serverId = serverId
          record.status = status
          record.localSyncStatus = 'synced'
          record.syncedAt = new Date()
        })
      }

      await updateSnapshotInDatabase(localId, (transaction) => ({ ...transaction, id: serverId, status }), true)
    })
  })
}

/**
 * Keeps a rejected server sale visible to the employee instead of silently
 * deleting it after a failed synchronization attempt.
 */
export async function markOfflineEmployeeTransactionFailed(localId: string): Promise<void> {
  await withSnapshotWrite(async () => {
    await database.write(async () => {
      const transactions = await database.get<TransactionModel>('transactions').query(Q.where('local_id', localId)).fetch()
      if (transactions[0]) {
        await transactions[0].update((record) => {
          record.status = 'sync_failed'
          record.localSyncStatus = 'failed'
        })
      }
      await updateSnapshotInDatabase(localId, (transaction) => ({ ...transaction, status: 'sync_failed' }), true)
    })
  })
}

async function updateSnapshotInDatabase(
  localId: string,
  update: (transaction: EmployeeTransaction) => EmployeeTransaction,
  clearPendingDeduction = false,
): Promise<void> {
  const cacheCollection = database.get<MobileCacheModel>('mobile_cache')
  const cacheRecords = await cacheCollection.query().fetch()
  const cacheRecord = cacheRecords.find((record) => {
    const snapshot = safeSnapshot(record.payload)
    return snapshot?.transactions.some((transaction) => transaction.id === localId)
  })
  const snapshot = cacheRecord ? safeSnapshot(cacheRecord.payload) : null
  if (!cacheRecord || !snapshot) return

  const mapTransactions = (transactions: EmployeeTransaction[]) => transactions.map((transaction) => transaction.id === localId ? update(transaction) : transaction)
  const next = withTimestamp({
    ...snapshot,
    transactions: mapTransactions(snapshot.transactions),
    recentTransactions: mapTransactions(snapshot.recentTransactions),
    todayTransactions: mapTransactions(snapshot.todayTransactions),
    pendingStockDeductions: clearPendingDeduction
      ? (snapshot.pendingStockDeductions ?? []).filter((deduction) => deduction.localId !== localId)
      : snapshot.pendingStockDeductions,
  })
  await cacheRecord.update((record) => {
    record.payload = JSON.stringify(next)
    record.updatedAt = new Date()
  })
}

function deductCachedStock(
  products: EmployeeProductOption[],
  lines: Array<Pick<OfflineSaleLine, 'optionId' | 'baseQuantity'>>,
): EmployeeProductOption[] {
  return products.map((product) => {
    const deduction = lines.filter((line) => line.optionId === product.optionId).reduce((sum, line) => sum + line.baseQuantity, 0)
    if (deduction <= 0) return product
    const baseQuantityOnHand = Math.max(product.baseQuantityOnHand - deduction, 0)
    return { ...product, baseQuantityOnHand, quantityOnHand: Math.max(Math.floor(baseQuantityOnHand), 0) }
  })
}

function safeSnapshot(value: string): OfflineEmployeeSnapshot | null {
  try {
    const parsed = JSON.parse(value) as unknown
    return isSnapshot(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function createOfflineTransactionId(): string {
  return `offline-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}
