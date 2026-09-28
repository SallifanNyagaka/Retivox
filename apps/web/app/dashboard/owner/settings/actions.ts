'use server'
/**
 * Server actions for the owner settings dashboard.
 *
 * These actions update the business profile, change the owner password, and
 * sign the owner out from the settings danger zone.
 */

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { createBusinessSchema, GlobalRole } from '@smartretail/shared'
import { requireRole } from '../../../../lib/auth/helpers'
import { createClient } from '../../../../lib/supabase/server'
import { createServiceRoleClient } from '../../../../lib/supabase/admin'
import logger from '../../../../lib/logger'
import { getDarajaPromptConfiguration, initiateDarajaStkPush, normalizeKenyanPhone } from '../../../../lib/payments/daraja'
import type { BusinessSettingsRow, FormState, UserProfileRow } from './types'

/**
 * Validates password change fields with strength and match checks.
 */
const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: z
      .string()
      .min(8, 'New password must be at least 8 characters')
      .regex(
        /(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/,
        'New password must include uppercase, lowercase, and a number'
      ),
    confirmPassword: z.string().min(1, 'Confirm your new password'),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'New password and confirmation must match',
    path: ['confirmPassword'],
  })

const loginReviewSchema = z.object({
  quote: z.string().min(10, 'Review must be at least 10 characters').max(600, 'Review is too long'),
  reviewerTitle: z.string().min(2, 'Review title is required').max(160, 'Review title is too long'),
})

const subscriptionPaymentSchema = z.object({
  paymentMethod: z.enum(['mpesa_manual', 'bank_transfer', 'cash_deposit', 'other']),
  referenceCode: z.string().min(3, 'Payment reference must be at least 3 characters').max(80, 'Payment reference is too long'),
  payerPhone: z.string().max(32, 'Phone number is too long').optional(),
})

const darajaPaymentSchema = z.object({
  phone: z.string().min(9, 'Enter the M-Pesa phone number').max(20, 'Phone number is too long'),
  amount: z.coerce.number().int('Payment amount must be a whole number').positive('Payment amount must be greater than zero'),
})

/**
 * Safely reads a trimmed string value from FormData.
 */
