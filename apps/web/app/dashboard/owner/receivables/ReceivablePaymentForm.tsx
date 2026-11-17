'use client'

import { useActionState, useEffect, useState } from 'react'
import { recordReceivablePayment, type ReceivablePaymentState } from './actions'

const initialState: ReceivablePaymentState = { success: false, error: null }

export default function ReceivablePaymentForm({ receivableId, balance }: { receivableId: string; balance: number }) {
  const [state, action, pending] = useActionState(recordReceivablePayment, initialState)
  const [requestId, setRequestId] = useState(() => crypto.randomUUID())
  useEffect(() => {
    if (state.success) setRequestId(crypto.randomUUID())
  }, [state])
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="receivableId" value={receivableId} />
      <input type="hidden" name="requestId" value={requestId} />
      <label className="flex flex-col gap-1 text-xs">Amount (balance {balance.toLocaleString(undefined, { minimumFractionDigits: 2 })})
        <input name="amount" type="number" min="0.01" step="0.01" required className="rounded border px-2 py-2" />
      </label>
      <label className="flex flex-col gap-1 text-xs">Method
        <select name="paymentMethod" className="rounded border px-2 py-2">
          <option value="cash">Cash</option><option value="mpesa_manual">M-Pesa manual</option>
          <option value="card">Card</option><option value="bank_transfer">Bank transfer</option><option value="other">Other</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs">Cash received / reference
        <input name="amountTendered" type="number" min="0" step="0.01" placeholder="Cash tendered" className="rounded border px-2 py-2" />
      </label>
      <label className="flex flex-col gap-1 text-xs">Reference (M-Pesa)
        <input name="referenceCode" className="rounded border px-2 py-2" />
      </label>
      <button disabled={pending} className="btn-primary rounded px-3 py-2 text-sm">{pending ? 'Saving…' : 'Record payment'}</button>
      {state.error && <p role="alert" className="w-full text-sm text-red-600">{state.error}</p>}
      {state.message && <p role="status" className="w-full text-sm text-green-700">{state.message}</p>}
    </form>
  )
}
