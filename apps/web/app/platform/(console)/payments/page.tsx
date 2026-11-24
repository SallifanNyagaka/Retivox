import { Badge } from '../../../../components/ui/Badge'
import { Card, CardHeader } from '../../../../components/ui/Card'
import { getDarajaConfigurationStatus } from '../../../../lib/payments/daraja'
import { createServiceRoleClient } from '../../../../lib/supabase/admin'
import { headers } from 'next/headers'
import { requestOrigin } from '../../../../lib/requestOrigin'
import { recordPlatformSubscriptionRefund, requestPlatformSubscriptionRefund, reviewPlatformSubscriptionRefund, reviewSubscriptionPayment, updatePlatformPaymentSettings, savePlatformPesapalSettings, registerPlatformPesapalCallback, recheckPlatformPesapalSubscription, submitPlatformPesapalRefund } from '../actions'
import BusinessBillingPortfolio, { type BillingPortfolioRow } from './BusinessBillingPortfolio'
import PlatformSubscriptionPaymentConfigForm from './PlatformSubscriptionPaymentConfigForm'
import { EMPTY_PLATFORM_SUBSCRIPTION_PAYMENT_CONFIG, parsePlatformSubscriptionPaymentConfig } from '../../../../lib/subscriptions/platformPaymentConfig'

export const dynamic = 'force-dynamic'

type PaymentSettingsRow = {
  id: string
  environment: 'sandbox' | 'production'
  business_shortcode: string
  till_number: string | null
  account_reference: string
  transaction_type: string
  callback_url: string
  is_active: boolean
  updated_at: string
}

type PendingSubscriptionPaymentRow = {
  id: string
  business_id: string
  amount: number
  currency: string
  payment_method: string
  reference_code: string
  payer_phone: string | null
  plan_key: string | null
  billing_interval: string
  submitted_at: string
  provider: string | null
  pesapal_tracking_id: string | null
  provider_result_description: string | null
  review_note: string | null
  platform_payment_option_snapshot: Record<string, unknown> | null
  businesses: { name: string } | { name: string }[] | null
}

type RefundRow = {
  id: string; payment_request_id: string; business_id: string; amount: number; status: string
  reason: string; provider_refund_id: string | null; created_at: string; provider_submission_message: string | null; provider_submission_at: string | null
  businesses: { name: string } | { name: string }[] | null
  subscription_payment_requests: { provider: string | null; provider_receipt_number: string | null } | { provider: string | null; provider_receipt_number: string | null }[] | null
}

type VerifiedPaymentRow = {
  id: string; business_id: string; amount: number; currency: string; reference_code: string
  paid_at: string | null; businesses: { name: string } | { name: string }[] | null
}

type PortfolioBusinessRow = { id: string; name: string; subscription_plan: string; subscription_status: string }
type PortfolioSubscriptionRow = {
  business_id: string; plan: string; status: string; billing_interval: string | null
  current_period_end: string | null; next_plan_key: string | null; next_billing_interval: string | null; next_period_start: string | null
}
type PortfolioPaymentRow = {
  id: string; business_id: string; amount: number; currency: string; status: string
  payment_method: string; reference_code: string; submitted_at: string; paid_at: string | null
}

