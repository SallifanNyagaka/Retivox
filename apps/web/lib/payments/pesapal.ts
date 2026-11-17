import { createServiceRoleClient } from '../supabase/admin'
import { createClient } from '../supabase/server'

export type PesapalConfig = {
  consumerKey: string
  consumerSecret: string
  environment: 'sandbox' | 'production'
  callbackUrl: string
  baseUrl: string
  ipnId: string | null
}

type PesapalSettingsRow = {
  consumer_key: string | null
  consumer_secret: string | null
  callback_url: string | null
  environment: 'sandbox' | 'production'
}

type CheckoutIntent = {
  business_id: string
  owner_id: string
  transaction_id: string
  amount: number | string
  currency: string
  merchant_reference: string
  customer_phone: string | null
  customer_email: string | null
  branch_name: string | null
  ipn_id: string
}

type PlatformCheckoutIntent = {
  payment_request_id: string
  business_id: string
  owner_email: string | null
  amount: number | string
  currency: string
  merchant_reference: string
  ipn_id: string
  auto_renew_requested: boolean
  account_reference: string | null
  recurring_start_date: string | null
  recurring_end_date: string | null
  recurring_frequency: string | null
}

type PlatformPesapalSettingsRow = {
  environment: 'sandbox' | 'production'
  callback_url: string
  consumer_key: string
  consumer_secret: string
  ipn_id: string | null
}

export type PesapalTransactionStatus = {
  payment_method?: string
  amount?: number
  currency?: string
  confirmation_code?: string
  payment_status_description?: string
  status_code?: number
  merchant_reference?: string
  status?: string
  message?: string
  subscription_transaction_info?: {
    account_reference?: string
    amount?: number
    correlation_id?: string | number
  }
}

function apiBase(environment: 'sandbox' | 'production') {
  return environment === 'production' ? 'https://pay.pesapal.com/v3' : 'https://cybqa.pesapal.com/pesapalv3'
}

export async function getBusinessPesapalSetup(businessId: string): Promise<{ ownerId: string; config: PesapalConfig }> {
  const service = createServiceRoleClient()
  const { data: owner, error: ownerError } = await service.from('users')
    .select('id').eq('business_id', businessId).eq('global_role', 'owner').eq('is_active', true)
    .is('deleted_at', null).order('created_at', { ascending: true }).limit(1).maybeSingle()
  if (ownerError || !owner) throw new Error('The active business owner could not be loaded.')
  const { data, error } = await service.rpc('owner_get_payment_provider_config', {
    p_business_id: businessId, p_actor_id: owner.id, p_provider: 'pesapal',
  })
  const row = Array.isArray(data) ? data[0] as PesapalSettingsRow | undefined : undefined
  if (error || !row?.consumer_key || !row.consumer_secret || !row.callback_url) {
    throw new Error('Configure the business Pesapal credentials and IPN callback URL first.')
  }
  const callback = new URL(row.callback_url)
  if (callback.protocol !== 'https:') throw new Error('Pesapal IPN callback URL must use HTTPS.')
  const { data: savedSettings, error: settingsError } = await service.from('business_payment_provider_settings')
    .select('pesapal_ipn_id').eq('business_id', businessId).eq('provider', 'pesapal').eq('is_active', true).maybeSingle()
  if (settingsError) throw new Error('Could not load the Pesapal IPN registration status.')
  return {
    ownerId: owner.id,
    config: {
      consumerKey: row.consumer_key, consumerSecret: row.consumer_secret, callbackUrl: callback.toString(),
      environment: row.environment, baseUrl: apiBase(row.environment), ipnId: savedSettings?.pesapal_ipn_id ?? null,
    },
  }
}

async function token(config: PesapalConfig) {
  const response = await fetch(`${config.baseUrl}/api/Auth/RequestToken`, {
    method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ consumer_key: config.consumerKey, consumer_secret: config.consumerSecret }),
    cache: 'no-store', signal: AbortSignal.timeout(15000),
  })
  const payload = await response.json() as { token?: string; error?: { message?: string }; status?: string; message?: string }
  if (!response.ok || !payload.token) throw new Error(payload.error?.message ?? payload.message ?? 'Pesapal authentication failed.')
  return payload.token
}

