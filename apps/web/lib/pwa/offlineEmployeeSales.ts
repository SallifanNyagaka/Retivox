'use client'

import { createClient } from '../supabase/client'

export type OfflineEmployeeSaleItem = {
  productId: string
  uomId: string
  quantity: number
  recoveryItemId: string | null
}

export type OfflineEmployeeSaleInput = {
  userId: string
  items: OfflineEmployeeSaleItem[]
  paymentMethod: 'mpesa_manual' | 'cash' | 'card' | 'bank_transfer' | 'other'
  amountPaid: number | null
  amountTendered: number | null
  totalAmount: number
  isCredit: boolean
  discountAmount: number
  customerName: string | null
  customerPhone: string | null
  customerEmail: string | null
  dueDate: string | null
  mpesaRefCode: string | null
  manualPaymentMethodId?: string | null
  manualPaymentMethodVersion?: number | null
  recordedAt: string
}

type OfflineEmployeeSale = OfflineEmployeeSaleInput & {
  id: string
  status: 'pending' | 'syncing' | 'synced' | 'needs_attention' | 'cancelled'
  createdAt: string
  lastAttemptAt: string | null
  syncedAt: string | null
  transactionId: string | null
  lastError: string | null
}

export type OfflineSaleSyncSummary = {
  synced: number
  needsAttention: number
  pending: number
}

export type OfflineEmployeeSaleQueueItem = Pick<OfflineEmployeeSale,
  'id' | 'status' | 'createdAt' | 'lastAttemptAt' | 'transactionId' | 'lastError' | 'recordedAt' | 'paymentMethod' | 'amountPaid' | 'amountTendered' | 'totalAmount' | 'isCredit' | 'items'
>

const DATABASE_NAME = 'retivox-pwa'
const DATABASE_VERSION = 1
const STORE_NAME = 'offline_employee_sales'

