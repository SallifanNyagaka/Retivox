'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { GlobalRole } from '@smartretail/shared'
import { requireRole } from '../../../../../lib/auth/helpers'
import { createServiceRoleClient } from '../../../../../lib/supabase/admin'
import { createClient } from '../../../../../lib/supabase/server'
import { getBusinessDarajaConfig, registerDarajaC2BCallbacksWithConfig, testBusinessDarajaConnection } from '../../../../../lib/payments/daraja'
import { getBusinessPesapalSetup, registerPesapalIpn, testBusinessPesapalConnection } from '../../../../../lib/payments/pesapal'
import { requestOrigin } from '../../../../../lib/requestOrigin'
import { headers } from 'next/headers'

export type PaymentProviderFormState = {
  success: boolean
  error: string | null
  message?: string | null
}

export type C2BRegistrationState = { success: boolean; error: string | null; message: string | null }
export type PesapalIpnState = { success: boolean; error: string | null; message: string | null }

export async function testPaymentProviderConnection(_previous: PaymentProviderFormState, formData: FormData): Promise<PaymentProviderFormState> {
  void _previous
  const profile = await requireRole([GlobalRole.Owner])
  if (!profile.business_id) return { success: false, error: 'Business account is unavailable.' }
  const provider = value(formData, 'provider')
  try {
    const message = provider === 'daraja'
      ? await testBusinessDarajaConnection(profile.business_id, profile.id)
      : provider === 'pesapal'
        ? await testBusinessPesapalConnection(profile.business_id)
        : null
    if (!message) return { success: false, error: 'Select a supported payment provider.' }
    return { success: true, error: null, message }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Provider connection test failed.' }
  }
}

export async function registerPesapalBusinessIpn(
  _previous: PesapalIpnState,
  _formData: FormData,
): Promise<PesapalIpnState> {
  void _previous
  void _formData
  const profile = await requireRole([GlobalRole.Owner])
  if (!profile.business_id) return { success: false, error: 'Business account is unavailable.', message: null }
  try {
    const setup = await getBusinessPesapalSetup(profile.business_id)
    if (setup.config.ipnId) return { success: true, error: null, message: `Pesapal IPN is registered (${setup.config.ipnId}).` }
    const ipnId = await registerPesapalIpn(setup.config)
    const serviceClient = createServiceRoleClient()
    const { error } = await serviceClient.from('business_payment_provider_settings')
      .update({ pesapal_ipn_id: ipnId })
      .eq('business_id', profile.business_id).eq('provider', 'pesapal').eq('is_active', true)
    if (error) throw new Error('Pesapal registered the IPN, but Retivox could not save its ID. Check the provider settings before registering again.')
    const { data: setting } = await serviceClient.from('business_payment_provider_settings').select('id')
      .eq('business_id', profile.business_id).eq('provider', 'pesapal').maybeSingle()
    if (setting) await serviceClient.from('audit_logs').insert({
      business_id: profile.business_id, actor_id: profile.id, entity_type: 'payment_provider', entity_id: setting.id,
      action: 'pesapal_ipn_registered', new_value: { ipn_id: ipnId, callback_url: setup.config.callbackUrl },
    })
    revalidatePath('/dashboard/owner/settings/payments')
    return { success: true, error: null, message: 'Pesapal IPN registered. Hosted checkouts can now verify through provider status checks.' }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Could not register Pesapal IPN.', message: null }
  }
}

export async function registerDarajaC2BCallbacks(
  _previous: C2BRegistrationState,
  _formData: FormData,
): Promise<C2BRegistrationState> {
  void _previous
  void _formData
  const profile = await requireRole([GlobalRole.Owner])
  if (!profile.business_id) return { success: false, error: 'Business account is unavailable.', message: null }
  try {
    const origin = requestOrigin(await headers())
    const [config, serviceClient] = await Promise.all([
      getBusinessDarajaConfig(profile.business_id, profile.id),
      Promise.resolve(createServiceRoleClient()),
    ])
    const confirmationUrl = new URL('/api/payments/daraja/c2b/callback', origin).toString()
    const validationUrl = new URL('/api/payments/daraja/c2b/validation', origin).toString()
    const message = await registerDarajaC2BCallbacksWithConfig(config, confirmationUrl, validationUrl)
    const { data: setting } = await serviceClient.from('business_payment_provider_settings')
      .select('id').eq('business_id', profile.business_id).eq('provider', 'daraja').maybeSingle()
    if (setting) {
      const { error: auditError } = await serviceClient.from('audit_logs').insert({
        business_id: profile.business_id, actor_id: profile.id, entity_type: 'payment_provider', entity_id: setting.id,
        action: 'daraja_c2b_urls_registered', new_value: { confirmation_url: confirmationUrl, validation_url: validationUrl },
      })
      if (auditError) throw new Error('Daraja accepted the callback registration, but the audit record could not be saved. Check the Daraja status before registering again.')
    }
    revalidatePath('/dashboard/owner/settings/payments')
    return { success: true, error: null, message }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Could not register Daraja C2B callbacks.', message: null }
  }
}