function getString(formData: FormData, key: string): string {
  const value = formData.get(key)
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Updates business profile fields from the settings page.
 */
export async function updateBusinessProfile(_prevState: FormState, formData: FormData): Promise<FormState> {
  const name = getString(formData, 'name')
  const country = getString(formData, 'country').toUpperCase()
  const currency = getString(formData, 'currency').toUpperCase()
  const timezone = getString(formData, 'timezone')

  const validation = createBusinessSchema.safeParse({
    name,
    country,
    currency,
    timezone,
  })

  if (!validation.success) {
    return { success: false, error: validation.error.errors[0]?.message ?? 'Invalid business profile' }
  }

  const profile = await requireRole([GlobalRole.Owner])
  const businessId = profile.business_id

  if (!businessId) {
    logger.error('updateBusinessProfile: missing business id', { userId: profile.id })
    return { success: false, error: 'Business context missing' }
  }

  try {
    const supabase = await createClient()

    const { data: currentBusinessData, error: currentBusinessError } = await supabase
      .from('businesses')
      .select('id, name, country, currency, timezone, subscription_plan, subscription_status')
      .eq('id', businessId)
      .maybeSingle()

    if (currentBusinessError) {
      logger.error('updateBusinessProfile: business lookup failed', { businessId, error: currentBusinessError })
      return { success: false, error: currentBusinessError.message ?? 'Unable to load business profile' }
    }

    const currentBusiness = currentBusinessData as BusinessSettingsRow | null
    if (!currentBusiness) {
      return { success: false, error: 'Business profile not found' }
    }

    const { error: updateError } = await supabase
      .from('businesses')
      .update({
        name: validation.data.name,
        country: validation.data.country,
        currency: validation.data.currency,
        timezone: validation.data.timezone,
      })
      .eq('id', businessId)

    if (updateError) {
      logger.error('updateBusinessProfile: update failed', { businessId, error: updateError })
      return { success: false, error: updateError.message ?? 'Unable to update business profile' }
    }

    const { error: auditError } = await supabase.from('audit_logs').insert({
      business_id: businessId,
      actor_id: profile.id,
      entity_type: 'business',
      entity_id: businessId,
      action: 'updated',
      old_value: {
        name: currentBusiness.name,
        country: currentBusiness.country,
        currency: currentBusiness.currency,
        timezone: currentBusiness.timezone,
      },
      new_value: {
        name: validation.data.name,
        country: validation.data.country,
        currency: validation.data.currency,
        timezone: validation.data.timezone,
      },
    })

    if (auditError) {
      logger.error('updateBusinessProfile: audit insert failed', { businessId, error: auditError })
      return { success: false, error: auditError.message ?? 'Unable to write audit log' }
    }

    revalidatePath('/dashboard/owner/settings')
    logger.info('Business profile updated', { businessId, actor: profile.id })
    return { success: true, error: null }
  } catch (error: unknown) {
    logger.error('updateBusinessProfile: unexpected error', { businessId, error })
    return { success: false, error: error instanceof Error ? error.message : 'Server error' }
  }
}

/**
 * Verifies the current password and updates the owner password.
 */
export async function changePassword(_prevState: FormState, formData: FormData): Promise<FormState> {
  const currentPassword = getString(formData, 'currentPassword')
  const newPassword = getString(formData, 'newPassword')
  const confirmPassword = getString(formData, 'confirmPassword')
  const validation = changePasswordSchema.safeParse({
    currentPassword,
    newPassword,
    confirmPassword,
  })

  if (!validation.success) {
    return { success: false, error: validation.error.errors[0]?.message ?? 'Invalid password details' }
  }

  const profile = await requireRole([GlobalRole.Owner])
  const businessId = profile.business_id

  if (!businessId) {
    logger.error('changePassword: missing business id', { userId: profile.id })
    return { success: false, error: 'Business context missing' }
  }

  try {
    const supabase = await createClient()

    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('id, name, email, phone')
      .eq('business_id', businessId)
      .eq('id', profile.id)
      .maybeSingle()

    if (userError) {
      logger.error('changePassword: user lookup failed', { businessId, userId: profile.id, error: userError })
      return { success: false, error: userError.message ?? 'Unable to load account profile' }
    }

    const user = userData as UserProfileRow | null
    if (!user?.email) {
      return { success: false, error: 'Account email not found' }
    }

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: user.email,
      password: validation.data.currentPassword,
    })

    if (signInError) {
      logger.warn('changePassword: current password verification failed', { businessId, userId: profile.id })
      return { success: false, error: 'Current password is incorrect' }
    }

    const { error: updateError } = await supabase.auth.updateUser({
      password: validation.data.newPassword,
    })

    if (updateError) {
      logger.error('changePassword: auth update failed', { businessId, userId: profile.id, error: updateError })
      return { success: false, error: updateError.message ?? 'Unable to update password' }
    }

    const { error: auditError } = await supabase.from('audit_logs').insert({
      business_id: businessId,
      actor_id: profile.id,
      entity_type: 'user',
      entity_id: profile.id,
      action: 'updated_password',
      old_value: { password_changed: false },
      new_value: { password_changed: true },
    })

    if (auditError) {
      logger.error('changePassword: audit insert failed', { businessId, userId: profile.id, error: auditError })
      return { success: false, error: auditError.message ?? 'Unable to write audit log' }
    }

    logger.info('Owner password updated', { businessId, userId: profile.id })
    return { success: true, error: null }
  } catch (error: unknown) {
    logger.error('changePassword: unexpected error', { businessId, userId: profile.id, error })
    return { success: false, error: error instanceof Error ? error.message : 'Server error' }
  }
}

/**
 * Submits the current owner's login review for platform approval.
 */
