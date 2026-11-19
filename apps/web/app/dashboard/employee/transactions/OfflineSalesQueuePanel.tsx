'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  cancelOfflineEmployeeSale,
  listOfflineEmployeeSales,
  retryOfflineEmployeeSale,
  type OfflineEmployeeSaleQueueItem,
} from '../../../../lib/pwa/offlineEmployeeSales'
import { createClient } from '../../../../lib/supabase/client'

function money(value: number, currency: string) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(value)
}

export default function OfflineSalesQueuePanel({ userId, currency }: { userId: string; currency: string }) {
  const [sales, setSales] = useState<OfflineEmployeeSaleQueueItem[]>([])
  const [busyId, setBusyId] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [online, setOnline] = useState(false)

  const refresh = useCallback(async () => {
    try {
      setSales(await listOfflineEmployeeSales(userId))
      setMessage(null)
    } catch {
      setMessage('Saved offline sales could not be read from this browser.')
    } finally {
      setLoading(false)
    }
  }, [userId])

  useEffect(() => {
    setOnline(navigator.onLine)
    void refresh()
    const update = () => {
      setOnline(navigator.onLine)
      void refresh()
    }
    window.addEventListener('online', update)
    window.addEventListener('retivox:offline-sales-synced', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('retivox:offline-sales-synced', update)
    }
  }, [refresh])

  async function forceSync(saleId: string) {
    setBusyId(saleId)
    setMessage(null)
    try {
      const { data } = await createClient().auth.getSession()
      if (data.session?.user.id !== userId) {
        setMessage('Sign in as the employee who recorded these sales before syncing them.')
        return
      }
      const result = await retryOfflineEmployeeSale(userId, saleId)
      setMessage(result.synced ? 'Sale synced successfully.' : result.needsAttention ? 'The server rejected this sale. Review the details before trying again.' : 'Sale remains saved and will retry when the connection is available.')
      window.dispatchEvent(new Event('retivox:offline-sales-synced'))
      await refresh()
    } catch {
      setMessage('Sync could not complete. The sale remains saved on this device.')
    } finally {
      setBusyId(null)
    }
  }

  async function cancel(saleId: string) {
    if (!window.confirm('Cancel this saved sale? It will remain in this browser as cancelled and will not be synced.')) return
    setBusyId(saleId)
    try {
      const cancelled = await cancelOfflineEmployeeSale(userId, saleId)
      setMessage(cancelled ? 'Saved sale cancelled.' : 'This sale is currently syncing or has already been completed.')
      await refresh()
    } catch {
      setMessage('Could not cancel the saved sale.')
    } finally {
      setBusyId(null)
    }
  }

  if (loading || (sales.length === 0 && !message)) return null

  return (
    <section className="w-full rounded-xl border p-4 text-left" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }} aria-label="Offline sales waiting to sync">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold" style={{ color: 'var(--color-text-primary)' }}>Saved sales waiting to sync ({sales.length})</h2>
          <p className="mt-1 text-sm" style={{ color: 'var(--color-text-muted)' }}>These sales are stored for this signed-in employee on this device.</p>
        </div>
        <button type="button" className="btn-outline" onClick={() => void refresh()} style={{ padding: '8px 14px', borderRadius: 8 }}>Refresh</button>
      </div>
      {message && <p role="status" className="mt-3 text-sm" style={{ color: 'var(--color-danger)' }}>{message}</p>}
      {sales.length > 0 && (
        <ul className="mt-3 divide-y" style={{ borderColor: 'var(--color-border)' }}>
          {sales.map((sale) => (
            <li key={sale.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="font-medium" style={{ color: 'var(--color-text-primary)' }}>
                  {sale.items.length} item{sale.items.length === 1 ? '' : 's'} · {sale.paymentMethod.replaceAll('_', ' ')} · {money(Number.isFinite(sale.totalAmount) ? sale.totalAmount : sale.amountPaid ?? 0, currency)}
                </p>
                <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
                  {new Date(sale.recordedAt).toLocaleString()} · {sale.status.replaceAll('_', ' ')}
                  {sale.lastError ? ` · ${sale.lastError}` : ''}
                </p>
              </div>
              <div className="flex gap-2">
                <button type="button" className="btn-primary" disabled={busyId !== null || !online} onClick={() => void forceSync(sale.id)} style={{ padding: '7px 12px', borderRadius: 8 }}>
                  {busyId === sale.id ? 'Working…' : 'Force sync'}
                </button>
                <button type="button" className="btn-outline" disabled={busyId !== null || sale.status === 'syncing'} onClick={() => void cancel(sale.id)} style={{ padding: '7px 12px', borderRadius: 8 }}>Cancel</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