function createLocalId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }

  return `sale-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)

    request.onerror = () => reject(request.error ?? new Error('Unable to open offline storage'))
    request.onupgradeneeded = () => {
      const database = request.result

      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: 'id' })
        store.createIndex('userId', 'userId', { unique: false })
        store.createIndex('status', 'status', { unique: false })
      }
    }
    request.onsuccess = () => resolve(request.result)
  })
}

async function withStore<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await openDatabase()

  return new Promise<T>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode)
    const request = work(transaction.objectStore(STORE_NAME))

    request.onerror = () => reject(request.error ?? new Error('Offline storage request failed'))
    request.onsuccess = () => resolve(request.result)
    transaction.oncomplete = () => database.close()
    transaction.onerror = () => {
      database.close()
      reject(transaction.error ?? new Error('Offline storage update failed'))
    }
  })
}

async function getSalesForUser(userId: string): Promise<OfflineEmployeeSale[]> {
  const database = await openDatabase()

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readonly')
    const request = transaction.objectStore(STORE_NAME).index('userId').getAll(userId)

    request.onerror = () => reject(request.error ?? new Error('Unable to read offline sales'))
    request.onsuccess = () => {
      database.close()
      resolve((request.result as OfflineEmployeeSale[]).sort((first, second) => first.createdAt.localeCompare(second.createdAt)))
    }
    transaction.onerror = () => {
      database.close()
      reject(transaction.error ?? new Error('Unable to read offline sales'))
    }
  })
}

async function saveSale(sale: OfflineEmployeeSale) {
  await withStore('readwrite', (store) => store.put(sale))
}

export async function listOfflineEmployeeSales(userId: string): Promise<OfflineEmployeeSaleQueueItem[]> {
  const sales = await getSalesForUser(userId)
  return sales
    .filter((sale) => sale.status !== 'synced' && sale.status !== 'cancelled')
    .map(({ id, status, createdAt, lastAttemptAt, transactionId, lastError, recordedAt, paymentMethod, amountPaid, amountTendered, totalAmount, isCredit, items }) => ({
      id, status, createdAt, lastAttemptAt, transactionId, lastError, recordedAt, paymentMethod, amountPaid, amountTendered, totalAmount, isCredit, items,
    }))
}

async function getSaleForUser(userId: string, id: string) {
  const sale = await withStore('readonly', (store) => store.get(id)) as OfflineEmployeeSale | undefined
  return sale?.userId === userId ? sale : null
}

async function updateSaleIf(
  userId: string,
  id: string,
  canUpdate: (sale: OfflineEmployeeSale) => boolean,
  update: (sale: OfflineEmployeeSale) => OfflineEmployeeSale,
) {
  const database = await openDatabase()
  return new Promise<OfflineEmployeeSale | null>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    const store = transaction.objectStore(STORE_NAME)
    let updated: OfflineEmployeeSale | null = null
    const request = store.get(id)

    request.onsuccess = () => {
      const sale = request.result as OfflineEmployeeSale | undefined
      if (!sale || sale.userId !== userId || !canUpdate(sale)) return
      updated = update(sale)
      store.put(updated)
    }
    request.onerror = () => reject(request.error ?? new Error('Unable to update offline sale'))
    transaction.oncomplete = () => {
      database.close()
      resolve(updated)
    }
    transaction.onerror = () => {
      database.close()
      reject(transaction.error ?? new Error('Unable to update offline sale'))
    }
    transaction.onabort = () => {
      database.close()
      reject(transaction.error ?? new Error('Offline sale update was interrupted'))
    }
  })
}

export async function cancelOfflineEmployeeSale(userId: string, id: string) {
  const sale = await updateSaleIf(
    userId,
    id,
    (current) => current.status === 'pending' || current.status === 'needs_attention',
    (current) => ({ ...current, status: 'cancelled', lastError: null }),
  )
  return sale !== null
}

/**
 * Keeps an employee sale locally until the same signed-in employee reconnects.
 * The UUID is sent to the database wrapper so a retry can never duplicate it.
 */
export async function queueOfflineEmployeeSale(input: OfflineEmployeeSaleInput) {
  const sale: OfflineEmployeeSale = {
    ...input,
    id: createLocalId(),
    status: 'pending',
    createdAt: new Date().toISOString(),
    lastAttemptAt: null,
    syncedAt: null,
    transactionId: null,
    lastError: null,
  }

  await saveSale(sale)
  return sale
}

/**
 * Sends pending offline employee sales through the existing idempotent RPC.
 */
export async function syncOfflineEmployeeSales(
  userId: string,
  options: { saleId?: string; force?: boolean } = {},
): Promise<OfflineSaleSyncSummary> {
  if (!navigator.onLine) {
    return { synced: 0, needsAttention: 0, pending: 0 }
  }

  const sales = await getSalesForUser(userId)
  const staleCutoff = Date.now() - 2 * 60 * 1000
  const pendingSales = sales.filter((sale) => {
    if (options.saleId && sale.id !== options.saleId) return false
    if (sale.status === 'pending') return true
    if (sale.status === 'needs_attention') return Boolean(options.force)
    return sale.status === 'syncing' && (!sale.lastAttemptAt || Date.parse(sale.lastAttemptAt) < staleCutoff)
  })
  const supabase = createClient()
  let synced = 0
  let needsAttention = 0

  for (const sale of pendingSales) {
    const { data: sessionData } = await supabase.auth.getSession()
    if (sessionData.session?.user.id !== userId) break

    const attemptAt = new Date().toISOString()
    const claimed = await updateSaleIf(
      userId,
      sale.id,
      (current) => {
        if (current.status === 'pending') return true
        if (current.status === 'needs_attention') return Boolean(options.force)
        return current.status === 'syncing' && current.lastAttemptAt === sale.lastAttemptAt &&
          (!current.lastAttemptAt || Date.parse(current.lastAttemptAt) < staleCutoff)
      },
      (current) => ({ ...current, status: 'syncing', lastAttemptAt: attemptAt, lastError: null }),
    )
    if (!claimed) continue

    try {
      const response = await supabase.rpc('employee_record_transaction_offline_with_payment_method_v1', {
        p_items: claimed.items,
        p_payment_method: claimed.paymentMethod,
        p_amount_paid: claimed.amountPaid ?? null,
        p_amount_tendered: claimed.amountTendered ?? null,
        p_customer_email: claimed.customerEmail ?? null,
        p_due_date: claimed.dueDate ?? null,
        p_is_credit: claimed.isCredit ?? false,
        p_discount_amount: claimed.discountAmount,
        p_customer_name: claimed.customerName,
        p_customer_phone: claimed.customerPhone,
        p_reference_code: claimed.mpesaRefCode,
        p_recorded_at: claimed.recordedAt,
        p_local_id: claimed.id,
        p_manual_payment_method_id: claimed.manualPaymentMethodId ?? null,
        p_manual_payment_method_version: claimed.manualPaymentMethodVersion ?? null,
      })

      if (response.error) {
        const message = response.error.message || 'Sale sync failed.'
        const errorStatus = 'status' in response.error ? Number(response.error.status) : NaN
        const transient =
          !navigator.onLine ||
          errorStatus >= 500 ||
          /fetch|network|timeout|temporar|connection|aborted|jwt|session expired|unauthorized|not authenticated/i.test(message)
        await saveSale({
          ...claimed,
          status: transient ? 'pending' : 'needs_attention',
          lastError: transient
            ? 'Connection interrupted. Retivox will retry this saved sale.'
            : message.slice(0, 300),
        })
        if (!transient) needsAttention += 1
        continue
      }

      const result = Array.isArray(response.data) ? response.data[0] : response.data
      await saveSale({
        ...claimed,
        status: 'synced',
        syncedAt: new Date().toISOString(),
        transactionId: result?.transaction_id ? String(result.transaction_id) : null,
        lastError: null,
      })
      synced += 1
    } catch (error) {
      await saveSale({
        ...claimed,
        status: 'pending',
        lastError: error instanceof Error ? error.message.slice(0, 300) : 'Connection interrupted. Retivox will retry this saved sale.',
      })
    }
  }

  const remaining = (await getSalesForUser(userId)).filter((sale) => sale.status === 'pending' || sale.status === 'syncing')
  return { synced, needsAttention, pending: remaining.length }
}

export async function retryOfflineEmployeeSale(userId: string, id: string) {
  const sale = await getSaleForUser(userId, id)
  if (!sale || sale.status === 'synced' || sale.status === 'cancelled') {
    return { synced: 0, needsAttention: 0, pending: 0 }
  }
  if (sale.status === 'needs_attention') {
    await updateSaleIf(
      userId,
      id,
      (current) => current.status === 'needs_attention',
      (current) => ({ ...current, status: 'pending', lastError: null }),
    )
  }
  return syncOfflineEmployeeSales(userId, { saleId: id, force: true })
}
