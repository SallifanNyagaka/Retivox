/**
 * Offline employee snapshot storage.
 *
 * Supabase remains the source of truth when online. This snapshot keeps the
 * last usable employee dashboard/POS state on the device so the app can open
 * and sell while connectivity is unavailable.
 */

import AsyncStorage from '@react-native-async-storage/async-storage'
import type {
  DamageReportProductOption,
  EmployeeDashboardData,
  EmployeeProductOption,
  EmployeeTransaction,
} from '../employee/employeeApi'

const SNAPSHOT_PREFIX = 'retivox:employee-snapshot:'
const SNAPSHOT_INDEX_KEY = 'retivox:employee-snapshot-keys'
let snapshotWriteChain: Promise<unknown> = Promise.resolve()

export type OfflineEmployeeSnapshot = EmployeeDashboardData & {
  businessId: string
  branchId: string
  employeeId: string
  transactions: EmployeeTransaction[]
  damageProducts: DamageReportProductOption[]
  updatedAt: string
}

function snapshotKey(businessId: string, employeeId: string): string {
  return `${SNAPSHOT_PREFIX}${businessId}:${employeeId}`
}

async function rememberSnapshotKey(key: string): Promise<void> {
  try {
    const value = await AsyncStorage.getItem(SNAPSHOT_INDEX_KEY)
    const keys = value ? (JSON.parse(value) as unknown) : []
    const nextKeys = Array.isArray(keys) ? Array.from(new Set([...keys.filter((item) => typeof item === 'string'), key])) : [key]
    await AsyncStorage.setItem(SNAPSHOT_INDEX_KEY, JSON.stringify(nextKeys))
  } catch {
    // Snapshot persistence is best-effort; the live request must not fail.
  }
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

/**
 * Reads the latest snapshot for an employee.
 */
export async function readEmployeeSnapshot(businessId: string, employeeId: string): Promise<OfflineEmployeeSnapshot | null> {
  try {
    const value = await AsyncStorage.getItem(snapshotKey(businessId, employeeId))
    if (!value) return null

    const parsed = JSON.parse(value) as unknown
    return isSnapshot(parsed) ? parsed : null
  } catch {
    return null
  }
}

/**
 * Reads a snapshot when the employee id is not available to a screen.
 */
export async function readEmployeeSnapshotByBranch(branchId: string): Promise<OfflineEmployeeSnapshot | null> {
  try {
    const indexValue = await AsyncStorage.getItem(SNAPSHOT_INDEX_KEY)
    const keys = indexValue ? (JSON.parse(indexValue) as unknown) : []

    if (!Array.isArray(keys)) return null

    for (const key of keys) {
      if (typeof key !== 'string') continue
      const value = await AsyncStorage.getItem(key)
      if (!value) continue
      const parsed = JSON.parse(value) as unknown
      if (isSnapshot(parsed) && parsed.branchId === branchId) return parsed
    }
  } catch {
    return null
  }

  return null
}

/**
 * Stores the latest loaded employee state.
 */
export async function writeEmployeeSnapshot(snapshot: OfflineEmployeeSnapshot): Promise<void> {
  const key = snapshotKey(snapshot.businessId, snapshot.employeeId)

  await withSnapshotWrite(async () => {
    try {
      await AsyncStorage.setItem(key, JSON.stringify({ ...snapshot, updatedAt: new Date().toISOString() }))
      await rememberSnapshotKey(key)
    } catch {
      // Offline cache failures should never block the employee workflow.
    }
  })
}

/**
 * Merges a dashboard/POS update into the latest snapshot.
 */
export async function mergeEmployeeSnapshot(
  identity: Pick<OfflineEmployeeSnapshot, 'businessId' | 'branchId' | 'employeeId'>,
  patch: Partial<Pick<OfflineEmployeeSnapshot, 'currency' | 'todayTransactions' | 'recentTransactions' | 'transactions' | 'products' | 'damageProducts'>>,
): Promise<OfflineEmployeeSnapshot | null> {
  return withSnapshotWrite(async () => {
    const current = (await readEmployeeSnapshot(identity.businessId, identity.employeeId)) ?? createEmptySnapshot(identity)
    const pendingLocalTransactions = current.transactions.filter(isPendingLocalTransaction)
    const nextTransactions = patch.transactions
      ? mergePendingTransactions(patch.transactions, pendingLocalTransactions, 50)
      : current.transactions
    const nextRecentTransactions = patch.recentTransactions
      ? mergePendingTransactions(patch.recentTransactions, pendingLocalTransactions, 20)
      : current.recentTransactions
    const nextTodayTransactions = patch.todayTransactions
      ? mergePendingTransactions(patch.todayTransactions, pendingLocalTransactions, 50, true)
      : current.todayTransactions
    const next: OfflineEmployeeSnapshot = {
      ...current,
      ...patch,
      ...identity,
      transactions: nextTransactions,
      recentTransactions: nextRecentTransactions,
      todayTransactions: nextTodayTransactions,
      updatedAt: new Date().toISOString(),
    }
    await writeSnapshotUnlocked(next)
    return next
  })
}

/**
 * Adds a locally recorded transaction and deducts its cached stock immediately.
 */
export async function appendOfflineEmployeeTransaction(input: {
  identity: Pick<OfflineEmployeeSnapshot, 'businessId' | 'branchId' | 'employeeId'>
  transaction: EmployeeTransaction
  items: Array<{ optionId: string; baseQuantity: number }>
}): Promise<OfflineEmployeeSnapshot> {
  return withSnapshotWrite(async () => {
    const current = (await readEmployeeSnapshot(input.identity.businessId, input.identity.employeeId)) ?? createEmptySnapshot(input.identity)
    const products = current.products.map((product) => {
      const deduction = input.items
        .filter((item) => item.optionId === product.optionId)
        .reduce((sum, item) => sum + item.baseQuantity, 0)

      return deduction > 0
        ? { ...product, baseQuantityOnHand: Math.max(product.baseQuantityOnHand - deduction, 0), quantityOnHand: Math.max(Math.floor(product.baseQuantityOnHand - deduction), 0) }
        : product
    })

    const transactions = [input.transaction, ...current.transactions.filter((item) => item.id !== input.transaction.id)].slice(0, 50)
    const todayStart = new Date(input.transaction.recordedAt)
    todayStart.setHours(0, 0, 0, 0)
    const todayTransactions = transactions.filter((item) => new Date(item.recordedAt) >= todayStart).slice(0, 50)
    const next: OfflineEmployeeSnapshot = { ...current, ...input.identity, products, todayTransactions, recentTransactions: transactions.slice(0, 20), transactions, updatedAt: new Date().toISOString() }

    await writeSnapshotUnlocked(next)
    return next
  })
}

/**
 * Marks a queued transaction as synced without losing its original timestamp.
 */
export async function markOfflineEmployeeTransactionSynced(localId: string, serverId?: string): Promise<void> {
  try {
    const indexValue = await AsyncStorage.getItem(SNAPSHOT_INDEX_KEY)
    const keys = indexValue ? (JSON.parse(indexValue) as unknown) : []

    if (!Array.isArray(keys)) return

    await withSnapshotWrite(async () => {
      for (const key of keys) {
        if (typeof key !== 'string') continue
        const value = await AsyncStorage.getItem(key)
        if (!value) continue
        const parsed = JSON.parse(value) as unknown
        if (!isSnapshot(parsed)) continue

        const hasTransaction = parsed.transactions.some((transaction) => transaction.id === localId)
        if (!hasTransaction) continue

        const update = (transaction: EmployeeTransaction): EmployeeTransaction =>
          transaction.id === localId ? { ...transaction, id: serverId ?? transaction.id, status: 'pending_verify' } : transaction

        await writeSnapshotUnlocked({
          ...parsed,
          todayTransactions: parsed.todayTransactions.map(update),
          recentTransactions: parsed.recentTransactions.map(update),
          transactions: parsed.transactions.map(update),
        })
        return
      }
    })
  } catch {
    // A sync acknowledgement must never cause a successful remote sale to
    // become retryable and potentially duplicate.
  }
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

function isPendingLocalTransaction(transaction: EmployeeTransaction): boolean {
  return transaction.id.startsWith('offline-') && transaction.status === 'pending_sync'
}

function mergePendingTransactions(
  remoteTransactions: EmployeeTransaction[],
  pendingLocalTransactions: EmployeeTransaction[],
  limit: number,
  todayOnly = false,
): EmployeeTransaction[] {
  const merged = [...pendingLocalTransactions, ...remoteTransactions]
    .filter((transaction) => !todayOnly || isSameLocalDay(transaction.recordedAt, new Date()))
    .filter((transaction, index, all) => all.findIndex((candidate) => candidate.id === transaction.id) === index)
    .sort((left, right) => new Date(right.recordedAt).getTime() - new Date(left.recordedAt).getTime())

  return merged.slice(0, limit)
}

function isSameLocalDay(value: string, reference: Date): boolean {
  const date = new Date(value)
  return (
    date.getFullYear() === reference.getFullYear() &&
    date.getMonth() === reference.getMonth() &&
    date.getDate() === reference.getDate()
  )
}

async function writeSnapshotUnlocked(snapshot: OfflineEmployeeSnapshot): Promise<void> {
  const key = snapshotKey(snapshot.businessId, snapshot.employeeId)

  try {
    await AsyncStorage.setItem(key, JSON.stringify({ ...snapshot, updatedAt: new Date().toISOString() }))
    await rememberSnapshotKey(key)
  } catch {
    // Snapshot persistence is best-effort; live and queued workflows continue.
  }
}

export function createOfflineTransactionId(): string {
  return `offline-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}
