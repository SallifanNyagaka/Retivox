import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import {
  getDarajaPromptConfiguration,
  initiateDarajaStkPush,
  normalizeKenyanPhoneNumber,
  type DarajaStkPushResponse,
} from '../../../../lib/payments/daraja'
import { createServiceRoleClient } from '../../../../lib/supabase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const stkSchema = z.object({
  action: z.literal('stk'),
  phone: z.string().trim().min(9).max(20),
  planKey: z.enum(['starter', 'growth', 'enterprise']),
  billingInterval: z.enum(['monthly', 'yearly']),
})

type OwnerProfile = {
  id: string
  business_id: string | null
  global_role: string | null
  is_active: boolean | null
  deleted_at: string | null
}

export async function GET(request: Request) {
  const authorized = await authorizeOwner(request)
  if ('response' in authorized) return authorized.response

  const { supabase, profile } = authorized
  const businessId = profile.business_id
  if (!businessId) return json({ error: 'Business context is missing.' }, 403)

  const [businessResult, subscriptionResult, plansResult, requestsResult] = await Promise.all([
    supabase.from('businesses')
      .select('subscription_plan, subscription_status')
      .eq('id', businessId)
      .maybeSingle(),
    supabase.from('subscriptions')
      .select('id, plan, status, branch_count, monthly_amount, currency, current_period_end, billing_interval, next_plan_key, next_billing_interval, next_period_start')
      .eq('business_id', businessId)
      .maybeSingle(),
    supabase.from('platform_subscription_plans')
      .select('id, plan_key, name, description, monthly_amount, annual_discount_percent, currency, branch_limit, sort_order')
      .eq('is_active', true)
      .order('sort_order', { ascending: true }),
    supabase.from('subscription_payment_requests')
      .select('id, amount, currency, plan_key, billing_interval, payment_method, reference_code, payer_phone, status, review_note, submitted_at, reviewed_at, provider_checkout_request_id, provider_receipt_number, provider_paid_amount, provider_phone_number, provider_result_description')
      .eq('business_id', businessId)
      .order('submitted_at', { ascending: false })
      .limit(10),
  ])
  const error = businessResult.error ?? subscriptionResult.error ?? plansResult.error ?? requestsResult.error
  if (error) return json({ error: 'Unable to load subscription details.' }, 500)

  return json({
    success: true,
    data: {
      business: businessResult.data,
      subscription: subscriptionResult.data,
      plans: plansResult.data ?? [],
      paymentRequests: requestsResult.data ?? [],
    },
  })
}

