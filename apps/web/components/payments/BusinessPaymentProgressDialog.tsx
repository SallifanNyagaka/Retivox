'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '../../lib/supabase/client'

type AttemptStatus = {
  payment_id: string
  amount: number | string
  payment_method: string
  status: string
  confirmed_reference: string | null
  payment_at: string | null
  verified_at: string | null
}

type Props = {
  open: boolean
  initializing?: boolean
  paymentId?: string | null
  currency: string
  onClose: () => void
  onViewTransactions: () => void
}

function money(value: number | string, currency: string) {
  const amount = Number(value)
  if (!Number.isFinite(amount)) return '—'
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount)
  } catch {
    return `${currency} ${amount.toFixed(2)}`
  }
}

/**
 * Watches a saved attempt only. It never initiates a retry or treats a cached
 * result as settlement; the tenant-scoped Supabase RPC is the source of truth.
 */
export default function BusinessPaymentProgressDialog({
  open,
  initializing = false,
  paymentId,
  currency,
  onClose,
  onViewTransactions,
}: Props) {
  const [attempt, setAttempt] = useState<AttemptStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [readError, setReadError] = useState(false)

  const refresh = useCallback(async () => {
    if (!paymentId) return
    setLoading(true)
    try {
      const client = createClient()
      const { data, error } = await client.rpc('business_payment_attempt_status', {
        p_payment_id: paymentId,
      })
      if (error) throw error
      const row = Array.isArray(data) ? data[0] : data
      if (!row || typeof row !== 'object') throw new Error('Payment status unavailable')
      setAttempt(row as AttemptStatus)
      setReadError(false)
    } catch {
      setReadError(true)
    } finally {
      setLoading(false)
    }
  }, [paymentId])

  useEffect(() => {
    if (!open || !paymentId) {
      setAttempt(null)
      setReadError(false)
      return
    }
    void refresh()
    const timer = window.setInterval(() => void refresh(), 3000)
    return () => window.clearInterval(timer)
  }, [open, paymentId, refresh])

  if (!open) return null

  const status = attempt?.status.toLowerCase() ?? ''
  const confirmed = status === 'verified' || status === 'succeeded'
  const failed = status === 'rejected' || status === 'failed'
  const manualReview = status === 'pending_verify' || status === 'awaiting_manual_verification'
  const title = !paymentId
    ? 'Preparing payment...'
    : confirmed
      ? 'Payment successful'
      : failed
        ? 'Payment unsuccessful'
        : manualReview
          ? 'Awaiting verification'
          : 'Check your phone'
  const detail = !paymentId
    ? 'Saving the sale and preparing a secure M-PESA prompt.'
    : confirmed
      ? 'Safaricom has confirmed this payment. Retivox has recorded the verified result.'
      : failed
        ? 'The provider reported that this attempt failed. The sale is still available for review.'
        : manualReview
          ? 'This payment needs an authorized business user to verify the received funds.'
          : 'Enter your M-PESA PIN to complete payment. Retivox is waiting for provider confirmation.'

  return (
    <div
      role="presentation"
      style={{ position: 'fixed', inset: 0, zIndex: 110, display: 'grid', placeItems: 'center', padding: 18, background: 'rgba(15, 23, 42, .56)' }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="payment-progress-title"
        aria-describedby="payment-progress-detail"
        style={{ width: 'min(100%, 440px)', borderRadius: 18, padding: 24, background: 'var(--color-surface, #fff)', color: 'var(--color-text-primary, #172033)', boxShadow: '0 24px 80px rgba(0,0,0,.24)' }}
      >
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 18 }}>
          {confirmed ? (
            <div aria-hidden="true" style={{ display: 'grid', placeItems: 'center', width: 58, height: 58, borderRadius: '50%', color: '#067647', background: '#dcfae6', fontSize: 29, fontWeight: 800 }}>✓</div>
          ) : failed ? (
            <div aria-hidden="true" style={{ display: 'grid', placeItems: 'center', width: 58, height: 58, borderRadius: '50%', color: '#b42318', background: '#fee4e2', fontSize: 27, fontWeight: 800 }}>!</div>
          ) : (
            <div aria-hidden="true" className="animate-spin" style={{ width: 52, height: 52, border: '4px solid #d1fae5', borderTopColor: '#087f5b', borderRadius: '50%' }} />
          )}
        </div>
        <h2 id="payment-progress-title" style={{ margin: 0, textAlign: 'center', fontSize: 20, fontWeight: 800 }}>{title}</h2>
        <p id="payment-progress-detail" style={{ margin: '9px 0 0', textAlign: 'center', lineHeight: 1.55, color: 'var(--color-text-muted, #667085)', fontSize: 14 }}>{detail}</p>
        {attempt && (
          <dl style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '9px 16px', margin: '22px 0 0', padding: 14, borderRadius: 12, background: 'var(--color-background, #f8fafc)', fontSize: 13 }}>
            <dt style={{ color: 'var(--color-text-muted, #667085)' }}>Amount</dt><dd style={{ margin: 0, fontWeight: 700 }}>{money(attempt.amount, currency)}</dd>
            <dt style={{ color: 'var(--color-text-muted, #667085)' }}>Method</dt><dd style={{ margin: 0, fontWeight: 700 }}>{attempt.payment_method.replaceAll('_', ' ')}</dd>
            <dt style={{ color: 'var(--color-text-muted, #667085)' }}>Status</dt><dd style={{ margin: 0, fontWeight: 700, textTransform: 'capitalize' }}>{status.replaceAll('_', ' ')}</dd>
            {confirmed && attempt.confirmed_reference && <><dt style={{ color: 'var(--color-text-muted, #667085)' }}>Confirmed reference</dt><dd style={{ margin: 0, fontWeight: 700, overflowWrap: 'anywhere' }}>{attempt.confirmed_reference}</dd></>}
            {confirmed && attempt.verified_at && <><dt style={{ color: 'var(--color-text-muted, #667085)' }}>Confirmed at</dt><dd style={{ margin: 0, fontWeight: 700 }}>{new Date(attempt.verified_at).toLocaleString()}</dd></>}
          </dl>
        )}
        {readError && <p role="status" style={{ margin: '12px 0 0', color: '#b54708', fontSize: 12 }}>Status could not be refreshed just now. The payment remains saved; check again in a moment.</p>}
        {failed && <p style={{ margin: '12px 0 0', color: 'var(--color-text-muted, #667085)', fontSize: 12, lineHeight: 1.5 }}>Do not record the sale again. Review its payment in Transactions before collecting another payment.</p>}
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 9, marginTop: 22 }}>
          {paymentId && !confirmed && !failed && !manualReview && <button type="button" className="btn-outline" onClick={() => void refresh()} disabled={loading} style={{ borderRadius: 9, padding: '9px 13px' }}>{loading ? 'Checking…' : 'Check status'}</button>}
          {paymentId && <button type="button" className="btn-outline" onClick={onClose} style={{ borderRadius: 9, padding: '9px 13px' }}>Close</button>}
          {(confirmed || failed || manualReview) && <button type="button" className="btn-primary" onClick={onViewTransactions} style={{ borderRadius: 9, padding: '9px 13px' }}>View transactions</button>}
        </div>
      </section>
    </div>
  )
}
