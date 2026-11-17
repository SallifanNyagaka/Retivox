'use client'

import { useState } from 'react'
import { recordManualPaymentRefund, requestPaymentRefund, reviewPaymentRefund } from './actions'

type PaymentOption = { id: string; transaction_id: string; amount: number | string; refunded_amount: number | string; payment_method: string; status: string; provider: string | null; provider_transaction_id: string | null }
type RefundRow = { id: string; payment_id: string; transaction_id: string; amount: number | string; reason: string; status: string; created_at: string; review_note: string | null; provider_submission_at: string | null; provider_submission_message: string | null }

export default function PaymentRefundPanel({ payments, requests, currency }: { payments: PaymentOption[]; requests: RefundRow[]; currency: string }) {
  const [message, setMessage] = useState<{ text: string; success: boolean } | null>(null)
  const money = (amount: number | string) => `${currency} ${Number(amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const run = (action: (data: FormData) => Promise<{ success: boolean; error?: string | null; message?: string }>) => async (data: FormData) => {
    setMessage(null)
    const result = await action(data)
    setMessage({ text: result.success ? result.message ?? 'Saved.' : result.error ?? 'Unable to save.', success: result.success })
  }

  return <section className="rounded-xl border p-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
    <div className="mb-4"><h2 className="m-0 text-base font-bold" style={{ color: 'var(--color-text-primary)' }}>Payment refunds</h2><p className="mb-0 mt-1 text-sm" style={{ color: 'var(--color-text-muted)' }}>Refund requests are audited. Only captured, verified payment amounts can be requested.</p></div>
    {message ? <p role={message.success ? 'status' : 'alert'} className="text-sm" style={{ color: message.success ? 'var(--color-success)' : 'var(--color-danger)' }}>{message.text}</p> : null}
    <form action={run(requestPaymentRefund)} className="mb-5 grid grid-cols-1 gap-3 rounded-lg border p-3 md:grid-cols-[2fr_1fr_2fr_auto]" style={{ borderColor: 'var(--color-border)' }}>
      <label className="flex flex-col gap-1 text-xs">Verified payment<select name="paymentId" required className="rounded-md border p-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-background)', color: 'var(--color-text-primary)' }}><option value="">Choose a payment</option>{payments.map(payment => <option key={payment.id} value={payment.id}>{payment.payment_method}{payment.provider === 'pesapal' ? ' · Pesapal' : ''} · {money(Number(payment.amount) - Number(payment.refunded_amount))} remaining · {payment.transaction_id.slice(0, 8)}</option>)}</select></label>
      <label className="flex flex-col gap-1 text-xs">Refund amount<input name="amount" type="number" min="0.01" step="0.01" required className="rounded-md border p-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-background)', color: 'var(--color-text-primary)' }} /></label>
      <label className="flex flex-col gap-1 text-xs">Reason<input name="reason" minLength={5} maxLength={240} required className="rounded-md border p-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-background)', color: 'var(--color-text-primary)' }} /></label>
      <button className="btn-primary self-end" type="submit">Request refund</button>
    </form>
    {requests.length ? <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead><tr style={{ color: 'var(--color-text-muted)' }}><th className="p-2">Sale</th><th className="p-2">Amount</th><th className="p-2">Reason / status</th><th className="p-2">Requested</th><th className="p-2">Actions</th></tr></thead><tbody>
      {requests.map(request => {
        const payment = payments.find(item => item.id === request.payment_id)
        return <tr key={request.id} className="border-t" style={{ borderColor: 'var(--color-border)' }}>
          <td className="p-2">{request.transaction_id.slice(0, 8)}</td><td className="p-2">{money(request.amount)}</td>
          <td className="p-2">{request.reason}<div className="text-xs capitalize" style={{ color: 'var(--color-text-muted)' }}>{request.status}{request.review_note ? ` · ${request.review_note}` : ''}</div>
            {request.provider_submission_message && <div className="mt-1 max-w-md text-xs" style={{ color: 'var(--color-warning)' }}>{request.provider_submission_message}</div>}
          </td>
          <td className="p-2">{new Date(request.created_at).toLocaleDateString()}</td>
          <td className="p-2"><div className="flex flex-wrap gap-2">
            {request.status === 'requested' ? <><form action={run(reviewPaymentRefund)}><input type="hidden" name="refundRequestId" value={request.id} /><input type="hidden" name="approved" value="true" /><button className="btn-outline" type="submit">Approve</button></form><form action={run(reviewPaymentRefund)}><input type="hidden" name="refundRequestId" value={request.id} /><input type="hidden" name="approved" value="false" /><button className="btn-outline" type="submit">Reject</button></form></> : null}
            {request.status === 'approved' && payment?.provider === 'pesapal' ? <form action={run(recordManualPaymentRefund)}><input type="hidden" name="refundRequestId" value={request.id} /><button className="btn-outline" type="submit">Submit to Pesapal</button></form> : null}
            {request.status === 'approved' && payment?.provider !== 'pesapal' ? <form action={run(recordManualPaymentRefund)} className="flex gap-1"><input type="hidden" name="refundRequestId" value={request.id} /><input name="reference" placeholder="Refund reference (optional)" className="w-40 rounded border p-1" style={{ borderColor: 'var(--color-border)', background: 'var(--color-background)', color: 'var(--color-text-primary)' }} /><button className="btn-outline" type="submit">Record completed</button></form> : null}
            {request.status === 'processing' ? <form action={run(recordManualPaymentRefund)} className="flex gap-1"><input type="hidden" name="refundRequestId" value={request.id} /><input name="reference" required minLength={3} placeholder="Confirmed refund reference" className="w-44 rounded border p-1" style={{ borderColor: 'var(--color-border)', background: 'var(--color-background)', color: 'var(--color-text-primary)' }} /><button className="btn-outline" type="submit">Confirm completed</button></form> : null}
          </div></td>
        </tr>
      })}
    </tbody></table></div> : <p className="m-0 text-sm" style={{ color: 'var(--color-text-muted)' }}>No refund requests yet.</p>}
  </section>
}