export async function POST(request: Request) {
  const authorized = await authorizeOwner(request)
  if ('response' in authorized) return authorized.response

  const { supabase, profile } = authorized
  if (!profile.business_id) return json({ error: 'Business context is missing.' }, 403)

  const body = await readBody(request)
  const parsed = stkSchema.safeParse(body)
  if (!parsed.success) {
    return json({ error: parsed.error.issues[0]?.message ?? 'Invalid payment details.' }, 400)
  }

  let phone: string
  try {
    phone = normalizeKenyanPhoneNumber(parsed.data.phone)
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Invalid phone number.' }, 400)
  }

  const businessId = profile.business_id
  const [subscriptionResult, planResult] = await Promise.all([
    supabase.from('subscriptions').select('id').eq('business_id', businessId).maybeSingle(),
    supabase.from('platform_subscription_plans')
      .select('plan_key, monthly_amount, annual_discount_percent, currency')
      .eq('plan_key', parsed.data.planKey)
      .eq('is_active', true)
      .maybeSingle(),
  ])
  if (subscriptionResult.error || planResult.error || !planResult.data) {
    return json({ error: 'The selected subscription plan is unavailable.' }, 400)
  }

  let subscription = subscriptionResult.data
  if (!subscription) {
    const now = new Date()
    const { data, error } = await supabase.from('subscriptions').insert({
      business_id: businessId,
      plan: 'trial',
      status: 'active',
      branch_count: 1,
      monthly_amount: 0,
      currency: planResult.data.currency,
      current_period_start: now.toISOString(),
      current_period_end: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    }).select('id').single()
    if (error?.code === '23505') {
      const { data: existing, error: lookupError } = await supabase.from('subscriptions')
        .select('id').eq('business_id', businessId).maybeSingle()
      if (lookupError || !existing) {
        return json({ error: 'Unable to prepare the subscription payment.' }, 500)
      }
      subscription = existing
    } else {
      if (error || !data) return json({ error: 'Unable to prepare the subscription payment.' }, 500)
      subscription = data
    }
  }

  const plan = planResult.data
  const monthlyAmount = Number(plan.monthly_amount)
  const amount = parsed.data.billingInterval === 'yearly'
    ? Math.round(monthlyAmount * 12 * (1 - Number(plan.annual_discount_percent) / 100) * 100) / 100
    : monthlyAmount
  if (!Number.isInteger(amount) || amount <= 0) {
    return json({ error: 'M-Pesa STK Push requires a whole-number amount. Use a manual payment for this plan.' }, 400)
  }

  let prompt: Awaited<ReturnType<typeof getDarajaPromptConfiguration>>
  try {
    prompt = await getDarajaPromptConfiguration()
  } catch (error) {
    return json({
      error: error instanceof Error ? error.message : 'M-Pesa STK Push is not configured.',
    }, 503)
  }
  const referenceCode = `STK-${randomUUID()}`
  const { data: payment, error: paymentError } = await supabase
    .from('subscription_payment_requests')
    .insert({
      business_id: businessId,
      subscription_id: subscription.id,
      submitted_by: profile.id,
      amount,
      currency: String(plan.currency ?? 'KES'),
      payment_method: 'mpesa_stk',
      plan_key: parsed.data.planKey,
      billing_interval: parsed.data.billingInterval,
      reference_code: referenceCode,
      payer_phone: phone,
      status: 'pending',
      provider: 'daraja',
      plan_monthly_amount: monthlyAmount,
      provider_result_description: `STK Push queued for ${parsed.data.planKey} ${parsed.data.billingInterval} plan; PayBill ${prompt.shortcode}, account ${prompt.accountReference}`,
    })
    .select('id')
    .single()
  if (paymentError || !payment) {
    return json({ error: 'Unable to create the payment request.' }, 500)
  }

  let providerResponse: DarajaStkPushResponse
  try {
    providerResponse = await initiateDarajaStkPush({
      phone,
      amount,
      accountReference: prompt.accountReference,
      transactionDescription: 'Retivox subscription',
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'STK Push failed.'
    const { error: updateError } = await supabase.from('subscription_payment_requests')
      .update({
        status: 'rejected',
        provider_result_description: message,
        review_note: message,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', payment.id)
    if (updateError) {
      return json({ error: 'The payment request failed and its status could not be updated. Contact support before retrying.' }, 500)
    }
    return json({ error: message }, 400)
  }

  if (!providerResponse.CheckoutRequestID) {
    const message = providerResponse.ResponseDescription ?? 'Daraja did not return a checkout request id.'
    const { error } = await supabase.from('subscription_payment_requests')
      .update({
        status: 'rejected',
        provider_result_description: message,
        review_note: message,
        reviewed_at: new Date().toISOString(),
        raw_provider_payload: providerResponse,
      })
      .eq('id', payment.id)
    if (error) {
      return json({ error: 'The payment prompt was not confirmed and its status could not be saved. Contact support before retrying.' }, 500)
    }
    return json({ error: message }, 400)
  }

  const { error: statusError } = await supabase.from('subscription_payment_requests')
    .update({
      provider_merchant_request_id: providerResponse.MerchantRequestID ?? null,
      provider_checkout_request_id: providerResponse.CheckoutRequestID,
      provider_result_description: providerResponse.CustomerMessage ??
        providerResponse.ResponseDescription ?? `STK Push sent to ${phone}`,
      raw_provider_payload: providerResponse,
    })
    .eq('id', payment.id)
  if (statusError) {
    return json({
      error: 'The M-Pesa prompt may have been sent, but its status could not be saved. Contact support before retrying.',
    }, 500)
  }
  return json({
    success: true,
    message: 'M-Pesa prompt sent. Complete it on your phone.',
  })
}

async function authorizeOwner(request: Request) {
  const authorization = request.headers.get('authorization') ?? ''
  const token = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length).trim()
    : ''
  if (!token || token.length > 8192) {
    return { response: json({ error: 'Sign in again before managing your subscription.' }, 401) }
  }

  let supabase: ReturnType<typeof createServiceRoleClient>
  try {
    supabase = createServiceRoleClient()
  } catch {
    return { response: json({ error: 'Subscription services are not configured.' }, 503) }
  }
  const { data: authData, error: authError } = await supabase.auth.getUser(token)
  if (authError || !authData.user) {
    return { response: json({ error: 'Your online session is invalid or expired.' }, 401) }
  }
  const { data, error } = await supabase.from('users')
    .select('id, business_id, global_role, is_active, deleted_at')
    .eq('id', authData.user.id)
    .maybeSingle()
  const profile = data as OwnerProfile | null
  if (
    error ||
    !profile ||
    profile.global_role !== 'owner' ||
    profile.is_active !== true ||
    profile.deleted_at !== null
  ) {
    return { response: json({ error: 'Only an active business owner can manage subscriptions.' }, 403) }
  }
  return { supabase, profile }
}

async function readBody(request: Request): Promise<unknown | null> {
  const contentLength = Number(request.headers.get('content-length') ?? 0)
  if (contentLength > 16_384) return null
  const reader = request.body?.getReader()
  if (!reader) return null
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > 16_384) {
        await reader.cancel()
        return null
      }
      chunks.push(value)
    }
    const bytes = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    return null
  } finally {
    reader.releaseLock()
  }
}

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  })
}