export async function submitOwnerLoginReview(_prevState: FormState, formData: FormData): Promise<FormState> {
  const validation = loginReviewSchema.safeParse({
    quote: getString(formData, 'quote'),
    reviewerTitle: getString(formData, 'reviewerTitle'),
  })

  if (!validation.success) {
    return { success: false, error: validation.error.errors[0]?.message ?? 'Invalid review details' }
  }

  const profile = await requireRole([GlobalRole.Owner])

  try {
    const supabase = await createClient()
    const { quote, reviewerTitle } = validation.data
    const { error } = await supabase.rpc('owner_submit_login_review', {
      p_quote: quote,
      p_reviewer_title: reviewerTitle,
    })

    if (error) {
      logger.error('submitOwnerLoginReview: insert failed', { actor: profile.id, error })
      return { success: false, error: error.message ?? 'Unable to submit review' }
    }

    revalidatePath('/dashboard/owner/settings')
    return { success: true, error: null }
  } catch (error: unknown) {
    logger.error('submitOwnerLoginReview: unexpected error', { actor: profile.id, error })
    return { success: false, error: error instanceof Error ? error.message : 'Server error' }
  }
}

/**
 * Submits a manual rental payment reference for Retivox verification.
 */
export async function submitSubscriptionPayment(_prevState: FormState, formData: FormData): Promise<FormState> {
  const validation = subscriptionPaymentSchema.safeParse({
    paymentMethod: getString(formData, 'paymentMethod') || 'mpesa_manual',
    referenceCode: getString(formData, 'referenceCode'),
    payerPhone: getString(formData, 'payerPhone') || undefined,
  })

  if (!validation.success) {
    return { success: false, error: validation.error.errors[0]?.message ?? 'Invalid payment details' }
  }

  const profile = await requireRole([GlobalRole.Owner])
  const businessId = profile.business_id

  if (!businessId) {
    logger.error('submitSubscriptionPayment: missing business id', { userId: profile.id })
    return { success: false, error: 'Business context missing' }
  }

  try {
    const supabase = await createClient()
    const { error } = await supabase.rpc('owner_submit_subscription_payment', {
      p_reference_code: validation.data.referenceCode,
      p_payment_method: validation.data.paymentMethod,
      p_payer_phone: validation.data.payerPhone ?? null,
    })

    if (error) {
      logger.error('submitSubscriptionPayment: rpc failed', { businessId, userId: profile.id, error })
      return { success: false, error: error.message ?? 'Unable to submit payment reference' }
    }

    revalidatePath('/dashboard/owner/settings')
    logger.info('Subscription payment request submitted', { businessId, userId: profile.id })
    return { success: true, error: null }
  } catch (error: unknown) {
    logger.error('submitSubscriptionPayment: unexpected error', { businessId, userId: profile.id, error })
    return { success: false, error: error instanceof Error ? error.message : 'Server error' }
  }
}

/**
 * Initiates an M-Pesa STK Push for the current owner subscription.
 */