/** Checks merchant credentials with Pesapal's token endpoint; no checkout is created. */
export async function testBusinessPesapalConnection(businessId: string) {
  const setup = await getBusinessPesapalSetup(businessId)
  await token(setup.config)
  return `Pesapal credentials authenticated successfully in ${setup.config.environment} mode. No checkout was created.`
}

export async function registerPesapalIpn(config: PesapalConfig) {
  const accessToken = await token(config)
  const response = await fetch(`${config.baseUrl}/api/URLSetup/RegisterIPN`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ url: config.callbackUrl, ipn_notification_type: 'POST' }),
    cache: 'no-store', signal: AbortSignal.timeout(15000),
  })
  const payload = await response.json() as { ipn_id?: string; status?: string; error?: { message?: string }; message?: string }
  if (!response.ok || payload.status !== '200' || !payload.ipn_id) {
    throw new Error(payload.error?.message ?? payload.message ?? 'Pesapal did not confirm IPN registration.')
  }
  return payload.ipn_id
}

async function submitOrder(config: PesapalConfig, intent: CheckoutIntent | PlatformCheckoutIntent, callbackUrl: string, cancellationUrl: string,
  recurring?: { accountReference: string; startDate: string; endDate: string; frequency: 'MONTHLY' | 'YEARLY' }) {
  if (!config.ipnId) throw new Error('Register the Pesapal IPN before starting hosted checkout.')
  const accessToken = await token(config)
  const response = await fetch(`${config.baseUrl}/api/Transactions/SubmitOrderRequest`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({
      id: intent.merchant_reference,
      currency: intent.currency,
      amount: Number(intent.amount),
      description: 'Retivox subscription payment',
      callback_url: callbackUrl,
      cancellation_url: cancellationUrl,
      redirect_mode: 'TOP_WINDOW',
      notification_id: config.ipnId,
      branch: 'Retivox subscription',
      billing_address: {
        phone_number: 'customer_phone' in intent ? intent.customer_phone ?? undefined : undefined,
        email_address: 'customer_email' in intent ? intent.customer_email ?? undefined : intent.owner_email ?? undefined,
        country_code: 'KE',
      },
      ...(recurring ? {
        account_number: recurring.accountReference,
        subscription_details: {
          start_date: formatPesapalDate(recurring.startDate),
          end_date: formatPesapalDate(recurring.endDate),
          frequency: recurring.frequency,
        },
      } : {}),
    }),
    cache: 'no-store', signal: AbortSignal.timeout(20000),
  })
  const payload = await response.json() as { order_tracking_id?: string; merchant_reference?: string; redirect_url?: string; status?: string; error?: { message?: string }; message?: string }
  if (!response.ok || payload.status !== '200' || !payload.order_tracking_id || payload.merchant_reference !== intent.merchant_reference || !payload.redirect_url) {
    throw new Error(payload.error?.message ?? payload.message ?? 'Pesapal could not start the hosted checkout.')
  }
  const redirect = new URL(payload.redirect_url)
  if (redirect.protocol !== 'https:' || !['pay.pesapal.com', 'cybqa.pesapal.com'].includes(redirect.hostname)) {
    throw new Error('Pesapal returned an unexpected checkout URL.')
  }
  return { trackingId: payload.order_tracking_id, redirectUrl: redirect.toString() }
}

function formatPesapalDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) throw new Error('Pesapal recurring dates were invalid.')
  return `${match[3]}-${match[2]}-${match[1]}`
}

export async function getPlatformPesapalSetup(): Promise<{ config: PesapalConfig }> {
  const service = createServiceRoleClient()
  const { data, error } = await service.rpc('platform_get_pesapal_settings')
  const row = Array.isArray(data) ? data[0] as PlatformPesapalSettingsRow | undefined : undefined
  if (error || !row?.consumer_key || !row.consumer_secret || !row.callback_url) {
    throw new Error('Platform Pesapal credentials are not configured.')
  }
  const callback = new URL(row.callback_url)
  if (callback.protocol !== 'https:') throw new Error('Platform Pesapal callback URL must use HTTPS.')
  return { config: {
    consumerKey: row.consumer_key, consumerSecret: row.consumer_secret, environment: row.environment,
    callbackUrl: callback.toString(), baseUrl: apiBase(row.environment), ipnId: row.ipn_id,
  } }
}

