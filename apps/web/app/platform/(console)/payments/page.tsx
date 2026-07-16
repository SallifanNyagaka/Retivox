import { Badge } from '../../../../components/ui/Badge'
import { Card, CardHeader } from '../../../../components/ui/Card'
import { createServiceRoleClient } from '../../../../lib/supabase/admin'
import { updatePlatformPaymentSettings } from '../actions'

export const dynamic = 'force-dynamic'

type PaymentSettingsRow = {
  id: string
  environment: 'sandbox' | 'production'
  business_shortcode: string
  account_reference: string
  transaction_type: string
  callback_url: string
  consumer_key: string | null
  consumer_secret: string | null
  passkey: string | null
  is_active: boolean
  updated_at: string
}

function maskSecret(value: string | null) {
  if (!value) return 'Not set'
  if (value.length <= 6) return 'Set'
  return `${value.slice(0, 3)}...${value.slice(-3)}`
}

export default async function PlatformPaymentsPage() {
  const serviceClient = createServiceRoleClient()
  const { data, error } = await serviceClient
    .from('platform_payment_settings')
    .select('id, environment, business_shortcode, account_reference, transaction_type, callback_url, consumer_key, consumer_secret, passkey, is_active, updated_at')
    .eq('provider', 'daraja')
    .eq('is_active', true)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    return (
      <Card padding="md">
        <CardHeader title="M-Pesa setup needed" />
        <p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: 14 }}>
          Apply migration 049_platform_operations_console.sql to manage the platform receiving account here.
        </p>
      </Card>
    )
  }

  const settings = data as PaymentSettingsRow | null

  return (
    <div className="flex flex-col gap-6">
      <section
        className="rounded-3xl"
        style={{
          background: 'linear-gradient(135deg, #283b35 0%, #d6a143 140%)',
          color: '#fff8ec',
          padding: 28,
          boxShadow: '0 24px 60px rgba(31,45,39,0.16)',
        }}
      >
        <p style={{ margin: 0, color: 'rgba(255,248,236,0.72)', fontSize: 12, fontWeight: 850, textTransform: 'uppercase' }}>
          Payment receiving account
        </p>
        <h1 style={{ margin: '10px 0 0', fontSize: 32, fontWeight: 950, letterSpacing: '-0.05em' }}>
          Lipa na M-Pesa settings
        </h1>
        <p style={{ margin: '10px 0 0', maxWidth: 720, color: 'rgba(255,248,236,0.76)', fontSize: 14, lineHeight: 1.7 }}>
          This is the Daraja receiving account used by Retivox subscription STK Push requests. Environment variables remain a fallback.
        </p>
      </section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.25fr_0.75fr]">
        <Card padding="md">
          <CardHeader title="Update receiving account" />
          <form action={updatePlatformPaymentSettings} className="grid grid-cols-1 gap-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <label style={labelStyle}>
                Environment
                <select name="environment" defaultValue={settings?.environment ?? 'sandbox'} style={inputStyle}>
                  <option value="sandbox">Sandbox</option>
                  <option value="production">Production</option>
                </select>
              </label>
              <label style={labelStyle}>
                Business shortcode / Paybill / Till
                <input name="businessShortcode" defaultValue={settings?.business_shortcode ?? ''} required style={inputStyle} />
              </label>
              <label style={labelStyle}>
                Account reference
                <input name="accountReference" defaultValue={settings?.account_reference ?? 'RETIVOX'} required style={inputStyle} />
              </label>
              <label style={labelStyle}>
                Transaction type
                <select name="transactionType" defaultValue={settings?.transaction_type ?? 'CustomerPayBillOnline'} style={inputStyle}>
                  <option value="CustomerPayBillOnline">CustomerPayBillOnline</option>
                  <option value="CustomerBuyGoodsOnline">CustomerBuyGoodsOnline</option>
                </select>
              </label>
            </div>

            <label style={labelStyle}>
              Callback URL
              <input name="callbackUrl" type="url" defaultValue={settings?.callback_url ?? process.env.DARAJA_CALLBACK_URL ?? ''} required style={inputStyle} />
            </label>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <label style={labelStyle}>
                Consumer key
                <input name="consumerKey" defaultValue={settings?.consumer_key ?? ''} placeholder="Optional if env is set" style={inputStyle} />
              </label>
              <label style={labelStyle}>
                Consumer secret
                <input name="consumerSecret" type="password" placeholder={settings?.consumer_secret ? 'Saved secret' : 'Optional if env is set'} style={inputStyle} />
              </label>
              <label style={labelStyle}>
                Passkey
                <input name="passkey" type="password" placeholder={settings?.passkey ? 'Saved passkey' : 'Optional if env is set'} style={inputStyle} />
              </label>
            </div>

            <button type="submit" className="btn-primary" style={{ borderRadius: 10, padding: '10px 16px', justifySelf: 'start' }}>
              Save M-Pesa account
            </button>
          </form>
        </Card>

        <Card padding="md">
          <CardHeader title="Current receiver" action={<Badge variant={settings?.is_active ? 'success' : 'warning'}>{settings ? 'Configured' : 'Env fallback'}</Badge>} />
          <div className="flex flex-col gap-3" style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>
            <Info label="Environment" value={settings?.environment ?? process.env.DARAJA_ENV ?? 'sandbox'} />
            <Info label="Shortcode" value={settings?.business_shortcode ?? process.env.DARAJA_SHORTCODE ?? 'Not set'} />
            <Info label="Account reference" value={settings?.account_reference ?? 'RETIVOX'} />
            <Info label="Callback URL" value={settings?.callback_url ?? process.env.DARAJA_CALLBACK_URL ?? 'Not set'} />
            <Info label="Consumer key" value={maskSecret(settings?.consumer_key ?? process.env.DARAJA_CONSUMER_KEY ?? null)} />
            <Info label="Consumer secret" value={maskSecret(settings?.consumer_secret ?? process.env.DARAJA_CONSUMER_SECRET ?? null)} />
            <Info label="Passkey" value={maskSecret(settings?.passkey ?? process.env.DARAJA_PASSKEY ?? null)} />
          </div>
        </Card>
      </div>

      <Card padding="md">
        <CardHeader title="PayBill prompt flow" action={<Badge variant="info">Step by step</Badge>} />
        <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
          {[
            ['1', 'Save PayBill', 'Set shortcode, account reference, callback URL, and Daraja credentials.'],
            ['2', 'Owner enters phone', 'The owner types a Kenyan phone number in subscription settings.'],
            ['3', 'Token + password', 'Retivox gets OAuth token and builds the Daraja timestamp password.'],
            ['4', 'STK request', 'Daraja receives BusinessShortCode, PartyB, AccountReference, and amount.'],
            ['5', 'Callback verifies', 'Safaricom posts the result to /api/daraja/stk-callback and Retivox marks paid or failed.'],
          ].map(([step, title, body]) => (
            <div
              key={step}
              className="rounded-2xl"
              style={{
                backgroundColor: 'var(--color-background)',
                border: '1px solid var(--color-border)',
                padding: 14,
              }}
            >
              <div
                style={{
                  alignItems: 'center',
                  backgroundColor: '#24332c',
                  borderRadius: 999,
                  color: '#fff8ec',
                  display: 'inline-flex',
                  fontSize: 12,
                  fontWeight: 900,
                  height: 28,
                  justifyContent: 'center',
                  width: 28,
                }}
              >
                {step}
              </div>
              <p style={{ margin: '10px 0 4px', color: 'var(--color-text-primary)', fontSize: 14, fontWeight: 850 }}>
                {title}
              </p>
              <p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: 12, lineHeight: 1.55 }}>
                {body}
              </p>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ borderBottom: '1px solid var(--color-border)', paddingBottom: 10 }}>
      <p style={{ margin: 0, fontSize: 11, textTransform: 'uppercase', fontWeight: 850, color: 'var(--color-text-muted)' }}>{label}</p>
      <p style={{ margin: '4px 0 0', color: 'var(--color-text-primary)', fontWeight: 750, overflowWrap: 'anywhere' }}>{value}</p>
    </div>
  )
}

const labelStyle = {
  color: 'var(--color-text-primary)',
  fontSize: 13,
  fontWeight: 750,
}

const inputStyle = {
  width: '100%',
  height: 42,
  border: '1px solid var(--color-border)',
  borderRadius: 10,
  padding: '0 12px',
  marginTop: 6,
  color: 'var(--color-text-primary)',
  backgroundColor: 'var(--color-background)',
  fontSize: 13,
}
