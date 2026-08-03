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
  paymentMethod: 'mpesa_manual' | 'cash'
  discountAmount: number
  customerName: string | null
  customerPhone: string | null
  mpesaRefCode: string | null
  recordedAt: string
}

type OfflineEmployeeSale = OfflineEmployeeSaleInput & {
  id: string
  status: 'pending' | 'syncing' | 'synced' | 'needs_attention'
  createdAt: string
  syncedAt: string | null
  transactionId: string | null
  lastError: string | null
}

export type OfflineSaleSyncSummary = {
  synced: number
  needsAttention: number
}

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
export async function syncOfflineEmployeeSales(userId: string): Promise<OfflineSaleSyncSummary> {
  if (!navigator.onLine) {
    return { synced: 0, needsAttention: 0 }
  }

  const sales = await getSalesForUser(userId)
  const pendingSales = sales.filter((sale) => sale.status === 'pending' || sale.status === 'needs_attention')
  const supabase = createClient()
  let synced = 0
  let needsAttention = 0

  for (const sale of pendingSales) {
    await saveSale({ ...sale, status: 'syncing', lastError: null })

    const response = await supabase.rpc('employee_record_transaction_offline', {
      p_items: sale.items,
      p_payment_method: sale.paymentMethod,
      p_discount_amount: sale.discountAmount,
      p_customer_name: sale.customerName,
      p_customer_phone: sale.customerPhone,
      p_mpesa_ref_code: sale.mpesaRefCode,
      p_cash_deposit_code: null,
      p_recorded_at: sale.recordedAt,
      p_local_id: sale.id,
    })

    if (response.error) {
      await saveSale({
        ...sale,
        status: 'needs_attention',
        lastError: 'This saved sale needs review before it can be synced.',
      })
      needsAttention += 1
      continue
    }

    const result = Array.isArray(response.data) ? response.data[0] : response.data
    await saveSale({
      ...sale,
      status: 'synced',
      syncedAt: new Date().toISOString(),
      transactionId: result?.transaction_id ? String(result.transaction_id) : null,
      lastError: null,
    })
    synced += 1
  }

  return { synced, needsAttention }
}
