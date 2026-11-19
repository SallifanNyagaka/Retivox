import { NextResponse } from 'next/server'
import { z } from 'zod'
import {
  getBusinessDarajaConfig,
  registerDarajaC2BCallbacksWithConfig,
  testBusinessDarajaConnection,
} from '../../../../lib/payments/daraja'
import {
  getBusinessPesapalSetup,
  registerPesapalIpn,
  testBusinessPesapalConnection,
} from '../../../../lib/payments/pesapal'
import { requestOrigin } from '../../../../lib/requestOrigin'
import { createServiceRoleClient } from '../../../../lib/supabase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const saveSchema = z.object({
  action: z.literal('save'),
  provider: z.enum(['daraja', 'pesapal']),
  environment: z.enum(['sandbox', 'production']),
  businessShortcode: z.string().trim().max(40).optional(),
  tillNumber: z.string().trim().max(40).optional(),
  accountReference: z.string().trim().max(40).optional(),
  transactionType: z.enum(['CustomerPayBillOnline', 'CustomerBuyGoodsOnline']).optional(),
  callbackUrl: z.string().trim().url().max(500),
  consumerKey: z.string().trim().max(500).optional(),
  consumerSecret: z.string().trim().max(2000).optional(),
  passkey: z.string().trim().max(2000).optional(),
})

const actionSchema = z.object({
  action: z.enum(['test', 'register_daraja_c2b', 'register_pesapal_ipn']),
  provider: z.enum(['daraja', 'pesapal']).optional(),
})

type OwnerProfile = {
  id: string
  business_id: string | null
  global_role: string | null
  is_active: boolean | null
  deleted_at: string | null
}

async function authorizeOwner(request: Request) {
  const authorization = request.headers.get('authorization') ?? ''
  const token = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length).trim()
    : ''
  if (!token || token.length > 8192) {
    return { response: json({ error: 'Sign in online before configuring payment providers.' }, 401) } as const
  }

  let service
  try {
    service = createServiceRoleClient()
  } catch {
    return { response: json({ error: 'Payment settings are temporarily unavailable.' }, 503) } as const
  }

  const { data: auth, error: authError } = await service.auth.getUser(token)
  if (authError || !auth.user) {
    return { response: json({ error: 'Your online session is invalid or expired.' }, 401) } as const
  }

  const { data, error } = await service
    .from('users')
    .select('id, business_id, global_role, is_active, deleted_at')
    .eq('id', auth.user.id)
    .maybeSingle()
  const profile = data as OwnerProfile | null
  if (error || !profile || profile.global_role !== 'owner' || profile.is_active !== true || profile.deleted_at !== null) {
    return { response: json({ error: 'Only an active business owner can configure payment providers.' }, 403) } as const
  }
  if (!profile.business_id) {
    return { response: json({ error: 'Business context is missing.' }, 403) } as const
  }
  return { service, profile } as const
}

export async function GET(request: Request) {
  const authorized = await authorizeOwner(request)
  if ('response' in authorized) return authorized.response
  const { service, profile } = authorized

  const [{ data, error }, { data: pesapal, error: pesapalError }] = await Promise.all([
    service.rpc('owner_my_payment_provider_settings_v2', {
      p_business_id: profile.business_id,
      p_actor_id: profile.id,
    }),
    service.from('business_payment_provider_settings')
      .select('pesapal_ipn_id')
      .eq('business_id', profile.business_id)
      .eq('provider', 'pesapal')
      .maybeSingle(),
  ])
  if (error || pesapalError) {
    return json({ error: 'Could not load business payment settings. Apply migration 074 if this feature is not installed.' }, 503)
  }

  const providers = Array.isArray(data) ? data : []
  return json({
    success: true,
    data: {
      providers: providers.map((row) => ({
        ...row,
        pesapal_ipn_ready: row.provider === 'pesapal' && Boolean(pesapal?.pesapal_ipn_id),
      })),
      methods: {
        cash: true,
        mobile_manual: true,
        daraja_prompt: providers.some((row) => row.provider === 'daraja' && row.is_active && row.consumer_key_set && row.consumer_secret_set && row.passkey_set),
        pesapal_checkout: providers.some((row) => row.provider === 'pesapal' && row.is_active && row.consumer_key_set && row.consumer_secret_set && Boolean(pesapal?.pesapal_ipn_id)),
      },
    },
  })
}

