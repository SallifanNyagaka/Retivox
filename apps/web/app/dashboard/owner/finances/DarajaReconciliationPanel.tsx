'use client'

import { useActionState } from 'react'
import { Badge } from '../../../../components/ui/Badge'
import { Card, CardHeader } from '../../../../components/ui/Card'
import { reconcileDarajaC2BPayment, type FinanceFormState } from './actions'

export type UnmatchedDarajaReceipt = {
  id: string
  provider_transaction_id: string
  reference_code: string | null
  phone: string | null
  amount: number | string
  received_at: string
}

export type PendingMobilePayment = {
  id: string
  amount: number | string
  payment_at: string
  transactions: { branch_id: string | null; branches: { name: string } | { name: string }[] | null } | { branch_id: string | null; branches: { name: string } | { name: string }[] | null }[] | null
}

export default function DarajaReconciliationPanel({ receipts, payments, currency }: {
  receipts: UnmatchedDarajaReceipt[]
  payments: PendingMobilePayment[]
  currency: string
}) {
  return <Card padding="md">
    <CardHeader title="M-Pesa receipts to reconcile" action={<Badge variant={receipts.length ? 'warning' : 'success'}>{receipts.length} unmatched</Badge>} />
    <p style={{ margin: '0 0 14px', color: 'var(--color-text-muted)', fontSize: 13, lineHeight: 1.6 }}>
      Confirm each receipt in your M-Pesa statement before matching it. A match requires the pending sale payment to have the exact same amount and an accessible branch.
    </p>
    {receipts.length === 0 ? <p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: 13 }}>No C2B receipts are waiting for reconciliation.</p> : <div className="flex flex-col gap-3">{receipts.map((receipt) => <ReceiptRow key={receipt.id} receipt={receipt} payments={payments} currency={currency} />)}</div>}
  </Card>
}

function ReceiptRow({ receipt, payments, currency }: { receipt: UnmatchedDarajaReceipt; payments: PendingMobilePayment[]; currency: string }) {
  const [state, action, pending] = useActionState<FinanceFormState, FormData>(reconcileDarajaC2BPayment, { success: false, error: null })
  const matchingPayments = payments.filter((payment) => Math.round(Number(payment.amount) * 100) === Math.round(Number(receipt.amount) * 100))
  return <div className="grid grid-cols-1 gap-3 border-b pb-4 xl:grid-cols-[1fr_1.25fr]" style={{ borderColor: 'var(--color-border)' }}>
    <div><p style={{ margin: 0, color: 'var(--color-text-primary)', fontWeight: 800, fontSize: 14 }}>{receipt.provider_transaction_id} · {new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(Number(receipt.amount))}</p>
      <p style={{ margin: '4px 0 0', color: 'var(--color-text-muted)', fontSize: 12 }}>Bill reference: {receipt.reference_code || '—'} · Phone: {receipt.phone || 'not provided'}</p>
      <p style={{ margin: '3px 0 0', color: 'var(--color-text-muted)', fontSize: 11 }}>Received {new Date(receipt.received_at).toLocaleString()}</p></div>
    {matchingPayments.length === 0 ? <p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: 12, alignSelf: 'center' }}>No pending mobile sale payment has this amount. Review it manually and keep it unmatched until the sale is corrected.</p> :
      <form action={action} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="unmatchedPaymentId" value={receipt.id} />
        <label style={{ display: 'grid', flex: '1 1 260px', gap: 5, color: 'var(--color-text-primary)', fontSize: 12, fontWeight: 700 }}>
          Pending sale payment
          <select name="paymentId" required style={selectStyle}>
            <option value="">Select a sale</option>
            {matchingPayments.map((payment) => {
              const transaction = Array.isArray(payment.transactions) ? payment.transactions[0] : payment.transactions
              const branch = Array.isArray(transaction?.branches) ? transaction.branches[0] : transaction?.branches
              return <option key={payment.id} value={payment.id}>{branch?.name ?? 'Store'} · {new Date(payment.payment_at).toLocaleString()}</option>
            })}
          </select>
        </label>
        <button type="submit" className="btn-primary" disabled={pending} style={{ borderRadius: 9, padding: '10px 14px' }}>{pending ? 'Reconciling…' : 'Match receipt'}</button>
        {state.error && <p role="alert" style={{ flexBasis: '100%', margin: 0, color: 'var(--color-danger)', fontSize: 12 }}>{state.error}</p>}
        {state.success && <p role="status" style={{ flexBasis: '100%', margin: 0, color: 'var(--color-success)', fontSize: 12 }}>Receipt matched to the sale.</p>}
      </form>}
  </div>
}

const selectStyle = {
  width: '100%', height: 40, border: '1px solid var(--color-border)', borderRadius: 9,
  padding: '0 10px', color: 'var(--color-text-primary)', background: 'var(--color-background)', fontSize: 12,
}
