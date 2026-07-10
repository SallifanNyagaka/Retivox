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
import logger from '../../../../lib/logger'
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
