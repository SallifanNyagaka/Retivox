/**
 * Daraja STK Push client for subscription payments.
 *
 * Credentials and callback settings are managed in the platform payment
 * settings form. Provider credentials are decrypted server-side from Vault.
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

type DarajaStkQueryResponse = {
  ResponseCode?: string | number
  ResultCode?: string | number
  ResultDesc?: string
  ResponseDescription?: string
}

export type DarajaPromptConfiguration = {
  environment: 'sandbox' | 'production'
  shortcode: string
  tillNumber: string | null
  transactionType: string
  accountReference: string
  callbackUrl: string
  isTestMode: boolean
  missing: string[]
}

export type DarajaConfig = {
  consumerKey: string
  consumerSecret: string
  shortcode: string
  tillNumber: string | null
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
  till_number: string | null
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
  source: 'platform' | 'none'
}

async function getPlatformDarajaSettings(): Promise<PlatformPaymentSettingsRow | null> {
  try {
    const serviceClient = createServiceRoleClient()
    const { data, error } = await serviceClient.rpc('platform_get_daraja_settings_v2')

    if (error) {
      return null
    }

    const row = Array.isArray(data) ? data[0] : null
    return (row as PlatformPaymentSettingsRow | undefined) ?? null
  } catch {
    return null
  }
}

async function resolveDarajaConfig(): Promise<DarajaConfigResolution> {
  const settings = await getPlatformDarajaSettings()
  const configuredEnvironment = settings?.environment ?? 'sandbox'
  const resolvedConsumerKey = settings?.consumer_key ?? null
  const resolvedConsumerSecret = settings?.consumer_secret ?? null
  const resolvedShortcode = settings?.business_shortcode ?? null
  const resolvedPasskey = settings?.passkey ?? null
  const resolvedCallbackUrl = settings?.callback_url ?? null
  const requiredFields: Array<[string, string | undefined | null]> = [
    ['consumer key', resolvedConsumerKey],
    ['consumer secret', resolvedConsumerSecret],
    ['Store/API shortcode', resolvedShortcode],
    ['Lipa na M-Pesa passkey', resolvedPasskey],
    ['callback URL', resolvedCallbackUrl],
  ]
  const missing = requiredFields
    .filter(([, value]) => !value)
    .map(([label]) => label)

  const source = settings ? 'platform' : 'none'

  if (missing.length > 0) {
    return {
      config: null,
      missing,
      source,
    }
  }

  const transactionType = settings?.transaction_type || 'CustomerPayBillOnline'
  const tillNumber = settings?.till_number?.trim() || null
  if (transactionType === 'CustomerBuyGoodsOnline' && !tillNumber) {
    missing.push('Buy Goods Till number')
    return { config: null, missing, source }
  }

  return {
    config: {
      consumerKey: resolvedConsumerKey as string,
      consumerSecret: resolvedConsumerSecret as string,
      shortcode: resolvedShortcode as string,
      tillNumber,
      passkey: resolvedPasskey as string,
      callbackUrl: resolvedCallbackUrl as string,
      environment: configuredEnvironment,
      baseUrl: configuredEnvironment === 'production' ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke',
      transactionType,
      accountReference: settings?.account_reference || 'RETIVOX',
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
    environment: resolution.config?.environment ?? 'sandbox',
    shortcodeSet: Boolean(resolution.config?.shortcode),
    callbackUrlSet: Boolean(resolution.config?.callbackUrl),
    consumerKeySet: Boolean(resolution.config?.consumerKey),
    consumerSecretSet: Boolean(resolution.config?.consumerSecret),
    passkeySet: Boolean(resolution.config?.passkey),
  }
}

export async function getDarajaPromptConfiguration() {
  const resolution = await resolveDarajaConfig()

  if (!resolution.config) {
    throw new Error(`Subscription M-Pesa STK Push is not configured. Missing: ${resolution.missing.join(', ')}.`)
  }

  return {
    environment: resolution.config.environment,
    shortcode: resolution.config.shortcode,
    tillNumber: resolution.config.tillNumber,
    transactionType: resolution.config.transactionType,
    accountReference: resolution.config.accountReference,
    callbackUrl: resolution.config.callbackUrl,
    isTestMode: resolution.config.environment === 'sandbox',
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
    signal: AbortSignal.timeout(15000),
  })

  const payload = (await response.json()) as { access_token?: string; errorMessage?: string }

  if (!response.ok || !payload.access_token) {
    throw new Error(payload.errorMessage ?? 'Unable to authenticate with Daraja')
  }

  return payload.access_token
}

/** Checks merchant credentials using OAuth only; it does not initiate a payment. */
export async function testBusinessDarajaConnection(businessId: string, ownerId: string) {
  const config = await getBusinessDarajaConfig(businessId, ownerId)
  await getAccessToken(config)
  return `Daraja credentials authenticated successfully in ${config.environment} mode. No payment prompt was sent.`
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
    throw new Error(`Subscription M-Pesa STK Push is not configured. Missing: ${resolution.missing.join(', ')}.`)
  }

  return initiateDarajaStkPushWithConfig({ ...input, phone }, resolution.config)
}

