import { headers } from 'next/headers'
import { GlobalRole } from '@smartretail/shared'
import { requireRole } from '../../../../../lib/auth/helpers'
import { createServiceRoleClient } from '../../../../../lib/supabase/admin'
import ProviderSettingsForm from './ProviderSettingsForm'
import { requestAssistedIntegrationSetup } from './actions'
import { Card, CardHeader } from '../../../../../components/ui/Card'
import { Badge } from '../../../../../components/ui/Badge'
import C2BRegistrationForm from './C2BRegistrationForm'
import { requestOrigin } from '../../../../../lib/requestOrigin'
import PesapalIpnRegistrationForm from './PesapalIpnRegistrationForm'

export const dynamic = 'force-dynamic'

type ProviderSettings = {
  provider: 'daraja' | 'pesapal'
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

function callbackUrl(origin: string, path: string) {
  return new URL(path, origin).toString()
}

export default async function OwnerPaymentSettingsPage() {
  const profile = await requireRole([GlobalRole.Owner])
  if (!profile.business_id) throw new Error('Owner profile is missing its business.')
  const serviceClient = createServiceRoleClient()
  const [{ data, error }, setupConfig, setupRequests, pesapalIpnResponse, requestHeaders] = await Promise.all([
    serviceClient.rpc('owner_my_payment_provider_settings', {
      p_business_id: profile.business_id,
      p_actor_id: profile.id,
    }),
    serviceClient.from('platform_integration_setup_config').select('default_setup_fee,currency').eq('id', true).maybeSingle(),
    serviceClient.from('integration_setup_requests').select('id,provider,status,quoted_fee,currency,setup_payment_status,setup_payment_reference,request_notes,admin_notes,created_at').eq('business_id', profile.business_id).order('created_at', { ascending: false }).limit(10),
    serviceClient.from('business_payment_provider_settings').select('pesapal_ipn_id').eq('business_id', profile.business_id).eq('provider', 'pesapal').maybeSingle(),
    headers(),
  ])

  const origin = requestOrigin(requestHeaders)
  const settings = error || !Array.isArray(data) ? [] : data as ProviderSettings[]
  const daraja = settings.find((setting) => setting.provider === 'daraja') ?? null
  const pesapal = settings.find((setting) => setting.provider === 'pesapal') ?? null

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 style={{ margin: 0, color: 'var(--color-text-primary)', fontSize: 25, fontWeight: 900 }}>Customer payment providers</h1>
        <p style={{ margin: '6px 0 0', color: 'var(--color-text-muted)', fontSize: 14 }}>
          Configure the business-owned accounts that receive customer payments. Daraja prompts are initiated only while Retivox is online and remain pending until a verified provider callback confirms them. Credentials stay server-side and are never returned to the browser.
        </p>
      </div>
      {error ? <p role="alert" style={{ margin: 0, color: 'var(--color-danger)', fontSize: 13 }}>Apply migration 074 before saving merchant payment providers.</p> : null}
      <ProviderSettingsForm provider="daraja" settings={daraja} defaultCallbackUrl={callbackUrl(origin, '/api/payments/daraja/callback')} />
      <Card padding="md">
        <CardHeader title="M-Pesa PayBill or Till receipts" action={<Badge variant={daraja?.is_active ? 'info' : 'warning'}>{daraja?.is_active ? 'Daraja configured' : 'Setup needed'}</Badge>} />
        <p style={{ margin: '0 0 12px', color: 'var(--color-text-muted)', fontSize: 13, lineHeight: 1.6 }}>
          Register C2B callbacks to bring manual PayBill and Till receipts into the reconciliation queue. Retivox keeps incoming receipts unmatched until an owner or assigned admin confirms the receipt in the merchant statement and links it to a pending sale of the same amount.
        </p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2" style={{ marginBottom: 14 }}>
          <CallbackUrl label="Confirmation URL" value={callbackUrl(origin, '/api/payments/daraja/c2b/callback')} />
          <CallbackUrl label="Validation URL" value={callbackUrl(origin, '/api/payments/daraja/c2b/validation')} />
        </div>
        <p style={{ margin: '0 0 14px', color: 'var(--color-warning)', fontSize: 12, lineHeight: 1.55 }}>
          Daraja URL registration can replace callback destinations already registered for this shortcode. Check existing integrations before registering. The validation endpoint accepts payments for the configured shortcode; each receipt still requires reconciliation in Retivox.
        </p>
        <C2BRegistrationForm />
      </Card>
      <ProviderSettingsForm provider="pesapal" settings={pesapal} defaultCallbackUrl={callbackUrl(origin, '/api/payments/pesapal/ipn')} />
      <Card padding="md">
        <CardHeader title="Pesapal checkout notifications" action={<Badge variant={pesapalIpnResponse.data?.pesapal_ipn_id ? 'success' : 'warning'}>{pesapalIpnResponse.data?.pesapal_ipn_id ? 'IPN ready' : 'Register IPN'}</Badge>} />
        <p style={{ margin: '0 0 12px', color: 'var(--color-text-muted)', fontSize: 13, lineHeight: 1.6 }}>
          Pesapal redirects customers to its hosted payment page. Retivox checks the order status directly with Pesapal before verifying a payment. Keep this public HTTPS IPN callback reachable.
        </p>
        <p style={{ margin: '0 0 14px', color: 'var(--color-text-primary)', fontSize: 12, overflowWrap: 'anywhere' }}>
          IPN URL: <code>{pesapal?.callback_url ?? callbackUrl(origin, '/api/payments/pesapal/ipn')}</code>
        </p>
        <PesapalIpnRegistrationForm ipnId={pesapalIpnResponse.data?.pesapal_ipn_id ?? null} />
      </Card>
      <Card padding="md">
        <CardHeader title="Request assisted integration setup" />
        <p style={{ margin: '0 0 14px', color: 'var(--color-text-muted)', fontSize: 13 }}>
          Self-service setup remains free. Assisted configuration is quoted at {new Intl.NumberFormat(undefined, { style: 'currency', currency: setupConfig.data?.currency ?? 'KES' }).format(Number(setupConfig.data?.default_setup_fee ?? 0))} by default. This fee is separate from customer payments and carries no transaction commission.
        </p>
        <form action={requestAssistedIntegrationSetup} className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-[1fr_1fr_2fr_auto] xl:items-end">
          <label style={labelStyle}>Provider<select name="setupProvider" required style={inputStyle}><option value="daraja">M-Pesa Daraja</option><option value="pesapal">Pesapal</option><option value="card_gateway">Card gateway</option><option value="bank_transfer">Bank transfer</option></select></label>
          <label style={labelStyle}>Setup promotion code<input name="promotionCode" maxLength={40} placeholder="Optional" style={inputStyle} /></label>
          <label style={labelStyle}>What help do you need?<textarea name="requestNotes" rows={2} maxLength={2000} placeholder="Tell the team about your merchant account and setup needs. Do not include passwords or secret keys." style={{ ...inputStyle, height: 'auto', padding: 10 }} /></label>
          <button type="submit" className="btn-primary" style={{ borderRadius: 9, padding: '10px 15px' }}>Request setup</button>
        </form>
        <p style={{ margin: '10px 0 0', color: 'var(--color-text-muted)', fontSize: 12 }}>Eligible setup discounts from a verified subscription purchase are applied automatically. Do not include provider secrets in notes.</p>
      </Card>
      <Card padding="md">
        <CardHeader title="Your setup requests" />
        <div className="flex flex-col gap-3">
          {(setupRequests.data ?? []).map((item) => <div key={item.id} className="flex flex-wrap items-center justify-between gap-3" style={{ borderBottom: '1px solid var(--color-border)', padding: '8px 0' }}>
            <div><strong style={{ textTransform: 'capitalize' }}>{item.provider.replaceAll('_',' ')}</strong><p style={{ margin: '4px 0 0', color: 'var(--color-text-muted)', fontSize: 12 }}>{item.request_notes || 'No details supplied'}{item.admin_notes ? ` · Team: ${item.admin_notes}` : ''}{item.setup_payment_reference ? ` · Payment reference: ${item.setup_payment_reference}` : ''}</p></div>
            <div className="flex flex-wrap items-center gap-2"><span>{new Intl.NumberFormat(undefined, { style: 'currency', currency: item.currency }).format(Number(item.quoted_fee))}</span><Badge variant={item.status === 'completed' ? 'success' : item.status === 'cancelled' ? 'danger' : 'warning'}>{item.status.replaceAll('_',' ')}</Badge><Badge variant={item.setup_payment_status === 'paid' || item.setup_payment_status === 'waived' ? 'success' : item.setup_payment_status === 'refunded' ? 'danger' : 'warning'}>Setup {item.setup_payment_status}</Badge></div>
          </div>)}
          {(setupRequests.data ?? []).length === 0 && <p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: 13 }}>No setup requests submitted.</p>}
        </div>
      </Card>
      <p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: 12 }}>
        Offline checkouts allow only Cash and Mobile manual. Online card and bank payments can use the configured Pesapal hosted checkout; they remain pending until Pesapal confirms the payment.
      </p>
    </div>
  )
}

function CallbackUrl({ label, value }: { label: string; value: string }) {
  return <div style={{ minWidth: 0, padding: 12, border: '1px solid var(--color-border)', borderRadius: 10 }}>
    <p style={{ margin: '0 0 5px', color: 'var(--color-text-muted)', fontSize: 11, fontWeight: 800, textTransform: 'uppercase' }}>{label}</p>
    <code style={{ color: 'var(--color-text-primary)', fontSize: 12, overflowWrap: 'anywhere' }}>{value}</code>
  </div>
}

const labelStyle = { display: 'grid', gap: 6, color: 'var(--color-text-primary)', fontSize: 13, fontWeight: 700 } as const
const inputStyle = { width: '100%', minHeight: 40, border: '1px solid var(--color-border)', borderRadius: 9, padding: '0 10px', background: 'var(--color-background)', color: 'var(--color-text-primary)', fontSize: 13 }
