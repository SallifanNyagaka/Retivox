'use server'

import { revalidatePath } from 'next/cache'
import { createServiceRoleClient } from '../../../lib/supabase/admin'
import { requirePlatformUser } from '../../../lib/platform/auth'
import logger from '../../../lib/logger'
import { registerPlatformPesapalIpn, processPlatformPesapalNotification, getPlatformPesapalSetup, requestPesapalRefund } from '../../../lib/payments/pesapal'
import type { PlatformLicenseAdjustmentState } from './businesses/license-adjustment-types'
import { z } from 'zod'

function getString(formData: FormData, key: string): string {
  const value = formData.get(key)
  return typeof value === 'string' ? value.trim() : ''
}

function getNumber(formData: FormData, key: string): number {
  const value = Number(getString(formData, key))
  return Number.isFinite(value) ? value : 0
}

async function requireDeveloper() {
  const user = await requirePlatformUser()

  if (user.role !== 'developer') {
    throw new Error('Only platform developers can perform this action')
  }

  return user
}

async function sendEmailOrQueue(input: {
  businessId: string
  recipientEmail: string
  subject: string
  body: string
}) {
  const serviceClient = createServiceRoleClient()
  const { data: configRows, error: configError } = await serviceClient.rpc('platform_get_email_delivery_config')
  const config = Array.isArray(configRows) ? configRows[0] as { from_email?: string; api_key?: string } | undefined : undefined
  const resendApiKey = config?.api_key
  const fromEmail = config?.from_email

  if (resendApiKey && fromEmail) {
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: fromEmail,
          to: input.recipientEmail,
          subject: input.subject,
          text: input.body,
        }),
        cache: 'no-store',
      })
      const payload = (await response.json()) as { id?: string; message?: string }

      await serviceClient.from('platform_email_outbox').insert({
        business_id: input.businessId,
        recipient_email: input.recipientEmail,
        subject: input.subject,
        body: input.body,
        status: response.ok ? 'sent' : 'failed',
        provider: 'resend',
        provider_message_id: payload.id ?? null,
        error_message: response.ok ? null : payload.message ?? 'Email provider rejected the message',
        sent_at: response.ok ? new Date().toISOString() : null,
      })

      return response.ok ? 'sent' : 'queued'
    } catch (error: unknown) {
      logger.error('sendEmailOrQueue: provider failed, queueing fallback', { error })
    }
  }

  await serviceClient.from('platform_email_outbox').insert({
    business_id: input.businessId,
    recipient_email: input.recipientEmail,
    subject: input.subject,
    body: input.body,
    status: 'queued',
    provider: !configError && resendApiKey ? 'resend' : null,
  })

  return 'queued'
}

export async function updatePlatformEmailSettings(formData: FormData): Promise<void> {
  const user = await requireDeveloper()
  const fromEmail = getString(formData, 'fromEmail').toLowerCase()
  const apiKey = getString(formData, 'apiKey')
  if (!fromEmail.includes('@')) throw new Error('Enter a valid sender email address')

  const serviceClient = createServiceRoleClient()
  const { data: settingId, error } = await serviceClient.rpc('platform_save_email_settings', {
    p_from_email: fromEmail,
    p_api_key: apiKey,
    p_updated_by: user.id,
  })
  if (error || !settingId) {
    logger.error('updatePlatformEmailSettings: secure credential save failed', { actorId: user.id, error })
    throw new Error('Unable to securely save email settings. Add the API key on first setup and try again.')
  }

  await serviceClient.from('platform_audit_logs').insert({
    platform_user_id: user.id,
    entity_type: 'platform_email_settings',
    entity_id: settingId,
    action: 'updated',
    new_value: { provider: 'resend', from_email: fromEmail },
  })
  revalidatePath('/platform/communications')
}

export async function updatePlatformRuntimeSettings(formData: FormData): Promise<void> {
  const user = await requireDeveloper()
  const rawUrl = getString(formData, 'webAppUrl')
  const registrationPath = getString(formData, 'accountRegistrationPath')
  let parsedUrl: URL
  try {
    parsedUrl = new URL(rawUrl)
  } catch {
    throw new Error('Enter a valid application URL')
  }
  if (!['https:', 'http:'].includes(parsedUrl.protocol)
      || parsedUrl.username || parsedUrl.password || parsedUrl.search || parsedUrl.hash
      || (parsedUrl.protocol === 'http:' && !['localhost', '127.0.0.1'].includes(parsedUrl.hostname))) {
    throw new Error('Use an HTTPS URL without a path, query, or credentials')
  }
  if (!/^\/[A-Za-z0-9/_-]*$/.test(registrationPath) || registrationPath.includes('//')) {
    throw new Error('Enter a valid same-site registration path, such as /register')
  }

  const serviceClient = createServiceRoleClient()
  const { error } = await serviceClient.rpc('platform_save_runtime_settings', {
    p_web_app_url: parsedUrl.origin,
    p_account_registration_path: registrationPath,
    p_updated_by: user.id,
  })
  if (error) throw new Error('Could not save the application URL. Apply migration 136 and try again.')

  await serviceClient.from('platform_audit_logs').insert({
    platform_user_id: user.id,
    entity_type: 'platform_runtime_settings',
    action: 'updated_web_app_url',
    old_value: null,
    new_value: { web_app_url: parsedUrl.origin, account_registration_path: registrationPath },
  })
  revalidatePath('/platform/settings')
}