export async function registerPlatformPesapalIpn(updatedBy: string) {
  const setup = await getPlatformPesapalSetup()
  const ipnId = await registerPesapalIpn(setup.config)
  const service = createServiceRoleClient()
  const { data, error } = await service.rpc('platform_set_pesapal_ipn', { p_ipn_id: ipnId, p_updated_by: updatedBy })
  if (error || data !== true) throw new Error('Pesapal IPN was registered but Retivox could not save its registration. Contact support before retrying.')
  return ipnId
}

export async function startPlatformSubscriptionPesapalCheckout(input: {
  planKey: string; billingInterval: 'monthly' | 'yearly' | 'lifetime'; phone?: string; promotionCode?: string; autoRenew?: boolean;
  origin: string
}) {
  const setup = await getPlatformPesapalSetup()
  if (!setup.config.ipnId) throw new Error('Register the platform Pesapal IPN before starting subscription checkout.')
  const session = await createClient()
  const { data, error } = await session.rpc('owner_prepare_subscription_pesapal_checkout_v2', {
    p_plan_key: input.planKey, p_billing_interval: input.billingInterval,
    p_payer_phone: input.phone ?? null, p_promotion_code: input.promotionCode ?? null,
    p_auto_renew: input.autoRenew ?? false,
  })
  if (error) throw new Error(error.message)
  const intent = (Array.isArray(data) ? data[0] : data) as PlatformCheckoutIntent | null
  if (!intent) return { covered: true as const }
  if (!intent.owner_email && !input.phone) throw new Error('Provide an account email or M-Pesa phone number for Pesapal checkout.')
  if (intent.ipn_id !== setup.config.ipnId) throw new Error('Platform Pesapal IPN configuration changed; retry checkout.')
  const callback = new URL('/api/payments/pesapal/subscription-callback', input.origin)
  const cancellation = new URL('/dashboard/owner/settings?subscription=cancelled', input.origin)
  let recurring: { accountReference: string; startDate: string; endDate: string; frequency: 'MONTHLY' | 'YEARLY' } | undefined
  if (intent.auto_renew_requested) {
    if (!intent.account_reference || !intent.recurring_start_date || !intent.recurring_end_date
        || !['MONTHLY', 'YEARLY'].includes(intent.recurring_frequency ?? '')) {
      throw new Error('Pesapal recurring authorization details were incomplete. Retry with manual renewal or contact support.')
    }
    recurring = { accountReference: intent.account_reference, startDate: intent.recurring_start_date,
      endDate: intent.recurring_end_date, frequency: intent.recurring_frequency as 'MONTHLY' | 'YEARLY' }
  }
  const started = await submitOrder(setup.config, intent, callback.toString(), cancellation.toString(), recurring)
  const service = createServiceRoleClient()
  const { data: saved, error: saveError } = await service.from('subscription_payment_requests')
    .update({ pesapal_tracking_id: started.trackingId })
    .eq('id', intent.payment_request_id).eq('business_id', intent.business_id)
    .eq('pesapal_merchant_reference', intent.merchant_reference).is('pesapal_tracking_id', null)
    .select('id').maybeSingle()
  if (saveError || !saved) throw new Error('Pesapal created checkout, but Retivox could not save its tracking id. Contact support before retrying.')
  return { covered: false as const, redirectUrl: started.redirectUrl }
}