const providerSettingsSchema = z.object({
  provider: z.enum(['daraja', 'pesapal']),
  environment: z.enum(['sandbox', 'production']),
  businessShortcode: z.string().trim().max(40).optional(),
  accountReference: z.string().trim().max(40).optional(),
  transactionType: z.enum(['CustomerPayBillOnline', 'CustomerBuyGoodsOnline']).optional(),
  callbackUrl: z.string().trim().url().max(500),
  consumerKey: z.string().trim().max(500).optional(),
  consumerSecret: z.string().trim().max(2000).optional(),
  passkey: z.string().trim().max(2000).optional(),
})

function value(formData: FormData, key: string) {
  const item = formData.get(key)
  return typeof item === 'string' ? item.trim() : ''
}

export async function savePaymentProviderSettings(
  _previous: PaymentProviderFormState,
  formData: FormData,
): Promise<PaymentProviderFormState> {
  const profile = await requireRole([GlobalRole.Owner])
  if (!profile.business_id) return { success: false, error: 'Business account is unavailable.' }

  const parsed = providerSettingsSchema.safeParse({
    provider: value(formData, 'provider'),
    environment: value(formData, 'environment'),
    businessShortcode: value(formData, 'businessShortcode'),
    accountReference: value(formData, 'accountReference'),
    transactionType: value(formData, 'transactionType'),
    callbackUrl: value(formData, 'callbackUrl'),
    consumerKey: value(formData, 'consumerKey'),
    consumerSecret: value(formData, 'consumerSecret'),
    passkey: value(formData, 'passkey'),
  })
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? 'Check the provider settings.' }

  const settings = parsed.data
  if (settings.provider === 'daraja' && (!settings.businessShortcode || !settings.transactionType)) {
    return { success: false, error: 'Daraja needs a shortcode and transaction type.' }
  }

  const serviceClient = createServiceRoleClient()
  const { data: previousProviderSettings } = settings.provider === 'pesapal'
    ? await serviceClient.from('business_payment_provider_settings').select('id,environment,callback_url')
      .eq('business_id', profile.business_id).eq('provider', 'pesapal').maybeSingle()
    : { data: null }
  const { error } = await serviceClient.rpc('owner_save_payment_provider_settings', {
    p_business_id: profile.business_id,
    p_updated_by: profile.id,
    p_provider: settings.provider,
    p_environment: settings.environment,
    p_business_shortcode: settings.businessShortcode || null,
    p_account_reference: settings.accountReference || 'RETIVOX',
    p_transaction_type: settings.transactionType || 'CustomerPayBillOnline',
    p_callback_url: settings.callbackUrl,
    p_consumer_key: settings.consumerKey || null,
    p_consumer_secret: settings.consumerSecret || null,
    p_passkey: settings.passkey || null,
  })

  if (error) {
    return {
      success: false,
      error: error.message.includes('required provider credentials')
        ? 'Enter all required credentials the first time you configure this provider.'
        : 'Could not save provider settings. Check the values and try again.',
    }
  }

  if (settings.provider === 'pesapal' && previousProviderSettings
      && (previousProviderSettings.environment !== settings.environment || previousProviderSettings.callback_url !== settings.callbackUrl)) {
    const { error: resetIpnError } = await serviceClient.from('business_payment_provider_settings')
      .update({ pesapal_ipn_id: null }).eq('id', previousProviderSettings.id)
    if (resetIpnError) return { success: false, error: 'Settings were saved, but the prior Pesapal IPN status could not be cleared. Register and verify the current callback before accepting checkouts.' }
  }

  revalidatePath('/dashboard/owner/settings/payments')
  revalidatePath('/dashboard/owner/settings')
  return { success: true, error: null }
}

export async function requestAssistedIntegrationSetup(formData: FormData): Promise<void> {
  const profile = await requireRole([GlobalRole.Owner])
  if (!profile.business_id) throw new Error('Business account is unavailable.')
  const provider = value(formData, 'setupProvider')
  const notes = value(formData, 'requestNotes').slice(0, 2000)
  const promotionCode = value(formData, 'promotionCode').slice(0, 40)
  if (!['daraja','pesapal','card_gateway','bank_transfer'].includes(provider)) throw new Error('Select a supported integration.')
  const supabase = await createClient()
  const { error } = await supabase.rpc('owner_request_integration_setup', {
    p_provider: provider,
    p_request_notes: notes,
    p_promotion_code: promotionCode || null,
  })
  if (error) {
    if (error.message.includes('owner_request_integration_setup')) {
      throw new Error('Assisted setup pricing is not ready yet. Apply the current database migration and retry.')
    }
    throw new Error(error.message)
  }
  revalidatePath('/dashboard/owner/settings/payments')
}