async function getBusinessInactiveDays(businessId: string, createdAt: string) {
  const serviceClient = createServiceRoleClient()
  const [loginResponse, transactionResponse] = await Promise.all([
    serviceClient
      .from('platform_login_attempts')
      .select('created_at')
      .eq('business_id', businessId)
      .eq('surface', 'tenant')
      .eq('success', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    serviceClient
      .from('transactions')
      .select('recorded_at')
      .eq('business_id', businessId)
      .order('recorded_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])
  const dates = [
    createdAt,
    loginResponse.data?.created_at,
    transactionResponse.data?.recorded_at,
  ].filter(Boolean) as string[]
  const lastActivityAt = dates.sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] ?? createdAt

  return Math.floor((Date.now() - new Date(lastActivityAt).getTime()) / (24 * 60 * 60 * 1000))
}

export async function updateSubscriptionPlan(formData: FormData): Promise<void> {
  const user = await requireDeveloper()
  const planKey = getString(formData, 'planKey')
  const submittedName = getString(formData, 'name')
  const description = getString(formData, 'description')
  const currency = getString(formData, 'currency').toUpperCase() || 'KES'
  const monthlyAmount = getNumber(formData, 'monthlyAmount')
  const annualDiscountPercent = getNumber(formData, 'annualDiscountPercent')
  const yearlyAmount = Math.round(monthlyAmount * 12 * (1 - annualDiscountPercent / 100) * 100) / 100
  const lifetimeEnabled = getString(formData, 'lifetimeEnabled') === 'on'
  const lifetimeAmountValue = getString(formData, 'lifetimeAmount')
  const lifetimeAmount = lifetimeAmountValue ? Number(lifetimeAmountValue) : null
  const monthlyEnabled = planKey === 'trial' || getString(formData, 'monthlyEnabled') === 'on'
  const yearlyEnabled = planKey !== 'trial' && getString(formData, 'yearlyEnabled') === 'on'
  const trialDays = planKey === 'trial' ? getNumber(formData, 'trialDays') : 30
  let features: Record<string, unknown> = {}
  try {
    const parsedFeatures: unknown = JSON.parse(getString(formData, 'featuresJson') || '{}')
    if (parsedFeatures && typeof parsedFeatures === 'object' && !Array.isArray(parsedFeatures)) {
      features = parsedFeatures as Record<string, unknown>
    } else {
      throw new Error('Features must be a JSON object')
    }
  } catch {
    throw new Error('Enter plan features as a valid JSON object')
  }
  const branchLimitValue = getString(formData, 'branchLimit')
  const parsedBranchLimit = branchLimitValue ? Number(branchLimitValue) : null
  const branchLimit = parsedBranchLimit !== null && Number.isInteger(parsedBranchLimit) && parsedBranchLimit > 0
    ? parsedBranchLimit
    : null
  const isActive = planKey === 'trial' || getString(formData, 'isActive') === 'on'
  const name = planKey === 'trial' ? 'Free' : submittedName

  if (
    !/^[a-z][a-z0-9_]{1,39}$/.test(planKey) ||
    !name ||
    (planKey === 'trial' && name !== 'Free') ||
    monthlyAmount < 0 ||
    annualDiscountPercent < 0 ||
    annualDiscountPercent > 100 ||
    (planKey === 'trial' && (monthlyAmount !== 0 || annualDiscountPercent !== 0 || !isActive || lifetimeEnabled || yearlyEnabled)) ||
    !/^[A-Z]{3}$/.test(currency) ||
    !Number.isFinite(yearlyAmount) || yearlyAmount < 0 ||
      (monthlyEnabled && planKey !== 'trial' && monthlyAmount <= 0) ||
      (yearlyEnabled && yearlyAmount <= 0) ||
      (!monthlyEnabled && !yearlyEnabled && !lifetimeEnabled && planKey !== 'trial') ||
    (lifetimeEnabled && (!Number.isFinite(lifetimeAmount) || (lifetimeAmount ?? 0) <= 0)) ||
    (!Number.isInteger(trialDays) || trialDays < 0 || trialDays > 90) ||
    (branchLimitValue && branchLimit === null)
  ) {
    throw new Error('Enter valid package prices, limits, and billing options')
  }

  const serviceClient = createServiceRoleClient()
  const { data: existingPlan, error: lookupError } = await serviceClient
    .from('platform_subscription_plans')
    .select('name, description, monthly_amount, yearly_amount, lifetime_amount, currency, branch_limit, is_active, features, trial_days')
    .eq('plan_key', planKey)
    .single()
  if (lookupError || !existingPlan) throw new Error('Unable to load the current package before saving it')

  const { error } = await serviceClient
    .from('platform_subscription_plans')
    .update({
      name,
      description,
      monthly_amount: monthlyAmount,
      yearly_amount: yearlyAmount,
      lifetime_amount: lifetimeEnabled ? lifetimeAmount : null,
      monthly_enabled: monthlyEnabled,
      yearly_enabled: yearlyEnabled,
      lifetime_enabled: lifetimeEnabled,
      trial_days: trialDays,
      features,
      currency,
      annual_discount_percent: annualDiscountPercent,
      branch_limit: branchLimit,
      is_active: isActive,
      updated_by: user.id,
    })
    .eq('plan_key', planKey)

  if (error) {
    throw new Error(error.message)
  }

  await serviceClient.from('platform_audit_logs').insert({
    platform_user_id: user.id,
    entity_type: 'platform_subscription_plan',
    action: 'updated',
    old_value: existingPlan,
    new_value: {
      plan_key: planKey,
      monthly_amount: monthlyAmount,
      yearly_amount: yearlyAmount,
      lifetime_amount: lifetimeEnabled ? lifetimeAmount : null,
      monthly_enabled: monthlyEnabled,
      yearly_enabled: yearlyEnabled,
      lifetime_enabled: lifetimeEnabled,
      trial_days: trialDays,
      annual_discount_percent: annualDiscountPercent,
      currency,
      branch_limit: branchLimit,
      is_active: isActive,
      features,
    },
  })

  revalidatePath('/platform/pricing')
  revalidatePath('/platform')
  revalidatePath('/dashboard/owner/settings')
}

export async function createSubscriptionPlan(formData: FormData): Promise<void> {
  const user = await requireDeveloper()
  const planKey = getString(formData, 'planKey').toLowerCase()
  const name = getString(formData, 'name')
  const description = getString(formData, 'description')
  const currency = getString(formData, 'currency').toUpperCase() || 'KES'
  const monthlyAmount = getNumber(formData, 'monthlyAmount')
  const annualDiscountPercent = getNumber(formData, 'annualDiscountPercent')
  const yearlyAmount = Math.round(monthlyAmount * 12 * (1 - annualDiscountPercent / 100) * 100) / 100
  const lifetimeEnabled = getString(formData, 'lifetimeEnabled') === 'on'
  const lifetimeAmount = getString(formData, 'lifetimeAmount') ? Number(getString(formData, 'lifetimeAmount')) : null
  const branchLimitRaw = getString(formData, 'branchLimit')
  const branchLimit = branchLimitRaw ? Number(branchLimitRaw) : null
  let features: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(getString(formData, 'featuresJson') || '{}')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('bad features')
    features = parsed as Record<string, unknown>
  } catch {
    throw new Error('Enter plan features as a valid JSON object')
  }
  const monthlyEnabled = getString(formData, 'monthlyEnabled') === 'on'
  const yearlyEnabled = getString(formData, 'yearlyEnabled') === 'on'

    if (!/^[a-z][a-z0-9_]{1,39}$/.test(planKey) || planKey === 'trial' || !name || monthlyAmount < 0
      || annualDiscountPercent < 0 || annualDiscountPercent > 100
      || !/^[A-Z]{3}$/.test(currency)
        || (monthlyEnabled && monthlyAmount <= 0)
        || (yearlyEnabled && yearlyAmount <= 0)
      || (branchLimit !== null && (!Number.isInteger(branchLimit) || branchLimit < 1))
      || (!monthlyEnabled && !yearlyEnabled && !lifetimeEnabled)
      || (lifetimeEnabled && (!Number.isFinite(lifetimeAmount) || (lifetimeAmount ?? 0) <= 0))) {
    throw new Error('Enter a unique plan key, valid prices, and at least one billing option')
  }

  const serviceClient = createServiceRoleClient()
  const { data, error } = await serviceClient.from('platform_subscription_plans').insert({
    plan_key: planKey,
    name,
    description,
    monthly_amount: monthlyAmount,
    yearly_amount: yearlyAmount,
    annual_discount_percent: annualDiscountPercent,
    lifetime_amount: lifetimeEnabled ? lifetimeAmount : null,
    monthly_enabled: monthlyEnabled,
    yearly_enabled: yearlyEnabled,
    lifetime_enabled: lifetimeEnabled,
    trial_days: 30,
    features,
    currency,
    branch_limit: branchLimit,
    is_active: true,
    updated_by: user.id,
  }).select('id').single()
  if (error || !data) throw new Error(error?.message ?? 'Unable to create the package')

  await serviceClient.from('platform_audit_logs').insert({
    platform_user_id: user.id,
    entity_type: 'platform_subscription_plan',
    entity_id: data.id,
    action: 'created',
    old_value: null,
    new_value: { plan_key: planKey, name, monthly_amount: monthlyAmount, yearly_amount: yearlyAmount, lifetime_amount: lifetimeEnabled ? lifetimeAmount : null, currency, branch_limit: branchLimit },
  })
  revalidatePath('/platform/pricing')
  revalidatePath('/dashboard/owner/settings')
}

export async function reviewSubscriptionPayment(formData: FormData): Promise<void> {
  const user = await requireDeveloper()
  const paymentRequestId = getString(formData, 'paymentRequestId')
  const decision = getString(formData, 'decision')
  const reviewNote = getString(formData, 'reviewNote').slice(0, 240)

  if (!/^[0-9a-f-]{36}$/i.test(paymentRequestId) || !['approve', 'reject'].includes(decision)) {
    throw new Error('Invalid subscription payment review')
  }

  const serviceClient = createServiceRoleClient()
  const { data, error } = await serviceClient.rpc('platform_review_subscription_payment', {
    p_payment_request_id: paymentRequestId,
    p_approved: decision === 'approve',
    p_platform_user_id: user.id,
    p_review_note: reviewNote || null,
  })

  if (error) {
    throw new Error(error.message)
  }
  if (data !== true) {
    throw new Error('This payment request is no longer pending review')
  }

  revalidatePath('/platform/payments')
  revalidatePath('/platform')
  revalidatePath('/dashboard/owner/settings')
}

const platformSubscriptionPaymentConfigSchema = z.object({
  manual_payment_options: z.array(z.object({
    id: z.string().uuid(),
    method: z.enum(['mpesa_manual', 'bank_transfer', 'cash_deposit', 'other']),
    label: z.string().trim().min(2).max(80),
    destination: z.string().trim().min(2).max(120),
    accountName: z.string().trim().max(120).default(''),
    accountReference: z.string().trim().max(120).default(''),
    instructions: z.string().trim().max(600).default(''),
    active: z.boolean().default(true),
  })).max(12),
  support_phone: z.string().trim().max(32).default(''),
  support_email: z.string().trim().max(254).email().or(z.literal('')).default(''),
  support_whatsapp: z.string().trim().max(32).default(''),
  support_website: z.string().trim().max(500).refine((value) => {
    if (!value) return true
    try {
      return ['https:', 'http:'].includes(new URL(value).protocol)
    } catch {
      return false
    }
  }, 'Enter a valid http or https support website.').default(''),
  support_message: z.string().trim().max(300).default('Need help with your subscription payment? Call or message us.'),
})

export async function savePlatformSubscriptionPaymentConfig(formData: FormData): Promise<{ success: boolean; error?: string }> {
  const user = await requireDeveloper()
  let input: unknown
  try {
    input = JSON.parse(getString(formData, 'config'))
  } catch {
    return { success: false, error: 'Payment settings could not be read.' }
  }
  const parsed = platformSubscriptionPaymentConfigSchema.safeParse(input)
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? 'Invalid payment settings.' }

  const serviceClient = createServiceRoleClient()
  const config = parsed.data
  const { error } = await serviceClient.from('platform_subscription_payment_config').upsert({
    id: true,
    manual_payment_options: config.manual_payment_options,
    support_phone: config.support_phone || null,
    support_email: config.support_email || null,
    support_whatsapp: config.support_whatsapp || null,
    support_website: config.support_website || null,
    support_message: config.support_message || 'Need help with your subscription payment? Call or message us.',
    updated_by: user.id,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'id' })
  if (error) {
    logger.error('Platform subscription payment configuration save failed', { error })
    return { success: false, error: 'Unable to save payment settings.' }
  }
  const { error: auditError } = await serviceClient.from('platform_audit_logs').insert({
    platform_user_id: user.id,
    entity_type: 'platform_subscription_payment_config',
    entity_id: 'true',
    action: 'updated',
    new_value: { option_count: config.manual_payment_options.length, active_option_count: config.manual_payment_options.filter((option) => option.active).length, support_channels: ['phone', 'email', 'whatsapp', 'website'].filter((channel) => Boolean(config[`support_${channel}` as keyof typeof config])) },
  })
  if (auditError) logger.error('Platform subscription payment configuration audit failed', { error: auditError })
  revalidatePath('/platform/payments')
  revalidatePath('/dashboard/owner/settings')
  return { success: true }
}

export async function recheckPlatformPesapalSubscription(formData: FormData): Promise<void> {
  const user = await requireDeveloper()
  const paymentRequestId = getString(formData, 'paymentRequestId')
  if (!/^[0-9a-f-]{36}$/i.test(paymentRequestId)) throw new Error('Invalid subscription payment request')
  const serviceClient = createServiceRoleClient()
  const { data: request, error } = await serviceClient.from('subscription_payment_requests')
    .select('id,pesapal_tracking_id,pesapal_merchant_reference,status')
    .eq('id', paymentRequestId).eq('provider', 'pesapal').maybeSingle()
  if (error || !request) throw new Error(error?.message ?? 'Pesapal subscription request not found')
  if (!request.pesapal_tracking_id) throw new Error('No Pesapal tracking ID is saved yet; ask the owner to retry checkout or review the provider portal.')
  const result = await processPlatformPesapalNotification(request.pesapal_tracking_id, request.pesapal_merchant_reference ?? undefined)
  await serviceClient.from('platform_audit_logs').insert({
    platform_user_id: user.id, entity_type: 'subscription_payment_request', entity_id: request.id,
    action: 'pesapal_status_rechecked', new_value: { matched: result.matched, verified: result.verified },
  })
  revalidatePath('/platform/payments')
  revalidatePath('/platform')
  revalidatePath('/dashboard/owner/settings')
}

export async function requestPlatformSubscriptionRefund(formData: FormData): Promise<void> {
  const user = await requireDeveloper()
  const paymentRequestId = getString(formData, 'paymentRequestId')
  const amount = getNumber(formData, 'amount')
  const reason = getString(formData, 'reason')
  if (!/^[0-9a-f-]{36}$/i.test(paymentRequestId) || amount <= 0 || reason.length < 10) {
    throw new Error('Choose a verified payment, enter a positive refund amount, and explain the reason (at least 10 characters)')
  }
  const client = createServiceRoleClient()
  const { error } = await client.rpc('platform_request_subscription_refund', {
    p_payment_request_id: paymentRequestId, p_amount: amount, p_reason: reason, p_platform_user_id: user.id,
  })
  if (error) throw new Error(error.message)
  revalidatePath('/platform/payments')
}

export async function reviewPlatformSubscriptionRefund(formData: FormData): Promise<void> {
  const user = await requireDeveloper()
  const refundId = getString(formData, 'refundId')
  const decision = getString(formData, 'decision')
  const note = getString(formData, 'note').slice(0, 500)
  if (!/^[0-9a-f-]{36}$/i.test(refundId) || !['approve', 'reject'].includes(decision)) throw new Error('Invalid subscription refund review')
  const client = createServiceRoleClient()
  const { data, error } = await client.rpc('platform_review_subscription_refund', {
    p_refund_id: refundId, p_approved: decision === 'approve', p_note: note, p_platform_user_id: user.id,
  })
  if (error) throw new Error(error.message)
  if (data !== true) throw new Error('This refund is no longer awaiting review')
  revalidatePath('/platform/payments')
}

export async function submitPlatformPesapalRefund(formData: FormData): Promise<void> {
  const user = await requireDeveloper()
  const refundId = getString(formData, 'refundId')
  if (!/^[0-9a-f-]{36}$/i.test(refundId)) throw new Error('Invalid refund request')
  const client = createServiceRoleClient()
  const { data: refund, error } = await client.from('platform_subscription_refunds')
    .select('id,payment_request_id,amount,reason,status,subscription_payment_requests!inner(provider,provider_receipt_number)')
    .eq('id', refundId).maybeSingle()
  if (error || !refund) throw new Error(error?.message ?? 'Refund request not found')
  const payment = Array.isArray(refund.subscription_payment_requests) ? refund.subscription_payment_requests[0] : refund.subscription_payment_requests
  if (refund.status !== 'approved' || payment?.provider !== 'pesapal' || !payment.provider_receipt_number) {
    throw new Error('Only an approved Pesapal refund with a verified confirmation code can be submitted.')
  }
  let setup: Awaited<ReturnType<typeof getPlatformPesapalSetup>>
  try { setup = await getPlatformPesapalSetup() } catch (setupError) {
    throw new Error(setupError instanceof Error ? setupError.message : 'Platform Pesapal credentials are unavailable.')
  }
  const { data: claimed, error: claimError } = await client.from('platform_subscription_refunds')
    .update({ status: 'processing', provider_submission_message: 'Submitting refund request to Pesapal.' })
    .eq('id', refund.id).eq('status', 'approved').select('id').maybeSingle()
  if (claimError || !claimed) throw new Error('This refund has already been submitted or changed.')
  try {
    const result = await requestPesapalRefund(setup.config, {
      confirmationCode: payment.provider_receipt_number, amount: Number(refund.amount),
      username: user.email || 'Retivox platform developer', remarks: refund.reason,
    })
    if (!result.accepted) {
      await client.from('platform_subscription_refunds').update({ status: 'approved', provider_submission_message: result.message }).eq('id', refund.id).eq('status', 'processing')
      revalidatePath('/platform/payments')
      throw new Error(result.message)
    }
    await client.from('platform_subscription_refunds').update({ provider_submission_at: new Date().toISOString(), provider_submission_message: result.message }).eq('id', refund.id).eq('status', 'processing')
    await client.from('platform_audit_logs').insert({ platform_user_id: user.id, entity_type: 'subscription_refund', entity_id: refund.id, action: 'pesapal_refund_submitted', new_value: { amount: refund.amount, message: result.message } })
  } catch (submissionError) {
    if (submissionError instanceof Error && submissionError.message !== 'This refund request has already been submitted or changed.') {
      const { data: current } = await client.from('platform_subscription_refunds').select('status,provider_submission_at').eq('id', refund.id).maybeSingle()
      if (current?.status === 'processing' && !current.provider_submission_at) {
        await client.from('platform_subscription_refunds').update({ provider_submission_message: `Submission result unknown: ${submissionError.message}. Check Pesapal before retrying.` }).eq('id', refund.id)
      }
    }
    revalidatePath('/platform/payments')
    throw new Error(`Pesapal refund status: ${submissionError instanceof Error ? submissionError.message : 'unknown response'}`)
  }
  revalidatePath('/platform/payments')
}

export async function recordPlatformSubscriptionRefund(formData: FormData): Promise<void> {
  const user = await requireDeveloper()
  const refundId = getString(formData, 'refundId')
  const providerReference = getString(formData, 'providerReference')
  if (!/^[0-9a-f-]{36}$/i.test(refundId) || providerReference.length < 3) throw new Error('Enter the provider reference for the completed refund')
  const client = createServiceRoleClient()
  const { data, error } = await client.rpc('platform_record_subscription_refund', {
    p_refund_id: refundId, p_provider_reference: providerReference, p_platform_user_id: user.id,
  })
  if (error) throw new Error(error.message)
  if (data !== true) throw new Error('This refund is not approved or has already been completed')
  revalidatePath('/platform/payments')
}

export async function applyPlatformLicenseAdjustment(
  _previousState: PlatformLicenseAdjustmentState,
  formData: FormData,
): Promise<PlatformLicenseAdjustmentState> {
  void _previousState
  try {
    const user = await requireDeveloper()
    const businessId = getString(formData, 'businessId')
    const action = getString(formData, 'action')
    const reason = getString(formData, 'reason')
    const rawDays = getString(formData, 'days')
    const days = rawDays ? Number(rawDays) : null
    const planKey = getString(formData, 'planKey') || null
    const billingInterval = getString(formData, 'billingInterval') || null
    const allowedActions = ['suspend', 'reactivate', 'extend_period', 'complimentary', 'assign_lifetime', 'change_plan']

    if (!/^[0-9a-f-]{36}$/i.test(businessId)) {
      return { success: false, error: 'Select a valid business.', message: null }
    }
    if (!allowedActions.includes(action)) {
      return { success: false, error: 'Select a valid license action.', message: null }
    }
    if (reason.length < 10 || reason.length > 1000) {
      return { success: false, error: 'Enter a reason between 10 and 1,000 characters.', message: null }
    }
    if (['extend_period', 'complimentary'].includes(action) &&
        (!Number.isInteger(days) || days === null || days < 1 || days > 365)) {
      return { success: false, error: 'Enter a duration between 1 and 365 days.', message: null }
    }
    if (['assign_lifetime', 'change_plan'].includes(action) && !planKey) {
      return { success: false, error: 'Choose an active paid package.', message: null }
    }
    if (action === 'change_plan' && !['monthly', 'yearly'].includes(billingInterval ?? '')) {
      return { success: false, error: 'Choose a monthly or yearly billing interval.', message: null }
    }

    const serviceClient = createServiceRoleClient()
    if (action === 'suspend' || action === 'reactivate') {
      const { data: subscription, error: subscriptionError } = await serviceClient
        .from('subscriptions')
        .select('license_suspended_at')
        .eq('business_id', businessId)
        .maybeSingle()
      if (subscriptionError || !subscription) {
        return { success: false, error: 'Could not load the current business license state.', message: null }
      }
      if (action === 'reactivate' && !subscription.license_suspended_at) {
        return { success: false, error: 'This license is not suspended, so there is nothing to reactivate.', message: null }
      }
      if (action === 'suspend' && subscription.license_suspended_at) {
        return { success: false, error: 'This license is already suspended.', message: null }
      }
    }

    const { data, error } = await serviceClient.rpc('platform_apply_license_adjustment', {
      p_business_id: businessId,
      p_platform_user_id: user.id,
      p_action: action,
      p_reason: reason,
      p_days: days,
      p_plan_key: planKey,
      p_billing_interval: billingInterval,
    })
    if (error || data !== true) {
      return { success: false, error: error?.message ?? 'Unable to apply the license adjustment.', message: null }
    }

    const { error: auditError } = await serviceClient.from('platform_audit_logs').insert({
      platform_user_id: user.id,
      entity_type: 'platform_license_adjustment',
      entity_id: businessId,
      action,
      new_value: { business_id: businessId, reason, days, plan_key: planKey, billing_interval: billingInterval },
    })
    revalidatePath('/platform/businesses')
    revalidatePath('/platform')

    return {
      success: true,
      error: null,
      message: auditError
        ? 'License updated and saved to license history. The secondary platform audit entry could not be recorded.'
        : 'License updated successfully.',
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unable to apply the license adjustment.',
      message: null,
    }
  }
}

export async function createSubscriptionPromotion(formData: FormData): Promise<void> {
  const user = await requireDeveloper()
  const code = getString(formData, 'code').toUpperCase().replace(/\s+/g, '')
  const description = getString(formData, 'description')
  const discountType = getString(formData, 'discountType')
  const discountValue = getNumber(formData, 'discountValue')
  const usageLimit = getString(formData, 'usageLimit') ? Number(getString(formData, 'usageLimit')) : null
  const expiry = getString(formData, 'expiresAt')
  const businessId = getString(formData, 'businessId') || null
  const eligiblePlanKeys = getString(formData, 'planKeys').split(',').map((value) => value.trim()).filter(Boolean)
  const eligibleIntervals = getString(formData, 'intervals').split(',').map((value) => value.trim()).filter(Boolean)
  const setupFeeDiscount = getNumber(formData, 'setupFeeDiscount')
  if (!/^[A-Z0-9][A-Z0-9_-]{2,39}$/.test(code) || !['percentage', 'fixed'].includes(discountType)
      || discountValue <= 0 || (discountType === 'percentage' && discountValue > 100)
      || (usageLimit !== null && (!Number.isInteger(usageLimit) || usageLimit < 1))
      || setupFeeDiscount < 0 || (businessId && !/^[0-9a-f-]{36}$/i.test(businessId))) {
    throw new Error('Enter a valid promotion code, discount, usage limit, and optional business')
  }
  if (eligibleIntervals.some((interval) => !['monthly','yearly','lifetime'].includes(interval))) throw new Error('Invalid eligible billing interval')
  const serviceClient = createServiceRoleClient()
  const { data, error } = await serviceClient.from('subscription_promotions').insert({
    code, description, discount_type: discountType, discount_value: discountValue,
    usage_limit: usageLimit, eligible_plan_keys: eligiblePlanKeys, eligible_intervals: eligibleIntervals,
    business_id: businessId, setup_fee_discount: setupFeeDiscount,
    expires_at: expiry ? new Date(expiry).toISOString() : null, created_by: user.id,
  }).select('id').single()
  if (error || !data) throw new Error(error?.message ?? 'Unable to create promotion')
  await serviceClient.from('platform_audit_logs').insert({ platform_user_id: user.id, entity_type: 'subscription_promotion', entity_id: data.id, action: 'created', new_value: { code, discount_type: discountType, discount_value: discountValue, usage_limit: usageLimit, business_id: businessId } })
  revalidatePath('/platform/promotions')
}

export async function setSubscriptionPromotionActive(formData: FormData): Promise<void> {
  const user = await requireDeveloper()
  const id = getString(formData, 'promotionId')
  const isActive = getString(formData, 'isActive') === 'true'
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('Invalid promotion')
  const serviceClient = createServiceRoleClient()
  const { error } = await serviceClient.from('subscription_promotions').update({ is_active: isActive, updated_at: new Date().toISOString() }).eq('id', id)
  if (error) throw new Error(error.message)
  await serviceClient.from('platform_audit_logs').insert({ platform_user_id: user.id, entity_type: 'subscription_promotion', entity_id: id, action: isActive ? 'activated' : 'disabled', new_value: { is_active: isActive } })
  revalidatePath('/platform/promotions')
}

export async function updatePlatformOperationalSettings(formData: FormData): Promise<void> {
  const user = await requireDeveloper()
  const setupFee = getNumber(formData, 'setupFee')
  const currency = getString(formData, 'currency').toUpperCase() || 'KES'
  const retentionMonths = Number(getString(formData, 'retentionMonths'))
  if (setupFee < 0 || !/^[A-Z]{3}$/.test(currency) || !Number.isInteger(retentionMonths) || retentionMonths < 1 || retentionMonths > 120) {
    throw new Error('Enter a valid setup price, currency, and retention period')
  }
  const serviceClient = createServiceRoleClient()
  const [feeResult, retentionResult] = await Promise.all([
    serviceClient.from('platform_integration_setup_config').upsert({ id: true, default_setup_fee: setupFee, currency, updated_by: user.id, updated_at: new Date().toISOString() }),
    serviceClient.from('platform_retention_settings').upsert({ id: true, retention_months: retentionMonths, updated_by: user.id, updated_at: new Date().toISOString() }),
  ])
  if (feeResult.error || retentionResult.error) throw new Error(feeResult.error?.message ?? retentionResult.error?.message ?? 'Unable to save operational settings')
  await serviceClient.from('platform_audit_logs').insert({ platform_user_id: user.id, entity_type: 'platform_operational_settings', action: 'updated', new_value: { default_setup_fee: setupFee, currency, retention_months: retentionMonths } })
  revalidatePath('/platform/promotions')
}

export async function reviewIntegrationSetupRequest(formData: FormData): Promise<void> {
  const user = await requireDeveloper()
  const requestId = getString(formData, 'requestId')
  const status = getString(formData, 'status')
  const notes = getString(formData, 'adminNotes').slice(0, 2000)
  const fee = getNumber(formData, 'quotedFee')
  const paymentStatus = getString(formData, 'setupPaymentStatus')
  const paymentReference = getString(formData, 'setupPaymentReference').slice(0, 120)
  const effectivePaymentStatus = fee === 0 && paymentStatus === 'unpaid' ? 'waived' : paymentStatus
  if (!/^[0-9a-f-]{36}$/i.test(requestId) || !['quoted','awaiting_payment','in_progress','completed','cancelled'].includes(status) || fee < 0
      || !['unpaid','pending','paid','waived','refunded'].includes(effectivePaymentStatus)
      || (effectivePaymentStatus === 'paid' && paymentReference.length < 3)) {
    throw new Error('Invalid integration setup update')
  }
  const serviceClient = createServiceRoleClient()
  const { data: current, error: currentError } = await serviceClient.from('integration_setup_requests')
    .select('id,business_id,status,quoted_fee,currency,setup_payment_status,setup_payment_reference,admin_notes')
    .eq('id', requestId).maybeSingle()
  if (currentError || !current) throw new Error('Integration setup request could not be loaded.')
  if (status === 'completed' && fee > 0 && !['paid','waived'].includes(effectivePaymentStatus)) {
    throw new Error('Record setup payment or waive the fee before completing this request.')
  }
  const { error } = await serviceClient.from('integration_setup_requests').update({
    status, admin_notes: notes, quoted_fee: fee, setup_payment_status: effectivePaymentStatus,
    setup_payment_reference: paymentReference || null, assigned_to: user.id,
    completed_at: status === 'completed' ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  }).eq('id', requestId)
  if (error) throw new Error(error.message)
  const { error: auditError } = await serviceClient.from('platform_audit_logs').insert({
    platform_user_id: user.id, entity_type: 'integration_setup_request', entity_id: requestId,
    action: 'updated', old_value: current,
    new_value: { status, quoted_fee: fee, setup_payment_status: effectivePaymentStatus, setup_payment_reference: paymentReference || null, admin_notes: notes },
  })
  if (auditError) throw new Error('Request updated, but its audit entry could not be recorded.')
  revalidatePath('/platform/integrations')
  revalidatePath('/dashboard/owner/settings/payments')
}

export async function setBusinessIntegrationSetupFeeOverride(formData: FormData): Promise<void> {
  const user = await requireDeveloper()
  const businessId = getString(formData, 'businessId')
  const mode = getString(formData, 'overrideMode')
  const fee = getNumber(formData, 'overrideFee')
  const currency = getString(formData, 'overrideCurrency').toUpperCase()
  const reason = getString(formData, 'overrideReason').slice(0, 500)
  if (!/^[0-9a-f-]{36}$/i.test(businessId) || !['standard','custom'].includes(mode)) throw new Error('Invalid business fee override.')

  const serviceClient = createServiceRoleClient()
  const { data: business, error: businessError } = await serviceClient.from('businesses').select('id').eq('id', businessId).maybeSingle()
  if (businessError || !business) throw new Error('Business account could not be found.')
  const { data: previous, error: previousError } = await serviceClient.from('platform_business_setup_fee_overrides')
    .select('business_id,fee,currency,reason').eq('business_id', businessId).maybeSingle()
  if (previousError) throw new Error('Existing business fee rule could not be loaded.')

  let nextValue: { business_id: string; fee: number; currency: string; reason: string; updated_by: string; updated_at: string } | null = null
  if (mode === 'custom') {
    if (fee < 0 || !/^[A-Z]{3}$/.test(currency) || reason.trim().length < 3) throw new Error('Enter a valid fee, three-letter currency, and reason for the custom price.')
    nextValue = { business_id: businessId, fee, currency, reason, updated_by: user.id, updated_at: new Date().toISOString() }
    const { error } = await serviceClient.from('platform_business_setup_fee_overrides').upsert(nextValue, { onConflict: 'business_id' })
    if (error) throw new Error(error.message)
  } else {
    const { error } = await serviceClient.from('platform_business_setup_fee_overrides').delete().eq('business_id', businessId)
    if (error) throw new Error(error.message)
  }

  const { error: auditError } = await serviceClient.from('platform_audit_logs').insert({
    platform_user_id: user.id, entity_type: 'business_setup_fee_override', entity_id: businessId, action: mode === 'custom' ? 'set' : 'removed',
    old_value: previous ?? null, new_value: nextValue,
  })
  if (auditError) throw new Error('Fee rule changed, but its audit entry could not be recorded.')
  revalidatePath('/platform/integrations')
}

export async function updatePlatformPaymentSettings(formData: FormData): Promise<void> {
  const user = await requireDeveloper()
  const environment = getString(formData, 'environment') || 'sandbox'
  const businessShortcode = getString(formData, 'businessShortcode')
  const tillNumber = getString(formData, 'tillNumber')
  const accountReference = getString(formData, 'accountReference') || 'RETIVOX'
  const transactionType = getString(formData, 'transactionType') || 'CustomerPayBillOnline'
  const callbackUrl = getString(formData, 'callbackUrl')
  const consumerKey = getString(formData, 'consumerKey')
  const consumerSecret = getString(formData, 'consumerSecret')
  const passkey = getString(formData, 'passkey')

  if (!businessShortcode || !callbackUrl || (transactionType === 'CustomerBuyGoodsOnline' && !tillNumber)) {
    throw new Error('Store/API shortcode, Buy Goods Till (for Buy Goods), and callback URL are required')
  }

  const serviceClient = createServiceRoleClient()
  const { data: settingId, error } = await serviceClient.rpc('platform_save_daraja_settings_v2', {
    p_environment: environment,
    p_business_shortcode: businessShortcode,
    p_till_number: tillNumber || null,
    p_account_reference: accountReference,
    p_transaction_type: transactionType,
    p_callback_url: callbackUrl,
    p_consumer_key: consumerKey,
    p_consumer_secret: consumerSecret,
    p_passkey: passkey,
    p_updated_by: user.id,
  })

  if (error || !settingId) {
    logger.error('updatePlatformPaymentSettings: secure credential save failed', {
      actorId: user.id,
      error,
    })
    throw new Error('Unable to securely save the payment settings. Check all first-time credentials and try again.')
  }

  await serviceClient.from('platform_audit_logs').insert({
    platform_user_id: user.id,
    entity_type: 'platform_payment_settings',
    action: 'updated',
    new_value: { setting_id: settingId, provider: 'daraja', environment, business_shortcode: businessShortcode, till_number: tillNumber || null, account_reference: accountReference },
  })

  revalidatePath('/platform/payments')
}

export async function savePlatformPesapalSettings(formData: FormData): Promise<void> {
  const user = await requireDeveloper()
  const environment = getString(formData, 'pesapalEnvironment') || 'sandbox'
  const callbackUrl = getString(formData, 'pesapalCallbackUrl')
  const consumerKey = getString(formData, 'pesapalConsumerKey')
  const consumerSecret = getString(formData, 'pesapalConsumerSecret')
  let callback: URL
  try { callback = new URL(callbackUrl) } catch { throw new Error('Enter a valid HTTPS callback URL') }
  if (callback.protocol !== 'https:' || !callback.hostname) throw new Error('Pesapal callback URL must use HTTPS')
  const serviceClient = createServiceRoleClient()
  const { error } = await serviceClient.rpc('platform_save_pesapal_settings', {
    p_environment: environment, p_callback_url: callback.toString(), p_consumer_key: consumerKey,
    p_consumer_secret: consumerSecret, p_updated_by: user.id,
  })
  if (error) throw new Error(error.message)
  await serviceClient.from('platform_audit_logs').insert({
    platform_user_id: user.id, entity_type: 'platform_pesapal_settings', action: 'updated',
    new_value: { environment, callback_url: callback.toString() },
  })
  revalidatePath('/platform/payments')
}

export async function registerPlatformPesapalCallback(): Promise<void> {
  const user = await requireDeveloper()
  const ipnId = await registerPlatformPesapalIpn(user.id)
  const serviceClient = createServiceRoleClient()
  await serviceClient.from('platform_audit_logs').insert({
    platform_user_id: user.id, entity_type: 'platform_pesapal_settings', action: 'ipn_registered',
    new_value: { ipn_id: ipnId },
  })
  revalidatePath('/platform/payments')
}

export async function warnDormantBusiness(formData: FormData): Promise<void> {
  const user = await requireDeveloper()
  const businessId = getString(formData, 'businessId')

  if (!businessId) {
    throw new Error('Business id is required')
  }

  const serviceClient = createServiceRoleClient()
  const { data: business, error: businessError } = await serviceClient
    .from('businesses')
    .select('id, name')
    .eq('id', businessId)
    .maybeSingle()

  if (businessError || !business) {
    throw new Error(businessError?.message ?? 'Business not found')
  }

  const { data: owner } = await serviceClient
    .from('users')
    .select('email, name')
    .eq('business_id', businessId)
    .eq('global_role', 'owner')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!owner?.email) {
    throw new Error('No owner email found for this business')
  }

  const subject = 'Retivox account inactivity warning'
  const body = [
    `Hello ${owner.name ?? 'there'},`,
    '',
    `Your Retivox workspace "${business.name}" has been inactive for more than 3 months.`,
    'Please log in or contact support to keep the account active.',
    'Accounts inactive for 6 months may be permanently deleted with their related information.',
  ].join('\n')
  const emailStatus = await sendEmailOrQueue({ businessId, recipientEmail: owner.email, subject, body })
  const now = new Date().toISOString()

  await serviceClient
    .from('businesses')
    .update({
      platform_status: 'dormant_warned',
      dormancy_warning_sent_at: now,
      dormant_delete_after: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
      platform_status_note: `Dormancy warning email ${emailStatus}.`,
    })
    .eq('id', businessId)

  await serviceClient.from('platform_business_lifecycle_events').insert({
    business_id: businessId,
    platform_user_id: user.id,
    event_type: emailStatus === 'sent' ? 'dormancy_warning_sent' : 'dormancy_warning_queued',
    owner_email: owner.email,
    note: `Dormancy warning email ${emailStatus}.`,
  })

  revalidatePath('/platform/dormant')
  revalidatePath('/platform/businesses')
}