export async function getBusinessDarajaConfig(businessId: string, ownerId: string): Promise<DarajaConfig> {
  const serviceClient = createServiceRoleClient()
  const { data, error } = await serviceClient.rpc('owner_get_payment_provider_config_v2', {
    p_business_id: businessId,
    p_actor_id: ownerId,
    p_provider: 'daraja',
  })
  if (error) throw new Error('Could not load the business M-Pesa configuration.')
  const row = Array.isArray(data) ? data[0] as PlatformPaymentSettingsRow | undefined : undefined
  if (!row?.consumer_key || !row.consumer_secret || !row.passkey || !row.business_shortcode || !row.callback_url) {
    throw new Error('Configure and save the business Daraja credentials before using M-Pesa prompts.')
  }
  let callback: URL
  try { callback = new URL(row.callback_url) } catch { throw new Error('The saved Daraja callback URL is invalid.') }
  if (callback.protocol !== 'https:') throw new Error('The Daraja callback URL must use HTTPS.')
  return {
    consumerKey: row.consumer_key,
    consumerSecret: row.consumer_secret,
    passkey: row.passkey,
    shortcode: row.business_shortcode,
    tillNumber: row.till_number?.trim() || null,
    callbackUrl: callback.toString(),
    environment: row.environment,
    baseUrl: row.environment === 'production' ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke',
    transactionType: row.transaction_type || 'CustomerPayBillOnline',
    accountReference: row.account_reference || 'RETIVOX',
  }
}

export async function initiateDarajaStkPushWithConfig(input: {
  phone: string
  amount: number
  accountReference?: string
  transactionDescription: string
}, config: DarajaConfig): Promise<DarajaStkPushResponse> {
  const amount = Number(input.amount)
  const phone = normalizeKenyanPhoneNumber(input.phone)
  if (!Number.isInteger(amount) || amount <= 0) throw new Error('Enter a valid whole-number payment amount.')
  const accessToken = await getAccessToken(config)
  const timestamp = getTimestamp()
  const requestBody = buildDarajaStkRequestBody(input, config, timestamp)

  const response = await fetch(`${config.baseUrl}/mpesa/stkpush/v1/processrequest`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ...requestBody, Amount: amount, PartyA: phone, PhoneNumber: phone }),
    cache: 'no-store',
    signal: AbortSignal.timeout(15000),
  })

  const payload = (await response.json()) as DarajaStkPushResponse

  if (!response.ok || payload.errorCode || payload.ResponseCode !== '0') {
    throw new Error(payload.errorMessage ?? payload.ResponseDescription ?? 'Daraja STK Push request failed')
  }

  return payload
}