export async function processPlatformPesapalNotification(trackingId: string, notificationReference?: string, notificationType = 'IPNCHANGE') {
  const setup = await getPlatformPesapalSetup()
  if (notificationType.toUpperCase() === 'RECURRING') {
    const status = await verifyPesapalTransaction(setup.config, trackingId)
    const recurring = status.subscription_transaction_info
    const correlationId = recurring?.correlation_id == null ? '' : String(recurring.correlation_id)
    if (!notificationReference || !recurring?.account_reference || !correlationId) {
      throw new Error('Pesapal recurring status did not include its account and correlation references.')
    }
    const service = createServiceRoleClient()
    const { data, error } = await service.rpc('platform_record_pesapal_recurring_result', {
      p_tracking_id: trackingId, p_ipn_account_reference: notificationReference,
      p_account_reference: recurring.account_reference, p_correlation_id: correlationId,
      p_status_code: Number(status.status_code), p_status_description: status.payment_status_description ?? '',
      p_paid_amount: recurring.amount ?? status.amount ?? null, p_currency: status.currency ?? null,
      p_confirmation_code: status.confirmation_code ?? null, p_payment_method: status.payment_method ?? null,
      p_payload: { status_code: status.status_code ?? null, status: status.payment_status_description ?? null,
        amount: recurring.amount ?? status.amount ?? null, currency: status.currency ?? null,
        confirmation_code: status.confirmation_code ?? null, payment_method: status.payment_method ?? null,
        subscription_transaction_info: recurring },
    })
    if (error || !data || typeof data !== 'object') throw new Error('Pesapal recurring result could not be recorded.')
    const result = data as { matched?: boolean; verified?: boolean }
    return { matched: result.matched === true, verified: result.verified === true, recurring: true }
  }
  const service = createServiceRoleClient()
  let { data: payment, error: lookupError } = await service.from('subscription_payment_requests')
    .select('id,business_id,pesapal_tracking_id,pesapal_merchant_reference')
    .eq('pesapal_tracking_id', trackingId).maybeSingle()
  if (!payment && notificationReference) {
    const fallback = await service.from('subscription_payment_requests')
      .select('id,business_id,pesapal_tracking_id,pesapal_merchant_reference')
      .eq('pesapal_merchant_reference', notificationReference).maybeSingle()
    payment = fallback.data
    lookupError = fallback.error
  }
  if (lookupError) throw new Error('Could not locate the Retivox subscription checkout.')
  if (!payment) return { matched: false, verified: false }
  const status = await verifyPesapalTransaction(setup.config, trackingId)
  const statusCode = Number(status.status_code)
  if (!Number.isInteger(statusCode)) throw new Error('Pesapal returned an invalid transaction status code.')
  const { data, error } = await service.rpc('record_platform_pesapal_subscription_result', {
    p_tracking_id: trackingId, p_merchant_reference: status.merchant_reference ?? '', p_status_code: statusCode,
    p_status_description: status.payment_status_description ?? '', p_paid_amount: status.amount ?? null,
    p_currency: status.currency ?? null, p_confirmation_code: status.confirmation_code ?? null,
    p_payload: { status_code: statusCode, status: status.payment_status_description ?? null,
      amount: status.amount ?? null, currency: status.currency ?? null,
      merchant_reference: status.merchant_reference ?? null, confirmation_code: status.confirmation_code ?? null,
      subscription_transaction_info: status.subscription_transaction_info ?? null },
  })
  if (error) throw new Error('Pesapal status could not be recorded against the subscription.')
  return { matched: true, verified: data === true && statusCode === 1 }
}

export async function startBusinessPesapalCheckout(input: {
  businessId: string; paymentId: string; phone?: string; email?: string; origin: string; returnPath: string
}) {
  const setup = await getBusinessPesapalSetup(input.businessId)
  if (!setup.config.ipnId) throw new Error('Register the Pesapal IPN before recording a hosted checkout sale.')
  const session = await createClient()
  const { data, error } = await session.rpc('start_business_pesapal_checkout', {
    p_payment_id: input.paymentId, p_customer_phone: input.phone ?? null, p_customer_email: input.email ?? null,
  })
  if (error) throw new Error(error.message)
  const intent = (Array.isArray(data) ? data[0] : data) as CheckoutIntent | null
  if (!intent || intent.business_id !== input.businessId || intent.owner_id !== setup.ownerId || intent.ipn_id !== setup.config.ipnId) {
    throw new Error('The Pesapal payment intent could not be linked to the business configuration.')
  }
  const callback = new URL('/api/payments/pesapal/callback', input.origin)
  callback.searchParams.set('returnTo', input.returnPath)
  const callbackUrl = callback.toString()
  const cancellationUrl = new URL(input.returnPath, input.origin).toString()
  const started = await submitOrder(setup.config, intent, callbackUrl, cancellationUrl)
  const service = createServiceRoleClient()
  const { data: updated, error: saveError } = await service.from('payments').update({ provider_checkout_id: started.trackingId })
    .eq('id', input.paymentId).eq('business_id', input.businessId).eq('provider', 'pesapal')
    .eq('provider_merchant_reference', intent.merchant_reference).is('provider_checkout_id', null).select('id').maybeSingle()
  if (saveError || !updated) throw new Error('Pesapal created the checkout, but Retivox could not save its tracking ID. Do not record the sale again; contact the owner to reconcile it.')
  return { redirectUrl: started.redirectUrl }
}

