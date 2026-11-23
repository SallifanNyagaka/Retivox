'use client'

import { useActionState, useEffect } from 'react'
import { Card, CardHeader } from '../../../../../components/ui/Card'
import { Badge } from '../../../../../components/ui/Badge'
import type { PaymentProviderFormState } from './actions'
import { saveBusinessPaymentMethod } from './actions'

export type BusinessPaymentMethod = {
  id: string
  method_code: 'mpesa_manual' | 'bank_transfer' | 'card' | 'other'
  account_type: 'buy_goods' | 'paybill' | 'pochi' | 'bank_account' | 'other'
  display_name: string
  merchant_number: string | null
  account_reference: string | null
  instructions: string
  is_active: boolean
  is_default: boolean
  configuration_version: number
  updated_at: string
}

const initialState: PaymentProviderFormState = { success: false, error: null }
const labelStyle = { display: 'grid', gap: 6, color: 'var(--color-text-primary)', fontSize: 12, fontWeight: 700 } as const
const inputStyle = { width: '100%', minHeight: 40, border: '1px solid var(--color-border)', borderRadius: 8, padding: '8px 10px', background: 'var(--color-background)', color: 'var(--color-text-primary)', fontSize: 13 } as const

export default function BusinessPaymentMethods({ methods }: { methods: BusinessPaymentMethod[] }) {
  return (
    <Card padding="md">
      <CardHeader title="Manual payment instructions" action={<Badge variant={methods.some((item) => item.is_active) ? 'success' : 'warning'}>{methods.filter((item) => item.is_active).length} active</Badge>} />
      <p style={{ margin: '0 0 16px', color: 'var(--color-text-muted)', fontSize: 13, lineHeight: 1.55 }}>
        Save the customer-facing details for manual M-PESA, Pochi, bank transfer, card-terminal, or other payments. These settings contain no API credentials. A reference entered by staff is still unverified until an authorized reviewer confirms it.
      </p>
      <div className="grid grid-cols-1 gap-3">
        {methods.map((method) => <MethodEditor key={method.id} method={method} />)}
        <MethodEditor />
      </div>
    </Card>
  )
}

function MethodEditor({ method }: { method?: BusinessPaymentMethod }) {
  const [state, action, pending] = useActionState(saveBusinessPaymentMethod, initialState)
  useEffect(() => {
    if (!state.success) return
    const timer = window.setTimeout(() => window.location.reload(), 500)
    return () => window.clearTimeout(timer)
  }, [state.success])

  const code = method?.method_code ?? 'mpesa_manual'
  const accountType = method?.account_type ?? 'buy_goods'
  return (
    <details open={!method} style={{ border: '1px solid var(--color-border)', borderRadius: 10, padding: 12 }}>
      <summary className="flex flex-wrap items-center justify-between gap-2" style={{ cursor: 'pointer', color: 'var(--color-text-primary)', fontWeight: 750, fontSize: 13 }}>
        <span>{method ? method.display_name : 'Add payment instructions'}</span>
        {method ? <Badge variant={method.is_active ? 'success' : 'warning'}>{method.is_default ? 'Default' : method.is_active ? 'Active' : 'Inactive'}</Badge> : null}
      </summary>
      <form action={action} className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
        <input type="hidden" name="methodId" value={method?.id ?? ''} />
        <label style={labelStyle}>Payment method
          <select name="methodCode" defaultValue={code} style={inputStyle}>
            <option value="mpesa_manual">M-PESA manual</option>
            <option value="bank_transfer">Bank transfer</option>
            <option value="card">Card terminal</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label style={labelStyle}>Account type
          <select name="accountType" defaultValue={accountType} style={inputStyle}>
            <option value="buy_goods">Buy Goods Till</option>
            <option value="paybill">Paybill</option>
            <option value="pochi">Pochi la Biashara</option>
            <option value="bank_account">Bank account</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label style={labelStyle}>Display name
          <input name="displayName" required maxLength={80} defaultValue={method?.display_name ?? ''} placeholder="e.g. Main shop Till" style={inputStyle} />
        </label>
        <label style={labelStyle}>Till, Paybill, phone or merchant number
          <input name="merchantNumber" maxLength={80} defaultValue={method?.merchant_number ?? ''} placeholder="Customer-facing destination" style={inputStyle} />
        </label>
        <label style={labelStyle}>Paybill account/reference
          <input name="accountReference" maxLength={80} defaultValue={method?.account_reference ?? ''} placeholder="Required for Paybill" style={inputStyle} />
        </label>
        <div className="flex flex-wrap items-center gap-4 self-end pb-2" style={{ color: 'var(--color-text-primary)', fontSize: 12 }}>
          <label className="flex items-center gap-2"><input type="checkbox" name="isActive" defaultChecked={method?.is_active ?? true} /> Available to staff</label>
          <label className="flex items-center gap-2"><input type="checkbox" name="isDefault" defaultChecked={method?.is_default ?? false} /> Default</label>
        </div>
        <label className="md:col-span-2" style={labelStyle}>Customer/staff instructions
          <textarea name="instructions" rows={3} maxLength={1000} defaultValue={method?.instructions ?? ''} placeholder="Describe the steps for the customer and the verification process for staff." style={{ ...inputStyle, minHeight: 82, resize: 'vertical' }} />
        </label>
        {state.error ? <p role="alert" className="md:col-span-2" style={{ margin: 0, color: 'var(--color-danger)', fontSize: 12 }}>{state.error}</p> : null}
        {state.success ? <p role="status" className="md:col-span-2" style={{ margin: 0, color: 'var(--color-success)', fontSize: 12 }}>{state.message}</p> : null}
        <button type="submit" disabled={pending} className="btn-primary md:col-span-2 md:justify-self-start" style={{ borderRadius: 8, padding: '9px 13px', opacity: pending ? 0.7 : 1 }}>
          {pending ? 'Saving…' : method ? 'Save payment instructions' : 'Add payment instructions'}
        </button>
      </form>
    </details>
  )
}