export async function initiateSubscriptionStkPush(_prevState: FormState, formData: FormData): Promise<FormState> {
  const validation = darajaPaymentSchema.safeParse({
    phone: getString(formData, 'phone'),
    amount: getString(formData, 'amount'),
  })

  if (!validation.success) {
    return { success: false, error: validation.error.errors[0]?.message ?? 'Invalid phone number' }
  }

  const profile = await requireRole([GlobalRole.Owner])
  const businessId = profile.business_id

  if (!businessId) {
    logger.error('initiateSubscriptionStkPush: missing business id', { userId: profile.id })
    return { success: false, error: 'Business context missing' }
  }

  let normalizedPhone = ''

  try {
    normalizedPhone = normalizeKenyanPhone(validation.data.phone)
  } catch (error: unknown) {
    return { success: false, error: error instanceof Error ? error.message : 'Invalid phone number' }
  }

  const serviceClient = createServiceRoleClient()
  let paymentRequestId: string | null = null

  try {
    const existingSubscriptionResponse = await serviceClient
      .from('subscriptions')
      .select('id, monthly_amount, currency')
      .eq('business_id', businessId)
      .maybeSingle()

    if (existingSubscriptionResponse.error) {
      logger.error('initiateSubscriptionStkPush: subscription lookup failed', { businessId, error: existingSubscriptionResponse.error })
      return { success: false, error: existingSubscriptionResponse.error.message ?? 'Unable to load subscription payment' }
    }

    const subscriptionResponse = existingSubscriptionResponse.data
      ? existingSubscriptionResponse
      : await serviceClient
          .from('subscriptions')
          .insert({
            business_id: businessId,
            plan: 'starter',
            status: 'active',
            branch_count: 1,
            monthly_amount: 200,
            currency: 'KES',
            payment_provider: 'daraja',
          })
          .select('id, monthly_amount, currency')
          .single()

    const subscriptionData = subscriptionResponse.data
    const subscriptionError = subscriptionResponse.error

    if (subscriptionError || !subscriptionData) {
      logger.error('initiateSubscriptionStkPush: subscription upsert failed', { businessId, error: subscriptionError })
      return { success: false, error: subscriptionError?.message ?? 'Unable to prepare subscription payment' }
    }

    const amount = Number(subscriptionData.monthly_amount)
    if (!Number.isInteger(amount) || amount <= 0 || validation.data.amount !== amount) {
      return { success: false, error: 'The payment amount must match your current subscription price.' }
    }

    const promptConfig = await getDarajaPromptConfiguration()
    const currency = String(subscriptionData.currency ?? 'KES')
    const referenceCode = `STK-${Date.now()}`

    const { data: paymentData, error: paymentError } = await serviceClient
      .from('subscription_payment_requests')
      .insert({
        business_id: businessId,
        subscription_id: subscriptionData.id,
        submitted_by: profile.id,
        amount,
        currency,
        payment_method: 'mpesa_stk',
        reference_code: referenceCode,
        payer_phone: normalizedPhone,
        status: 'pending',
        provider: 'daraja',
        provider_result_description: `STK Push queued for PayBill ${promptConfig.shortcode}, account ${promptConfig.accountReference}`,
      })
      .select('id')
      .single()

    if (paymentError || !paymentData) {
      logger.error('initiateSubscriptionStkPush: payment request insert failed', { businessId, error: paymentError })
      return { success: false, error: paymentError?.message ?? 'Unable to create payment request' }
    }

    paymentRequestId = paymentData.id

    const response = await initiateDarajaStkPush({
      phone: normalizedPhone,
      amount,
      accountReference: promptConfig.accountReference,
      transactionDescription: 'Retivox subscription',
    })

    if (!response.CheckoutRequestID) {
      throw new Error(response.ResponseDescription ?? 'Daraja did not return a checkout request id')
    }

    const { error: updateError } = await serviceClient
      .from('subscription_payment_requests')
      .update({
        provider_merchant_request_id: response.MerchantRequestID ?? null,
        provider_checkout_request_id: response.CheckoutRequestID,
        provider_result_description: response.CustomerMessage ?? response.ResponseDescription ?? `STK Push sent to ${normalizedPhone}`,
        raw_provider_payload: response,
      })
      .eq('id', paymentRequestId)

    if (updateError) {
      throw new Error(updateError.message)
    }

    revalidatePath('/dashboard/owner/settings')
    return {
      success: true,
      error: null,
      message: 'M-Pesa prompt sent. Complete it on your phone.',
    }
  } catch (error: unknown) {
    if (paymentRequestId) {
      await serviceClient
        .from('subscription_payment_requests')
        .update({
          status: 'rejected',
          provider_result_description: error instanceof Error ? error.message : 'STK Push failed',
          review_note: error instanceof Error ? error.message : 'STK Push failed',
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', paymentRequestId)
    }

    logger.error('initiateSubscriptionStkPush: failed', { businessId, userId: profile.id, error })
    return { success: false, error: error instanceof Error ? error.message : 'Unable to send M-Pesa prompt' }
  }
}

/**
 * Signs the owner out from the settings danger zone.
 */
export async function logoutFromSettings(): Promise<void> {
  const supabase = await createClient()

  try {
    await supabase.auth.signOut()
    revalidatePath('/')
  } catch (error: unknown) {
    logger.error('logoutFromSettings: sign out failed', { error })
  }

  redirect('/login')
}
