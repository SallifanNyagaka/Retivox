/**
 * Daraja STK Push client for subscription payments.
 *
 * Required env vars:
 * - DARAJA_CONSUMER_KEY
 * - DARAJA_CONSUMER_SECRET
 * - DARAJA_SHORTCODE
 * - DARAJA_PASSKEY
 * - DARAJA_CALLBACK_URL
 * Optional:
 * - DARAJA_ENV=sandbox|production
 * - DARAJA_TRANSACTION_TYPE=CustomerPayBillOnline
 */

import { createServiceRoleClient } from '../supabase/admin'

export type DarajaStkPushResponse = {
  MerchantRequestID?: string
  CheckoutRequestID?: string
  ResponseCode?: string
  ResponseDescription?: string
  CustomerMessage?: string
  errorCode?: string
  errorMessage?: string
}

type DarajaConfig = {
  consumerKey: string
  consumerSecret: string
  shortcode: string
  passkey: string
  callbackUrl: string
  environment: 'sandbox' | 'production'
  transactionType: string
  accountReference: string
}

type PlatformPaymentSettingsRow = {
  environment: 'sandbox' | 'production'
  business_shortcode: string
  account_reference: string
  transaction_type: string
  callback_url: string
  consumer_key: string | null
  consumer_secret: string | null
  passkey: string | null
}

async function getPlatformDarajaSettings(): Promise<PlatformPaymentSettingsRow | null> {
  try {
    const serviceClient = createServiceRoleClient()
    const { data, error } = await serviceClient
      .from('platform_payment_settings')
      .select('environment, business_shortcode, account_reference, transaction_type, callback_url, consumer_key, consumer_secret, passkey')
      .eq('provider', 'daraja')
      .eq('is_active', true)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) {
      return null
    }

    return data as PlatformPaymentSettingsRow | null
  } catch {
    return null
  }
}

async function getDarajaConfig(): Promise<DarajaConfig> {
  const settings = await getPlatformDarajaSettings()
  const consumerKey = process.env.DARAJA_CONSUMER_KEY
  const consumerSecret = process.env.DARAJA_CONSUMER_SECRET
  const shortcode = process.env.DARAJA_SHORTCODE
  const passkey = process.env.DARAJA_PASSKEY
  const callbackUrl = process.env.DARAJA_CALLBACK_URL
  const resolvedConsumerKey = settings?.consumer_key || consumerKey
  const resolvedConsumerSecret = settings?.consumer_secret || consumerSecret
  const resolvedShortcode = settings?.business_shortcode || shortcode
  const resolvedPasskey = settings?.passkey || passkey
  const resolvedCallbackUrl = settings?.callback_url || callbackUrl

  if (!resolvedConsumerKey || !resolvedConsumerSecret || !resolvedShortcode || !resolvedPasskey || !resolvedCallbackUrl) {
    throw new Error('Daraja is not configured. Add it in Platform > M-Pesa or set DARAJA_CONSUMER_KEY, DARAJA_CONSUMER_SECRET, DARAJA_SHORTCODE, DARAJA_PASSKEY, and DARAJA_CALLBACK_URL.')
  }

  return {
    consumerKey: resolvedConsumerKey,
    consumerSecret: resolvedConsumerSecret,
    shortcode: resolvedShortcode,
    passkey: resolvedPasskey,
    callbackUrl: resolvedCallbackUrl,
    environment: settings?.environment ?? (process.env.DARAJA_ENV === 'production' ? 'production' : 'sandbox'),
    transactionType: settings?.transaction_type || process.env.DARAJA_TRANSACTION_TYPE || 'CustomerPayBillOnline',
    accountReference: settings?.account_reference || process.env.DARAJA_ACCOUNT_REFERENCE || 'RETIVOX',
  }
}

export async function getDarajaPromptConfiguration() {
  const config = await getDarajaConfig()

  return {
    environment: config.environment,
    shortcode: config.shortcode,
    transactionType: config.transactionType,
    accountReference: config.accountReference,
    callbackUrl: config.callbackUrl,
  }
}

function getBaseUrl(environment: DarajaConfig['environment']) {
  return environment === 'production'
    ? 'https://api.safaricom.co.ke'
    : 'https://sandbox.safaricom.co.ke'
}

function getTimestamp() {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')

  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join('')
}

export function normalizeKenyanPhone(phone: string) {
  const digits = phone.replace(/\D/g, '')

  if (digits.startsWith('254') && digits.length === 12) return digits
  if (digits.startsWith('0') && digits.length === 10) return `254${digits.slice(1)}`
  if (digits.startsWith('7') && digits.length === 9) return `254${digits}`
  if (digits.startsWith('1') && digits.length === 9) return `254${digits}`

  throw new Error('Enter a valid Kenyan phone number, for example 07XXXXXXXX or 2547XXXXXXXX.')
}

async function getAccessToken(config: DarajaConfig) {
  const baseUrl = getBaseUrl(config.environment)
  const credentials = Buffer.from(`${config.consumerKey}:${config.consumerSecret}`).toString('base64')
  const response = await fetch(`${baseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
    method: 'GET',
    headers: {
      Authorization: `Basic ${credentials}`,
    },
    cache: 'no-store',
  })

  const payload = (await response.json()) as { access_token?: string; errorMessage?: string }

  if (!response.ok || !payload.access_token) {
    throw new Error(payload.errorMessage ?? 'Unable to authenticate with Daraja')
  }

  return payload.access_token
}

export async function initiateDarajaStkPush(input: {
  phone: string
  amount: number
  accountReference?: string
  transactionDescription: string
}): Promise<DarajaStkPushResponse> {
  const config = await getDarajaConfig()
  const baseUrl = getBaseUrl(config.environment)
  const accessToken = await getAccessToken(config)
  const timestamp = getTimestamp()
  const password = Buffer.from(`${config.shortcode}${config.passkey}${timestamp}`).toString('base64')
  const amount = Math.max(1, Math.round(input.amount))
  const phone = normalizeKenyanPhone(input.phone)

  const response = await fetch(`${baseUrl}/mpesa/stkpush/v1/processrequest`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      BusinessShortCode: config.shortcode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: config.transactionType,
      Amount: amount,
      PartyA: phone,
      PartyB: config.shortcode,
      PhoneNumber: phone,
      CallBackURL: config.callbackUrl,
      AccountReference: (input.accountReference || config.accountReference).slice(0, 12),
      TransactionDesc: input.transactionDescription.slice(0, 64),
    }),
    cache: 'no-store',
  })

  const payload = (await response.json()) as DarajaStkPushResponse

  if (!response.ok || payload.errorCode) {
    throw new Error(payload.errorMessage ?? payload.ResponseDescription ?? 'Daraja STK Push request failed')
  }

  return payload
}