export async function deactivateBusiness(formData: FormData): Promise<void> {
  const user = await requireDeveloper()
  const businessId = getString(formData, 'businessId')
  const note = getString(formData, 'note') || 'Deactivated from platform dormancy console.'

  if (!businessId) {
    throw new Error('Business id is required')
  }

  const serviceClient = createServiceRoleClient()
  const now = new Date().toISOString()
  const { error } = await serviceClient
    .from('businesses')
    .update({
      is_active: false,
      platform_status: 'deactivated',
      deactivated_at: now,
      subscription_status: 'cancelled',
      platform_status_note: note,
    })
    .eq('id', businessId)

  if (error) {
    throw new Error(error.message)
  }

  await serviceClient.from('subscriptions').update({ status: 'cancelled', cancelled_at: now }).eq('business_id', businessId)
  await serviceClient.from('platform_business_lifecycle_events').insert({
    business_id: businessId,
    platform_user_id: user.id,
    event_type: 'deactivated',
    note,
  })

  revalidatePath('/platform/dormant')
  revalidatePath('/platform/businesses')
}

export async function deleteDormantBusiness(formData: FormData): Promise<void> {
  const user = await requireDeveloper()
  const businessId = getString(formData, 'businessId')
  const confirmation = getString(formData, 'confirmation')

  if (!businessId || confirmation !== 'DELETE') {
    throw new Error('Type DELETE to permanently delete this dormant business')
  }

  const serviceClient = createServiceRoleClient()
  const { data: business, error: businessError } = await serviceClient
    .from('businesses')
    .select('id, name, created_at, dormancy_warning_sent_at')
    .eq('id', businessId)
    .maybeSingle()

  if (businessError || !business) {
    throw new Error(businessError?.message ?? 'Business not found')
  }

  if (!business.dormancy_warning_sent_at) {
    throw new Error('Send the owner a dormancy warning before deleting the account')
  }

  const inactiveDays = await getBusinessInactiveDays(businessId, business.created_at)

  if (inactiveDays < 180) {
    throw new Error('This business has not been inactive for 6 months yet')
  }

  const { data: users } = await serviceClient
    .from('users')
    .select('id, email')
    .eq('business_id', businessId)

  for (const tenantUser of users ?? []) {
    try {
      await serviceClient.auth.admin.deleteUser(tenantUser.id)
    } catch (error: unknown) {
      logger.warn('deleteDormantBusiness: auth user cleanup failed', { businessId, userId: tenantUser.id, error })
    }
  }

  await serviceClient.from('platform_business_lifecycle_events').insert({
    business_id: businessId,
    platform_user_id: user.id,
    event_type: 'deleted',
    note: `Business "${business.name}" permanently deleted after dormancy warning.`,
    metadata: { user_count: users?.length ?? 0 },
  })

  const { error } = await serviceClient.from('businesses').delete().eq('id', businessId)

  if (error) {
    throw new Error(error.message)
  }

  await serviceClient.from('platform_audit_logs').insert({
    platform_user_id: user.id,
    entity_type: 'business',
    entity_id: businessId,
    action: 'deleted_dormant_business',
    old_value: { name: business.name, user_count: users?.length ?? 0 },
    new_value: null,
  })

  revalidatePath('/platform/dormant')
  revalidatePath('/platform/businesses')
  revalidatePath('/platform')
}
