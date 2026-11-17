'use client'

import { useActionState, useEffect } from 'react'
import { Card, CardHeader } from '../../../../../components/ui/Card'
import { Badge } from '../../../../../components/ui/Badge'
import type { PaymentProviderFormState } from './actions'
import { savePaymentProviderSettings, testPaymentProviderConnection } from './actions'

type ProviderName = 'daraja' | 'pesapal'

type ProviderSettings = {
  provider: ProviderName
  environment: 'sandbox' | 'production'
  business_shortcode: string | null
  account_reference: string
  transaction_type: string
  callback_url: string
  consumer_key_set: boolean
  consumer_secret_set: boolean
  passkey_set: boolean
  is_active: boolean
  updated_at: string
}

const initialState: PaymentProviderFormState = { success: false, error: null }
const inputStyle = {
  width: '100%',
  border: '1px solid var(--color-border)',
  borderRadius: 9,
  padding: '10px 12px',
  background: 'var(--color-background)',
  color: 'var(--color-text-primary)',
}
const labelStyle = { display: 'grid', gap: 7, color: 'var(--color-text-primary)', fontSize: 13, fontWeight: 700 }

export default function ProviderSettingsForm({
  provider,
  settings,
  defaultCallbackUrl,
}: {
  provider: ProviderName
  settings: ProviderSettings | null
  defaultCallbackUrl: string
}) {
  const [state, action, pending] = useActionState(savePaymentProviderSettings, initialState)
  const [testState, testAction, testPending] = useActionState(testPaymentProviderConnection, initialState)
  const isDaraja = provider === 'daraja'
  const credentialsSaved = Boolean(settings?.consumer_key_set && settings.consumer_secret_set && (!isDaraja || settings.passkey_set))

  useEffect(() => {
    if (state.success) {
      const timer = window.setTimeout(() => window.location.reload(), 800)
      return () => window.clearTimeout(timer)
    }
    return undefined
  }, [state.success])

  return (
    <Card padding="md">
      <CardHeader
        title={isDaraja ? 'Daraja STK Push' : 'Pesapal hosted checkout'}
        action={<Badge variant={credentialsSaved ? 'success' : 'warning'}>{credentialsSaved ? 'Credentials saved' : 'Setup needed'}</Badge>}
      />
      <form action={action} className="grid grid-cols-1 gap-4">
        <input type="hidden" name="provider" value={provider} />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label style={labelStyle}>
            Environment
            <select name="environment" defaultValue={settings?.environment ?? 'sandbox'} style={inputStyle}>
              <option value="sandbox">Sandbox</option>
              <option value="production">Production</option>
            </select>
          </label>
          {isDaraja ? (
            <label style={labelStyle}>
              PayBill or Till shortcode
              <input name="businessShortcode" defaultValue={settings?.business_shortcode ?? ''} required style={inputStyle} />
            </label>
          ) : (
            <label style={labelStyle}>
              Merchant account reference (optional)
              <input name="accountReference" defaultValue={settings?.account_reference ?? 'RETIVOX'} style={inputStyle} />
            </label>
          )}
          {isDaraja ? (
            <label style={labelStyle}>
              Account reference
              <input name="accountReference" defaultValue={settings?.account_reference ?? 'RETIVOX'} style={inputStyle} />
            </label>
          ) : null}
          {isDaraja ? (
            <label style={labelStyle}>
              Transaction type
              <select name="transactionType" defaultValue={settings?.transaction_type ?? 'CustomerPayBillOnline'} style={inputStyle}>
                <option value="CustomerPayBillOnline">PayBill</option>
                <option value="CustomerBuyGoodsOnline">Buy Goods Till</option>
              </select>
            </label>
          ) : null}
        </div>

        <label style={labelStyle}>
          {isDaraja ? 'STK callback URL' : 'Pesapal IPN callback URL'}
          <input name="callbackUrl" type="url" defaultValue={settings?.callback_url ?? defaultCallbackUrl} required style={inputStyle} />
        </label>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label style={labelStyle}>
            {isDaraja ? 'Consumer key' : 'Consumer key'}
            <input name="consumerKey" autoComplete="off" placeholder={settings?.consumer_key_set ? 'Saved securely; enter to replace' : 'Required for first setup'} style={inputStyle} />
          </label>
          <label style={labelStyle}>
            Consumer secret
            <input name="consumerSecret" type="password" autoComplete="new-password" placeholder={settings?.consumer_secret_set ? 'Saved securely; enter to replace' : 'Required for first setup'} style={inputStyle} />
          </label>
        </div>

        {isDaraja ? (
          <label style={labelStyle}>
            Lipa na M-Pesa passkey
            <input name="passkey" type="password" autoComplete="new-password" placeholder={settings?.passkey_set ? 'Saved securely; enter to replace' : 'Required for first setup'} style={inputStyle} />
          </label>
        ) : null}

        <p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: 12, lineHeight: 1.55 }}>
          Credentials are encrypted in Supabase Vault and never sent back to this form. Leave saved credential fields blank to keep the current value. {isDaraja ? 'Daraja prompts are available online and settle only after Safaricom status verification.' : 'After saving credentials, register the HTTPS IPN callback below. Checkout is available online and settles only after Retivox verifies the transaction directly with Pesapal.'}
        </p>
        {state.error ? <p role="alert" style={{ margin: 0, color: 'var(--color-danger)', fontSize: 13 }}>{state.error}</p> : null}
        {state.success ? <p role="status" style={{ margin: 0, color: 'var(--color-success)', fontSize: 13 }}>Settings saved securely.</p> : null}
        <button type="submit" className="btn-primary" disabled={pending} style={{ justifySelf: 'start', borderRadius: 9, padding: '10px 15px', opacity: pending ? 0.65 : 1 }}>
          {pending ? 'Saving...' : 'Save provider settings'}
        </button>
      </form>
      <form action={testAction} className="mt-3 flex flex-wrap items-center gap-3">
        <input type="hidden" name="provider" value={provider} />
        <button type="submit" className="btn-outline" disabled={testPending || !credentialsSaved} style={{ borderRadius: 9, padding: '9px 13px' }}>
          {testPending ? 'Testing connection...' : 'Test provider connection'}
        </button>
        {testState.error && <p role="alert" style={{ margin: 0, fontSize: 12, color: 'var(--color-danger)' }}>{testState.error}</p>}
        {testState.success && <p role="status" style={{ margin: 0, fontSize: 12, color: 'var(--color-success)' }}>{testState.message}</p>}
      </form>
    </Card>
  )
}