export default async function PlatformPaymentsPage() {
  const serviceClient = createServiceRoleClient()
  const origin = requestOrigin(await headers())
  const [configStatus, pesapalResponse, subscriptionPaymentConfigResponse] = await Promise.all([
    getDarajaConfigurationStatus(), serviceClient.rpc('platform_get_pesapal_status'),
    serviceClient.from('platform_subscription_payment_config').select('*').eq('id', true).maybeSingle(),
  ])
  const pesapalSettings = Array.isArray(pesapalResponse.data) ? pesapalResponse.data[0] as { environment: string; callback_url: string; credentials_set: boolean; ipn_id: string | null; updated_at: string } | undefined : undefined
  const { data, error } = await serviceClient
    .from('platform_payment_settings')
    .select('id, environment, business_shortcode, till_number, account_reference, transaction_type, callback_url, is_active, updated_at')
    .eq('provider', 'daraja')
    .eq('is_active', true)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { data: pendingPayments, error: pendingPaymentsError } = await serviceClient
    .from('subscription_payment_requests')
    .select('id, business_id, amount, currency, payment_method, reference_code, payer_phone, plan_key, billing_interval, submitted_at, provider, pesapal_tracking_id, provider_result_description, review_note, platform_payment_option_snapshot, businesses(name)')
    .eq('status', 'pending')
    .in('payment_method', ['mpesa_manual', 'bank_transfer', 'cash_deposit', 'other', 'pesapal'])
    .order('submitted_at', { ascending: true })
    .limit(100)

  const [{ data: refundRows, error: refundError }, { data: verifiedRows, error: verifiedError }] = await Promise.all([
    serviceClient.from('platform_subscription_refunds')
      .select('id, payment_request_id, business_id, amount, status, reason, provider_refund_id, created_at, provider_submission_message, provider_submission_at, businesses(name), subscription_payment_requests(provider,provider_receipt_number)')
      .order('created_at', { ascending: false }).limit(100),
    serviceClient.from('subscription_payment_requests')
      .select('id, business_id, amount, currency, reference_code, paid_at, businesses(name)')
      .eq('status', 'verified').order('paid_at', { ascending: false }).limit(100),
  ])
  const [businessResponse, subscriptionResponse, billingPaymentResponse] = await Promise.all([
    serviceClient.from('businesses').select('id,name,subscription_plan,subscription_status').order('name').limit(1000),
    serviceClient.from('subscriptions').select('business_id,plan,status,billing_interval,current_period_end,next_plan_key,next_billing_interval,next_period_start').order('created_at', { ascending: false }).limit(2000),
    serviceClient.from('subscription_payment_requests').select('id,business_id,amount,currency,status,payment_method,reference_code,submitted_at,paid_at').order('submitted_at', { ascending: false }).limit(3000),
  ])

  const portfolioBusinesses = (businessResponse.data ?? []) as PortfolioBusinessRow[]
  const portfolioSubscriptions = (subscriptionResponse.data ?? []) as PortfolioSubscriptionRow[]
  const portfolioPayments = (billingPaymentResponse.data ?? []) as PortfolioPaymentRow[]
  const subscriptionByBusiness = new Map<string, PortfolioSubscriptionRow>()
  for (const subscription of portfolioSubscriptions) {
    if (!subscriptionByBusiness.has(subscription.business_id)) subscriptionByBusiness.set(subscription.business_id, subscription)
  }
  const latestPaymentByBusiness = new Map<string, PortfolioPaymentRow>()
  const verifiedPaymentByBusiness = new Map<string, PortfolioPaymentRow>()
  for (const payment of portfolioPayments) {
    if (!latestPaymentByBusiness.has(payment.business_id)) latestPaymentByBusiness.set(payment.business_id, payment)
    if (payment.status === 'verified') {
      const currentVerified = verifiedPaymentByBusiness.get(payment.business_id)
      const paidAt = payment.paid_at ? Date.parse(payment.paid_at) : 0
      const currentPaidAt = currentVerified?.paid_at ? Date.parse(currentVerified.paid_at) : 0
      if (!currentVerified || paidAt > currentPaidAt) verifiedPaymentByBusiness.set(payment.business_id, payment)
    }
  }
  const billingRows: BillingPortfolioRow[] = portfolioBusinesses.map((business) => {
    const subscription = subscriptionByBusiness.get(business.id)
    const latest = latestPaymentByBusiness.get(business.id)
    const verified = verifiedPaymentByBusiness.get(business.id)
    return {
      businessId: business.id,
      businessName: business.name,
      plan: subscription?.plan ?? business.subscription_plan ?? 'Unknown',
      subscriptionStatus: subscription?.status ?? business.subscription_status ?? 'unknown',
      billingInterval: subscription?.billing_interval ?? null,
      periodEnd: subscription?.current_period_end ?? null,
      nextPlan: subscription?.next_plan_key ?? null,
      nextInterval: subscription?.next_billing_interval ?? null,
      nextPeriodStart: subscription?.next_period_start ?? null,
      latestPayment: latest ? { status: latest.status, amount: Number(latest.amount), currency: latest.currency, method: latest.payment_method, reference: latest.reference_code, submittedAt: latest.submitted_at } : null,
      lastVerifiedPayment: verified ? { amount: Number(verified.amount), currency: verified.currency, method: verified.payment_method, reference: verified.reference_code, paidAt: verified.paid_at } : null,
    }
  })

  const settings = data as PaymentSettingsRow | null
  const subscriptionPaymentConfig = subscriptionPaymentConfigResponse.error
    ? EMPTY_PLATFORM_SUBSCRIPTION_PAYMENT_CONFIG
    : parsePlatformSubscriptionPaymentConfig(subscriptionPaymentConfigResponse.data)

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 style={{ margin: 0, color: 'var(--color-text-primary)', fontSize: 28, fontWeight: 900 }}>Payments &amp; billing</h1>
        <p style={{ margin: '6px 0 0', color: 'var(--color-text-muted)', fontSize: 14 }}>Approve manually reported payments, recheck provider status, track paid status by business, and review scheduled plan changes. Verified M-Pesa and Pesapal payments activate automatically.</p>
      </div>
      <Card padding="md">
        <CardHeader title="Manual approvals & provider checks" action={<Badge variant={(pendingPayments ?? []).length ? 'warning' : 'success'}>{(pendingPayments ?? []).length} pending</Badge>} />
        {pendingPaymentsError ? (
          <p style={{ color: 'var(--color-danger)', fontSize: 13 }}>Unable to load pending payments. Refresh the page or check the subscription payment service.</p>
        ) : (pendingPayments ?? []).length === 0 ? (
          <p style={{ color: 'var(--color-text-muted)', fontSize: 13, margin: 0 }}>No subscription payments need review.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {(pendingPayments ?? []).map((rawPayment) => {
              const payment = rawPayment as PendingSubscriptionPaymentRow
              const joinedBusiness = Array.isArray(payment.businesses) ? payment.businesses[0] : payment.businesses
              return <div key={payment.id} className="grid grid-cols-1 gap-3 border-b pb-4 md:grid-cols-[1.2fr_0.6fr_1.4fr_auto] md:items-center" style={{ borderColor: 'var(--color-border)' }}>
                <div>
                  <p style={{ color: 'var(--color-text-primary)', fontSize: 14, fontWeight: 750, margin: 0 }}>{joinedBusiness?.name ?? payment.business_id}</p>
                  <p style={{ color: 'var(--color-text-muted)', fontSize: 12, margin: '4px 0 0' }}>{payment.plan_key ?? 'Plan pending'} · {payment.billing_interval} · {payment.payment_method.replace(/_/g, ' ')}</p>
                  <p style={{ color: 'var(--color-text-muted)', fontSize: 12, margin: '3px 0 0' }}>Ref {payment.reference_code}{payment.payer_phone ? ` · ${payment.payer_phone}` : ''} · {new Date(payment.submitted_at).toLocaleString()}</p>
                  {payment.platform_payment_option_snapshot && <p style={{ color: 'var(--color-text-muted)', fontSize: 12, margin: '3px 0 0' }}>Submitted to {(payment.platform_payment_option_snapshot.label as string) ?? 'payment destination'} · {(payment.platform_payment_option_snapshot.destination as string) ?? ''}</p>}
                  {payment.provider_result_description && <p style={{ color: 'var(--color-warning)', fontSize: 12, margin: '4px 0 0' }}>{payment.provider_result_description}</p>}
                </div>
                <strong style={{ color: 'var(--color-text-primary)', fontSize: 14 }}>{new Intl.NumberFormat(undefined, { style: 'currency', currency: payment.currency }).format(Number(payment.amount))}</strong>
                {payment.payment_method === 'pesapal' ? <div className="flex flex-col items-start gap-2"><span style={{ color: payment.pesapal_tracking_id ? 'var(--color-warning)' : 'var(--color-danger)', fontSize: 12 }}>{payment.provider_result_description ?? payment.review_note ?? (payment.pesapal_tracking_id ? 'Awaiting provider confirmation' : 'Checkout tracking is not available')}</span>{payment.pesapal_tracking_id && <form action={recheckPlatformPesapalSubscription}><input type="hidden" name="paymentRequestId" value={payment.id} /><button type="submit" className="btn-outline" style={{ borderRadius: 8, padding: '8px 12px' }}>Recheck with Pesapal</button></form>}</div> : <div className="flex flex-wrap items-end gap-2">
                  {(['approve', 'reject'] as const).map((decision) => <form key={decision} action={reviewSubscriptionPayment} className="flex flex-col gap-1"><input type="hidden" name="paymentRequestId" value={payment.id} /><input type="hidden" name="decision" value={decision} /><input name="reviewNote" maxLength={240} placeholder="Optional note" aria-label={`${decision} review note`} style={{ ...inputStyle, width: 150, marginTop: 0 }} /><button type="submit" className={decision === 'approve' ? 'btn-success' : 'btn-outline'} style={{ borderRadius: 8, padding: '8px 12px' }}>{decision === 'approve' ? 'Approve payment' : 'Reject'}</button></form>)}
                </div>}
              </div>
            })}
          </div>
        )}
      </Card>
      <BusinessBillingPortfolio rows={billingRows} loadError={Boolean(businessResponse.error || subscriptionResponse.error || billingPaymentResponse.error)} />
      <Card padding="md">
        <CardHeader title="Retivox subscription payment options and support" action={<Badge variant={subscriptionPaymentConfigResponse.error ? 'danger' : 'success'}>{subscriptionPaymentConfigResponse.error ? 'Configuration unavailable' : 'Platform managed'}</Badge>} />
        {subscriptionPaymentConfigResponse.error
          ? <p role="alert" style={{ color: 'var(--color-danger)', fontSize: 13 }}>Unable to load platform payment options. Apply migration 135, then refresh this page.</p>
          : <PlatformSubscriptionPaymentConfigForm config={subscriptionPaymentConfig} />}
      </Card>
      {error && <p role="alert" style={{ margin: 0, color: 'var(--color-warning)', fontSize: 13 }}>The platform receiving account settings could not be loaded. Subscription approval and business billing remain available above. Apply migration 049 to restore platform M-Pesa settings.</p>}
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
          This is the Daraja receiving account used for Retivox subscription prompts. Credentials are saved through this form and kept in Supabase Vault.
        </p>
      </section>

      <Card padding="md">
        <CardHeader title="Platform Pesapal hosted checkout" action={<Badge variant={pesapalSettings?.credentials_set && pesapalSettings.ipn_id ? 'success' : 'warning'}>{pesapalSettings?.credentials_set && pesapalSettings.ipn_id ? 'Ready' : 'Setup needed'}</Badge>} />
        <p style={{ margin: '0 0 14px', color: 'var(--color-text-muted)', fontSize: 13, lineHeight: 1.6 }}>
          Separate from merchant accounts, this receiving account handles Retivox subscriptions and lifetime licenses. Credentials stay in Supabase Vault. Subscription access is applied only after Retivox verifies amount, currency, reference, and status directly with Pesapal.
        </p>
        <form action={savePlatformPesapalSettings} className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <label style={labelStyle}>Environment<select name="pesapalEnvironment" defaultValue={pesapalSettings?.environment ?? 'sandbox'} style={inputStyle}><option value="sandbox">Sandbox</option><option value="production">Production</option></select></label>
          <label style={labelStyle}>Subscription IPN callback URL<input name="pesapalCallbackUrl" type="url" required defaultValue={pesapalSettings?.callback_url ?? new URL('/api/payments/pesapal/subscription-ipn', origin).toString()} style={inputStyle} /></label>
          <label style={labelStyle}>Consumer key<input name="pesapalConsumerKey" autoComplete="off" placeholder={pesapalSettings?.credentials_set ? 'Saved securely; enter to replace' : 'Required for first setup'} style={inputStyle} /></label>
          <label style={labelStyle}>Consumer secret<input name="pesapalConsumerSecret" type="password" autoComplete="new-password" placeholder={pesapalSettings?.credentials_set ? 'Saved securely; enter to replace' : 'Required for first setup'} style={inputStyle} /></label>
          <button type="submit" className="btn-primary" style={{ justifySelf: 'start', borderRadius: 9, padding: '10px 15px' }}>Save Pesapal settings</button>
        </form>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <form action={registerPlatformPesapalCallback}><button type="submit" disabled={!pesapalSettings?.credentials_set} className="btn-outline" style={{ borderRadius: 9, padding: '9px 14px' }}>Register Pesapal IPN</button></form>
          <span style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>{pesapalSettings?.ipn_id ? `IPN registered · ${pesapalSettings.ipn_id}` : 'Save credentials, then register the IPN before enabling checkout.'}</span>
        </div>
        {pesapalResponse.error && <p role="alert" style={{ color: 'var(--color-danger)', fontSize: 12 }}>Unable to load Pesapal setup status.</p>}
      </Card>

      <SubscriptionRefundManagement refunds={refundRows ?? []} refundError={Boolean(refundError)} payments={verifiedRows ?? []} paymentError={Boolean(verifiedError)} />

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
                Store / API shortcode (BusinessShortCode)
                <input name="businessShortcode" defaultValue={settings?.business_shortcode ?? ''} required style={inputStyle} />
              </label>
              <label style={labelStyle}>
                Customer-facing Buy Goods Till (PartyB)
                <input name="tillNumber" defaultValue={settings?.till_number ?? ''} inputMode="numeric" style={inputStyle} />
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
              <input name="callbackUrl" type="url" defaultValue={settings?.callback_url ?? ''} placeholder="https://your-domain/api/daraja/stk-callback" required style={inputStyle} />
            </label>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <label style={labelStyle}>
                Consumer key
                <input name="consumerKey" autoComplete="off" placeholder={configStatus.consumerKeySet ? 'Saved securely; enter to replace' : 'Enter consumer key'} style={inputStyle} />
              </label>
              <label style={labelStyle}>
                Consumer secret
                <input name="consumerSecret" type="password" autoComplete="new-password" placeholder={configStatus.consumerSecretSet ? 'Saved securely; enter to replace' : 'Enter consumer secret'} style={inputStyle} />
              </label>
              <label style={labelStyle}>
                Passkey
                <input name="passkey" type="password" autoComplete="new-password" placeholder={configStatus.passkeySet ? 'Saved securely; enter to replace' : 'Enter passkey'} style={inputStyle} />
              </label>
            </div>

            <button type="submit" className="btn-primary" style={{ borderRadius: 10, padding: '10px 16px', justifySelf: 'start' }}>
              Save M-Pesa account
            </button>
          </form>
        </Card>

        <Card padding="md">
          <CardHeader title="Current receiver" action={<Badge variant={configStatus.isConfigured ? 'success' : 'warning'}>{configStatus.isConfigured ? 'Configured' : 'Setup needed'}</Badge>} />
          <div className="flex flex-col gap-3" style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>
            <Info label="STK readiness" value={configStatus.isConfigured ? `Ready (${configStatus.source})` : `Missing ${configStatus.missing.join(', ')}`} />
            <Info label="Environment" value={settings?.environment ?? 'sandbox'} />
            <Info label="Store/API shortcode" value={settings?.business_shortcode ?? 'Not set'} />
            <Info label="Customer-facing Till" value={settings?.till_number ?? 'Same as shortcode / not configured'} />
            <Info label="Account reference" value={settings?.account_reference ?? 'RETIVOX'} />
            <Info label="Callback URL" value={settings?.callback_url ?? 'Not set'} />
            <Info label="Consumer key" value={configStatus.consumerKeySet ? 'Saved in Vault' : 'Not set'} />
            <Info label="Consumer secret" value={configStatus.consumerSecretSet ? 'Saved in Vault' : 'Not set'} />
            <Info label="Passkey" value={configStatus.passkeySet ? 'Saved in Vault' : 'Not set'} />
          </div>
        </Card>
      </div>

      <Card padding="md">
        <CardHeader title="M-Pesa prompt flow" action={<Badge variant="info">Step by step</Badge>} />
        <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
          {[
            ['1', 'Save M-Pesa account', 'Set Store/API shortcode, optional Buy Goods Till, account reference, callback URL, and Daraja credentials.'],
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

function SubscriptionRefundManagement({ refunds, refundError, payments, paymentError }: {
  refunds: RefundRow[]; refundError: boolean; payments: VerifiedPaymentRow[]; paymentError: boolean
}) {
  return <Card padding="md">
    <CardHeader title="Subscription refunds" action={<Badge variant="warning">Provider submission + confirmation</Badge>} />
    <p style={{ margin: '0 0 16px', color: 'var(--color-text-muted)', fontSize: 13 }}>Pesapal refund submissions are sent to the provider, but acceptance does not mean funds have been returned. Confirm completion only after checking the provider statement.</p>
    {refundError ? <p style={{ color: 'var(--color-danger)', fontSize: 13 }}>Unable to load refund requests.</p> : refunds.length === 0 ? <p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: 13 }}>No subscription refunds recorded.</p> : <div className="flex flex-col gap-3">{refunds.map((refund) => {
      const business = Array.isArray(refund.businesses) ? refund.businesses[0] : refund.businesses
      const subscriptionPayment = Array.isArray(refund.subscription_payment_requests) ? refund.subscription_payment_requests[0] : refund.subscription_payment_requests
      return <div key={refund.id} className="grid grid-cols-1 gap-3 border-b pb-4 lg:grid-cols-[1fr_auto] lg:items-center" style={{ borderColor: 'var(--color-border)' }}>
        <div><p style={{ margin: 0, color: 'var(--color-text-primary)', fontSize: 14, fontWeight: 800 }}>{business?.name ?? refund.business_id} · {new Intl.NumberFormat(undefined, { style: 'currency', currency: 'KES' }).format(Number(refund.amount))}</p><p style={{ margin: '4px 0', color: 'var(--color-text-muted)', fontSize: 12 }}>{refund.status} · {refund.reason} · {new Date(refund.created_at).toLocaleString()}</p>{refund.provider_submission_message && <p style={{ margin: '4px 0', color: 'var(--color-warning)', fontSize: 12 }}>{refund.provider_submission_message}</p>}{refund.provider_refund_id && <p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: 12 }}>Completed provider reference: {refund.provider_refund_id}</p>}</div>
        {refund.status === 'requested' && <div className="flex flex-wrap gap-2">{(['approve', 'reject'] as const).map((decision) => <form key={decision} action={reviewPlatformSubscriptionRefund} className="flex gap-2"><input type="hidden" name="refundId" value={refund.id} /><input type="hidden" name="decision" value={decision} /><input name="note" placeholder="Review note" style={{ ...inputStyle, width: 170, marginTop: 0 }} /><button type="submit" className={decision === 'approve' ? 'btn-success' : 'btn-outline'} style={{ borderRadius: 8, padding: '8px 12px' }}>{decision === 'approve' ? 'Approve' : 'Reject'}</button></form>)}</div>}
        {refund.status === 'approved' && subscriptionPayment?.provider === 'pesapal' && <form action={submitPlatformPesapalRefund}><input type="hidden" name="refundId" value={refund.id} /><button type="submit" className="btn-outline" style={{ borderRadius: 8, padding: '8px 12px' }}>Submit to Pesapal</button></form>}
        {refund.status === 'approved' && subscriptionPayment?.provider !== 'pesapal' && <form action={recordPlatformSubscriptionRefund} className="flex flex-wrap gap-2"><input type="hidden" name="refundId" value={refund.id} /><input name="providerReference" required minLength={3} placeholder="Provider refund reference" style={{ ...inputStyle, width: 230, marginTop: 0 }} /><button type="submit" className="btn-primary" style={{ borderRadius: 8, padding: '8px 12px' }}>Record completed refund</button></form>}
        {refund.status === 'processing' && <form action={recordPlatformSubscriptionRefund} className="flex flex-wrap gap-2"><input type="hidden" name="refundId" value={refund.id} /><input name="providerReference" required minLength={3} placeholder="Confirmed refund reference" style={{ ...inputStyle, width: 230, marginTop: 0 }} /><button type="submit" className="btn-primary" style={{ borderRadius: 8, padding: '8px 12px' }}>Confirm completed refund</button></form>}
      </div>
    })}</div>}
    <h3 style={{ margin: '22px 0 10px', color: 'var(--color-text-primary)', fontSize: 15 }}>Request a refund from a verified payment</h3>
    {paymentError ? <p style={{ color: 'var(--color-danger)', fontSize: 13 }}>Unable to load verified payments.</p> : payments.length === 0 ? <p style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>No verified subscription payments available.</p> : <div className="flex flex-col gap-3">{payments.map((payment) => {
      const business = Array.isArray(payment.businesses) ? payment.businesses[0] : payment.businesses
      return <form key={payment.id} action={requestPlatformSubscriptionRefund} className="grid grid-cols-1 gap-2 border-b pb-3 md:grid-cols-[1.2fr_0.7fr_0.8fr_1.5fr_auto] md:items-end" style={{ borderColor: 'var(--color-border)' }}>
        <div><strong style={{ color: 'var(--color-text-primary)', fontSize: 13 }}>{business?.name ?? payment.business_id}</strong><p style={{ margin: '3px 0 0', color: 'var(--color-text-muted)', fontSize: 11 }}>{payment.reference_code} · Paid {payment.paid_at ? new Date(payment.paid_at).toLocaleDateString() : 'date unavailable'}</p></div><span style={{ color: 'var(--color-text-primary)', fontSize: 13 }}>Paid {new Intl.NumberFormat(undefined, { style: 'currency', currency: payment.currency }).format(Number(payment.amount))}</span>
        <label style={labelStyle}>Refund amount<input name="amount" type="number" min="0.01" max={payment.amount} step="0.01" required style={inputStyle} /></label><label style={labelStyle}>Reason<input name="reason" minLength={10} required placeholder="Reason for refund" style={inputStyle} /></label><input type="hidden" name="paymentRequestId" value={payment.id} /><button type="submit" className="btn-outline" style={{ borderRadius: 8, padding: '9px 12px' }}>Request</button>
      </form>
    })}</div>}
  </Card>
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