export async function processBusinessPesapalNotification(trackingId: string) {
  const service = createServiceRoleClient()
  const { data: payment, error: paymentError } = await service.from('payments')
    .select('business_id,provider_checkout_id')
    .eq('provider', 'pesapal').eq('provider_checkout_id', trackingId).maybeSingle()
  if (paymentError) throw new Error('Could not locate the Pesapal checkout.')
  if (!payment) return { matched: false, verified: false }
  const setup = await getBusinessPesapalSetup(payment.business_id)
  const status = await verifyPesapalTransaction(setup.config, trackingId)
  const statusCode = Number(status.status_code)
  if (!Number.isInteger(statusCode)) throw new Error('Pesapal returned an invalid transaction status code.')
  const { data, error } = await service.rpc('record_business_pesapal_checkout_result', {
    p_checkout_id: trackingId,
    p_merchant_reference: status.merchant_reference ?? '',
    p_status_code: statusCode,
    p_status_description: status.payment_status_description ?? '',
    p_paid_amount: status.amount ?? null,
    p_currency: status.currency ?? null,
    p_confirmation_code: status.confirmation_code ?? null,
    p_payment_method: status.payment_method ?? null,
    p_payload: {
      status_code: status.status_code ?? null,
      payment_status_description: status.payment_status_description ?? null,
      amount: status.amount ?? null,
      currency: status.currency ?? null,
      payment_method: status.payment_method ?? null,
      merchant_reference: status.merchant_reference ?? null,
      confirmation_code: status.confirmation_code ?? null,
    },
  })
  if (error) throw new Error('Pesapal returned a status that Retivox could not record.')
  return { matched: true, verified: data === true && statusCode === 1 }
}

export async function verifyPesapalTransaction(config: PesapalConfig, trackingId: string): Promise<PesapalTransactionStatus> {
  const accessToken = await token(config)
  const url = new URL(`${config.baseUrl}/api/Transactions/GetTransactionStatus`)
  url.searchParams.set('orderTrackingId', trackingId)
  const response = await fetch(url, {
    method: 'GET', headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    cache: 'no-store', signal: AbortSignal.timeout(15000),
  })
  const payload = await response.json() as PesapalTransactionStatus & { error?: { message?: string } }
  if (!response.ok || payload.status !== '200') throw new Error(payload.error?.message ?? payload.message ?? 'Pesapal transaction status could not be verified.')
  return payload
}

/** Submit a refund request. Pesapal acceptance is asynchronous and is not a completed refund. */
export async function requestPesapalRefund(config: PesapalConfig, input: {
  confirmationCode: string; amount: number; username: string; remarks: string
}): Promise<{ accepted: boolean; message: string }> {
  if (!input.confirmationCode.trim() || !Number.isFinite(input.amount) || input.amount <= 0) {
    throw new Error('A verified Pesapal confirmation code and positive refund amount are required.')
  }
  const accessToken = await token(config)
  const response = await fetch(`${config.baseUrl}/api/Transactions/RefundRequest`, {
    method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ confirmation_code: input.confirmationCode, amount: input.amount.toFixed(2),
      username: input.username.slice(0, 100), remarks: input.remarks.slice(0, 250) }),
    cache: 'no-store', signal: AbortSignal.timeout(20000),
  })
  const payload = await response.json() as { status?: string; message?: string; error?: { message?: string } }
  if (!response.ok) throw new Error(payload.error?.message ?? payload.message ?? `Pesapal refund endpoint returned HTTP ${response.status}`)
  if (payload.status === '200') return { accepted: true, message: payload.message ?? 'Pesapal accepted the refund request for processing.' }
  if (payload.status === '500') return { accepted: false, message: payload.message ?? 'Pesapal rejected the refund request.' }
  throw new Error(payload.error?.message ?? payload.message ?? 'Pesapal returned an unrecognized refund response.')
}