export async function POST(request: Request) {
  const authorized = await authorizeOwner(request)
  if ('response' in authorized) return authorized.response
  const { service, profile } = authorized
  let body: unknown
  try {
    const text = await request.text()
    if (text.length > 12_000) return json({ error: 'Payment settings request is too large.' }, 413)
    body = JSON.parse(text)
  } catch {
    return json({ error: 'Invalid request body.' }, 400)
  }

  const action = typeof body === 'object' && body !== null && 'action' in body
    ? (body as { action?: unknown }).action
    : undefined

  if (action === 'save') {
    const parsed = saveSchema.safeParse(body)
    if (!parsed.success) return json({ error: parsed.error.issues[0]?.message ?? 'Check the payment provider values.' }, 400)
    const settings = parsed.data
    if (settings.provider === 'daraja' && (!settings.businessShortcode || !settings.transactionType || (settings.transactionType === 'CustomerBuyGoodsOnline' && !settings.tillNumber))) {
      return json({ error: 'Daraja requires a Store/API shortcode and transaction type. Buy Goods also requires its customer-facing Till.' }, 400)
    }
    try {
      const callback = new URL(settings.callbackUrl)
      if (callback.protocol !== 'https:') return json({ error: 'Provider callback URLs must use HTTPS.' }, 400)
    } catch {
      return json({ error: 'Enter a valid provider callback URL.' }, 400)
    }

    const previousPesapal = settings.provider === 'pesapal'
      ? await service.from('business_payment_provider_settings')
        .select('id,environment,callback_url')
        .eq('business_id', profile.business_id)
        .eq('provider', 'pesapal')
        .maybeSingle()
      : { data: null, error: null }
    if (previousPesapal.error) return json({ error: 'Could not verify current Pesapal settings.' }, 500)

    const { error } = await service.rpc('owner_save_payment_provider_settings_v2', {
      p_business_id: profile.business_id,
      p_updated_by: profile.id,
      p_provider: settings.provider,
      p_environment: settings.environment,
      p_business_shortcode: settings.businessShortcode || null,
      p_till_number: settings.tillNumber || null,
      p_account_reference: settings.accountReference || 'RETIVOX',
      p_transaction_type: settings.transactionType || 'CustomerPayBillOnline',
      p_callback_url: settings.callbackUrl,
      p_consumer_key: settings.consumerKey || null,
      p_consumer_secret: settings.consumerSecret || null,
      p_passkey: settings.passkey || null,
    })
    if (error) {
      return json({ error: error.message.includes('required provider credentials')
        ? 'Enter all required credentials the first time you configure this provider.'
        : 'Could not save provider settings. Check the values and try again.' }, 400)
    }
    if (settings.provider === 'pesapal' && previousPesapal.data &&
        (previousPesapal.data.environment !== settings.environment || previousPesapal.data.callback_url !== settings.callbackUrl)) {
      const { error: resetIpnError } = await service.from('business_payment_provider_settings')
        .update({ pesapal_ipn_id: null })
        .eq('id', previousPesapal.data.id)
      if (resetIpnError) return json({ error: 'Settings were saved, but the previous Pesapal IPN status could not be cleared. Register and verify the current callback before accepting checkouts.' }, 500)
    }
    return json({ success: true, message: 'Provider settings saved securely.' })
  }

  const parsed = actionSchema.safeParse(body)
  if (!parsed.success) return json({ error: parsed.error.issues[0]?.message ?? 'Select a supported payment action.' }, 400)
  const { business_id: businessId, id: ownerId } = profile

  try {
    if (parsed.data.action === 'test') {
      const provider = parsed.data.provider
      if (!provider) return json({ error: 'Select a payment provider to test.' }, 400)
      const message = provider === 'daraja'
        ? await testBusinessDarajaConnection(businessId!, ownerId)
        : await testBusinessPesapalConnection(businessId!)
      return json({ success: true, message })
    }

    const origin = requestOrigin(new Headers(request.headers))
    if (parsed.data.action === 'register_daraja_c2b') {
      const config = await getBusinessDarajaConfig(businessId!, ownerId)
      const message = await registerDarajaC2BCallbacksWithConfig(
        config,
        new URL('/api/payments/daraja/c2b/callback', origin).toString(),
        new URL('/api/payments/daraja/c2b/validation', origin).toString(),
      )
      return json({ success: true, message })
    }

    const setup = await getBusinessPesapalSetup(businessId!)
    const ipnId = setup.config.ipnId ?? await registerPesapalIpn(setup.config)
    if (!setup.config.ipnId) {
      const { error } = await service.from('business_payment_provider_settings')
        .update({ pesapal_ipn_id: ipnId })
        .eq('business_id', businessId)
        .eq('provider', 'pesapal')
        .eq('is_active', true)
      if (error) throw new Error('Pesapal registered the callback, but Retivox could not save its ID. Check the status before retrying.')
    }
    return json({ success: true, message: `Pesapal callback registered (${ipnId}).` })
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'The provider action could not be completed.' }, 400)
  }
}

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'private, no-store, max-age=0' },
  })
}
