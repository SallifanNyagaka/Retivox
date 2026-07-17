/**
 * Daraja STK Push client for subscription payments.
 *
 * Required env vars:
 * - MPESA_CONSUMER_KEY
 * - MPESA_CONSUMER_SECRET
 * - MPESA_SHORTCODE
 * - MPESA_PASSKEY
 * - MPESA_CALLBACK_URL
 * Optional:
 * - MPESA_ENV=sandbox|production
 * - MPESA_BASE_URL
 * - MPESA_TRANSACTION_TYPE=CustomerPayBillOnline
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

export type DarajaPromptConfiguration = {
  environment: 'sandbox' | 'production'
  shortcode: string
  transactionType: string
  accountReference: string
  callbackUrl: string
  isTestMode: boolean
  missing: string[]
}

type DarajaConfig = {
  consumerKey: string
  consumerSecret: string
  shortcode: string
  passkey: string
  callbackUrl: string
  environment: 'sandbox' | 'production'
  baseUrl: string
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

type DarajaConfigResolution = {
  config: DarajaConfig | null
  missing: string[]
  source: 'platform' | 'env' | 'mixed' | 'none'
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

async function resolveDarajaConfig(): Promise<DarajaConfigResolution> {
  const settings = await getPlatformDarajaSettings()
  const configuredEnvironment = settings?.environment ?? (process.env.MPESA_ENV === 'production' ? 'production' : 'sandbox')
  const consumerKey = process.env.MPESA_CONSUMER_KEY
  const consumerSecret = process.env.MPESA_CONSUMER_SECRET
  const shortcode = process.env.MPESA_SHORTCODE
  const passkey = process.env.MPESA_PASSKEY
  const callbackUrl = process.env.MPESA_CALLBACK_URL
  const resolvedConsumerKey = settings?.consumer_key || consumerKey
  const resolvedConsumerSecret = settings?.consumer_secret || consumerSecret
  const resolvedShortcode = configuredEnvironment === 'sandbox' ? '174379' : settings?.business_shortcode || shortcode
  const resolvedPasskey = settings?.passkey || passkey
  const resolvedCallbackUrl = settings?.callback_url || callbackUrl
  const requiredFields: Array<[string, string | undefined | null]> = [
    ['consumer key', resolvedConsumerKey],
    ['consumer secret', resolvedConsumerSecret],
    ['PayBill shortcode', resolvedShortcode],
    ['Lipa na M-Pesa passkey', resolvedPasskey],
    ['callback URL', resolvedCallbackUrl],
  ]
  const missing = requiredFields
    .filter(([, value]) => !value)
    .map(([label]) => label)

  const platformValues = [
    settings?.consumer_key,
    settings?.consumer_secret,
    settings?.business_shortcode,
    settings?.passkey,
    settings?.callback_url,
  ].filter(Boolean).length
  const envValues = [
    consumerKey,
    consumerSecret,
    shortcode,
    passkey,
    callbackUrl,
  ].filter(Boolean).length
  const source = platformValues === 5 ? 'platform' : envValues === 5 ? 'env' : platformValues > 0 || envValues > 0 ? 'mixed' : 'none'

  if (missing.length > 0) {
    return {
      config: null,
      missing,
      source,
    }
  }

  return {
    config: {
      consumerKey: resolvedConsumerKey as string,
      consumerSecret: resolvedConsumerSecret as string,
      shortcode: resolvedShortcode as string,
      passkey: resolvedPasskey as string,
      callbackUrl: resolvedCallbackUrl as string,
      environment: configuredEnvironment,
      baseUrl: process.env.MPESA_BASE_URL || (configuredEnvironment === 'production' ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke'),
      transactionType: settings?.transaction_type || process.env.MPESA_TRANSACTION_TYPE || 'CustomerPayBillOnline',
      accountReference: settings?.account_reference || process.env.MPESA_ACCOUNT_REFERENCE || 'RETIVOX',
    },
    missing: [],
    source,
  }
}

export async function getDarajaConfigurationStatus() {
  const resolution = await resolveDarajaConfig()

  return {
    isConfigured: resolution.missing.length === 0,
    missing: resolution.missing,
    source: resolution.source,
    environment: resolution.config?.environment ?? process.env.MPESA_ENV ?? 'sandbox',
    shortcodeSet: Boolean(resolution.config?.shortcode || process.env.MPESA_SHORTCODE),
    callbackUrlSet: Boolean(resolution.config?.callbackUrl || process.env.MPESA_CALLBACK_URL),
    consumerKeySet: Boolean(resolution.config?.consumerKey || process.env.MPESA_CONSUMER_KEY),
    consumerSecretSet: Boolean(resolution.config?.consumerSecret || process.env.MPESA_CONSUMER_SECRET),
    passkeySet: Boolean(resolution.config?.passkey || process.env.MPESA_PASSKEY),
  }
}

export async function getDarajaPromptConfiguration() {
  const resolution = await resolveDarajaConfig()

  if (!resolution.config) {
    if (process.env.MPESA_ENV === 'production') {
      throw new Error(`Subscription M-Pesa STK Push is not configured. Missing: ${resolution.missing.join(', ')}.`)
    }

    return {
      environment: 'sandbox',
      shortcode: '174379',
      transactionType: process.env.MPESA_TRANSACTION_TYPE || 'CustomerPayBillOnline',
      accountReference: process.env.MPESA_ACCOUNT_REFERENCE || 'RETIVOX',
      callbackUrl: process.env.MPESA_CALLBACK_URL || '',
      isTestMode: true,
      missing: resolution.missing,
    } satisfies DarajaPromptConfiguration
  }

  return {
    environment: resolution.config.environment,
    shortcode: resolution.config.shortcode,
    transactionType: resolution.config.transactionType,
    accountReference: resolution.config.accountReference,
    callbackUrl: resolution.config.callbackUrl,
    isTestMode: false,
    missing: [],
  } satisfies DarajaPromptConfiguration
}

function getTimestamp() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Nairobi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date())
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ''

  return `${value('year')}${value('month')}${value('day')}${value('hour')}${value('minute')}${value('second')}`
}

export function normalizeKenyanPhoneNumber(phone: string) {
  const rawPhone = String(phone ?? '').trim()

  if (!rawPhone) {
    throw new Error('Enter a Safaricom phone number.')
  }

  if (/[^0-9+\s\-()]/.test(rawPhone)) {
    throw new Error('Enter a valid Kenyan Safaricom phone number.')
  }

  const digits = rawPhone.replace(/[\s\-()+]/g, '')
  let normalized = ''

  if (/^0[17]\d{8}$/.test(digits)) {
    normalized = `254${digits.slice(1)}`
  } else if (/^[17]\d{8}$/.test(digits)) {
    normalized = `254${digits}`
  } else if (/^254[17]\d{8}$/.test(digits)) {
    normalized = digits
  }

  if (!normalized) {
    throw new Error('Enter a valid Kenyan Safaricom phone number.')
  }

  return normalized
}

export function normalizeKenyanPhone(phone: string) {
  return normalizeKenyanPhoneNumber(phone)
}

async function getAccessToken(config: DarajaConfig) {
  const credentials = Buffer.from(`${config.consumerKey}:${config.consumerSecret}`).toString('base64')
  const response = await fetch(`${config.baseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
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
  const amount = Number(input.amount)
  const phone = normalizeKenyanPhoneNumber(input.phone)

  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error('Enter a valid whole-number payment amount.')
  }

  const resolution = await resolveDarajaConfig()

  if (!resolution.config) {
    if (process.env.MPESA_ENV === 'production') {
      throw new Error(`Subscription M-Pesa STK Push is not configured. Missing: ${resolution.missing.join(', ')}.`)
    }

    const testId = `${Date.now()}${phone.slice(-4)}`

    return {
      MerchantRequestID: `TEST-MERCHANT-${testId}`,
      CheckoutRequestID: `TEST-CHECKOUT-${testId}`,
      ResponseCode: '0',
      ResponseDescription: `Sandbox test request recorded locally. No real M-Pesa prompt was sent because ${resolution.missing.join(', ')} ${resolution.missing.length === 1 ? 'is' : 'are'} not configured.`,
      CustomerMessage: 'Test mode: request recorded. No real M-Pesa prompt was sent.',
    }
  }

  const config = resolution.config
  const accessToken = await getAccessToken(config)
  const timestamp = getTimestamp()
  const password = Buffer.from(`${config.shortcode}${config.passkey}${timestamp}`).toString('base64')

  const response = await fetch(`${config.baseUrl}/mpesa/stkpush/v1/processrequest`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      BusinessShortCode: config.shortcode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: config.environment === 'sandbox' ? 'CustomerPayBillOnline' : config.transactionType,
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
