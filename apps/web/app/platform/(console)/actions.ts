'use server'

import { revalidatePath } from 'next/cache'
import { createServiceRoleClient } from '../../../lib/supabase/admin'
import { requirePlatformUser } from '../../../lib/platform/auth'
import logger from '../../../lib/logger'

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
  const resendApiKey = process.env.RESEND_API_KEY
  const fromEmail = process.env.PLATFORM_FROM_EMAIL

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
    provider: resendApiKey ? 'resend' : null,
  })

  return 'queued'
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
  const branchLimitValue = getString(formData, 'branchLimit')
  const parsedBranchLimit = branchLimitValue ? Number(branchLimitValue) : null
  const branchLimit = parsedBranchLimit !== null && Number.isInteger(parsedBranchLimit) && parsedBranchLimit > 0
    ? parsedBranchLimit
    : null
  const isActive = planKey === 'trial' || getString(formData, 'isActive') === 'on'
  const name = planKey === 'trial' ? 'Free' : submittedName

  if (
    !['trial', 'starter', 'growth', 'enterprise'].includes(planKey) ||
    !name ||
    (planKey === 'trial' && name !== 'Free') ||
    monthlyAmount < 0 ||
    annualDiscountPercent < 0 ||
    annualDiscountPercent > 100 ||
    (planKey === 'trial' && (monthlyAmount !== 0 || annualDiscountPercent !== 0 || !isActive)) ||
    !/^[A-Z]{3}$/.test(currency) ||
    (branchLimitValue && branchLimit === null)
  ) {
    throw new Error('Enter a valid package name and monthly amount')
  }

  const serviceClient = createServiceRoleClient()
  const { error } = await serviceClient
    .from('platform_subscription_plans')
    .update({
      name,
      description,
      monthly_amount: monthlyAmount,
      currency,
      annual_discount_percent: annualDiscountPercent,
      branch_limit: branchLimit,
      is_active: isActive,
    })
    .eq('plan_key', planKey)

  if (error) {
    throw new Error(error.message)
  }

  await serviceClient.from('platform_audit_logs').insert({
    platform_user_id: user.id,
    entity_type: 'platform_subscription_plan',
    action: 'updated',
    new_value: {
      plan_key: planKey,
      monthly_amount: monthlyAmount,
      annual_discount_percent: annualDiscountPercent,
      currency,
      branch_limit: branchLimit,
      is_active: isActive,
    },
  })

  revalidatePath('/platform/pricing')
  revalidatePath('/platform')
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

export async function updatePlatformPaymentSettings(formData: FormData): Promise<void> {
  const user = await requireDeveloper()
  const environment = getString(formData, 'environment') || 'sandbox'
  const businessShortcode = getString(formData, 'businessShortcode')
  const accountReference = getString(formData, 'accountReference') || 'RETIVOX'
  const transactionType = getString(formData, 'transactionType') || 'CustomerPayBillOnline'
  const callbackUrl = getString(formData, 'callbackUrl')
  const consumerKey = getString(formData, 'consumerKey')
  const consumerSecret = getString(formData, 'consumerSecret')
  const passkey = getString(formData, 'passkey')

  if (!businessShortcode || !callbackUrl) {
    throw new Error('M-Pesa shortcode and callback URL are required')
  }

  const serviceClient = createServiceRoleClient()
  const { data: currentSettings } = await serviceClient
    .from('platform_payment_settings')
    .select('consumer_key, consumer_secret, passkey')
    .eq('provider', 'daraja')
    .eq('is_active', true)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  await serviceClient
    .from('platform_payment_settings')
    .update({ is_active: false })
    .eq('provider', 'daraja')
    .eq('is_active', true)

  const { error } = await serviceClient.from('platform_payment_settings').insert({
    provider: 'daraja',
    environment,
    business_shortcode: businessShortcode,
    account_reference: accountReference,
    transaction_type: transactionType,
    callback_url: callbackUrl,
    consumer_key: consumerKey || currentSettings?.consumer_key || null,
    consumer_secret: consumerSecret || currentSettings?.consumer_secret || null,
    passkey: passkey || currentSettings?.passkey || null,
    is_active: true,
    updated_by: user.id,
  })

  if (error) {
    throw new Error(error.message)
  }

  await serviceClient.from('platform_audit_logs').insert({
    platform_user_id: user.id,
    entity_type: 'platform_payment_settings',
    action: 'updated',
    new_value: { provider: 'daraja', environment, business_shortcode: businessShortcode, account_reference: accountReference },
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