export function buildDarajaStkRequestBody(
  input: { accountReference?: string; transactionDescription: string },
  config: DarajaConfig,
  timestamp: string,
) {
  const transactionType = config.environment === 'sandbox' ? 'CustomerPayBillOnline' : config.transactionType
  const partyB = transactionType === 'CustomerBuyGoodsOnline'
    ? config.tillNumber?.trim()
    : config.shortcode
  if (!partyB) throw new Error('Configure the customer-facing Buy Goods Till before sending STK prompts.')
  return {
    BusinessShortCode: config.shortcode,
    Password: Buffer.from(`${config.shortcode}${config.passkey}${timestamp}`).toString('base64'),
    Timestamp: timestamp,
    TransactionType: transactionType,
    PartyB: partyB,
    CallBackURL: config.callbackUrl,
    AccountReference: (input.accountReference || config.accountReference).slice(0, 12),
    TransactionDesc: input.transactionDescription.slice(0, 64),
  }
}

/** 4999 is a non-final Daraja status-query result; it must not defeat a callback. */
export function shouldDeferSuccessfulDarajaCallback(statusQueryResultCode: number) {
  return statusQueryResultCode !== 0 && statusQueryResultCode !== 4999
}

export function shouldQueryDarajaStatusForCallback(callbackResultCode: number) {
  return callbackResultCode === 0
}

export function isDarajaPaymentTerminal(status: string) {
  return status === 'verified' || status === 'rejected' || status === 'voided'
}

export function getDarajaCallbackDisposition(paymentStatus: string, callbackResultCode: number) {
  if (isDarajaPaymentTerminal(paymentStatus)) return 'already_processed' as const
  return callbackResultCode === 0 ? 'verified' as const : 'failed' as const
}

export async function verifyDarajaStkCheckout(checkoutRequestId: string): Promise<number> {
  const resolution = await resolveDarajaConfig()

  if (!resolution.config) {
    throw new Error(`Subscription M-Pesa STK Push is not configured. Missing: ${resolution.missing.join(', ')}.`)
  }

  return verifyDarajaStkCheckoutWithConfig(checkoutRequestId, resolution.config)
}

export async function verifyDarajaStkCheckoutWithConfig(checkoutRequestId: string, config: DarajaConfig): Promise<number> {
  const accessToken = await getAccessToken(config)
  const timestamp = getTimestamp()
  const password = Buffer.from(`${config.shortcode}${config.passkey}${timestamp}`).toString('base64')
  const response = await fetch(`${config.baseUrl}/mpesa/stkpushquery/v1/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      BusinessShortCode: config.shortcode,
      Password: password,
      Timestamp: timestamp,
      CheckoutRequestID: checkoutRequestId,
    }),
    cache: 'no-store',
    signal: AbortSignal.timeout(10000),
  })

  const payload = (await response.json()) as DarajaStkQueryResponse
  const responseCode = Number(payload.ResponseCode)
  const resultCode = Number(payload.ResultCode)

  if (!response.ok || responseCode !== 0 || !Number.isInteger(resultCode)) {
    throw new Error(payload.ResultDesc ?? payload.ResponseDescription ?? 'Unable to verify Daraja payment')
  }

  return resultCode
}

export async function registerDarajaC2BCallbacksWithConfig(
  config: DarajaConfig,
  confirmationUrl: string,
  validationUrl: string,
): Promise<string> {
  for (const value of [confirmationUrl, validationUrl]) {
    const parsed = new URL(value)
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
      throw new Error('Daraja callback URLs must be public HTTPS URLs.')
    }
  }
  const accessToken = await getAccessToken(config)
  const response = await fetch(`${config.baseUrl}/mpesa/c2b/v2/registerurl`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ShortCode: config.shortcode,
      ResponseType: 'Completed',
      ConfirmationURL: confirmationUrl,
      ValidationURL: validationUrl,
    }),
    cache: 'no-store',
    signal: AbortSignal.timeout(15000),
  })
  const payload = await response.json() as { ResponseDescription?: string; errorCode?: string; errorMessage?: string }
  if (!response.ok || payload.errorCode || payload.errorMessage) {
    throw new Error(payload.errorMessage ?? payload.ResponseDescription ?? 'Daraja rejected the C2B callback registration.')
  }
  return payload.ResponseDescription ?? 'C2B callback registration request accepted by Daraja.'
}
