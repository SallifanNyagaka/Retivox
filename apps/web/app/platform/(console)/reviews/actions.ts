'use server'

import { revalidatePath } from 'next/cache'
import { createServiceRoleClient } from '../../../../lib/supabase/admin'
import { requirePlatformUser } from '../../../../lib/platform/auth'
import logger from '../../../../lib/logger'

function getString(formData: FormData, key: string): string {
  const value = formData.get(key)
  return typeof value === 'string' ? value.trim() : ''
}

async function requireDeveloper() {
  const user = await requirePlatformUser()

  if (user.role !== 'developer') {
    throw new Error('Only platform developers can moderate login reviews')
  }

  return user
}

function revalidateLoginReviewSurfaces() {
  revalidatePath('/platform/reviews')
  revalidatePath('/login')
  revalidatePath('/api/login-reviews')
}

export async function approveLoginReview(formData: FormData): Promise<void> {
  const reviewId = getString(formData, 'reviewId')
  const user = await requireDeveloper()

  if (!reviewId) {
    throw new Error('Review id is required')
  }

  const serviceClient = createServiceRoleClient()
  const approvedAt = new Date().toISOString()
  const { error } = await serviceClient
    .from('login_reviews')
    .update({
      status: 'approved',
      is_active: true,
      approved_by: user.id,
      approved_at: approvedAt,
      review_note: null,
    })
    .eq('id', reviewId)
    .eq('role', 'owner')

  if (error) {
    logger.error('approveLoginReview: update failed', { reviewId, platformUserId: user.id, error })
    throw new Error(error.message)
  }

  await serviceClient.from('platform_audit_logs').insert({
    platform_user_id: user.id,
    entity_type: 'login_review',
    entity_id: reviewId,
    action: 'approved',
    old_value: null,
    new_value: { status: 'approved', is_active: true, approved_at: approvedAt },
  })

  revalidateLoginReviewSurfaces()
}

export async function rejectLoginReview(formData: FormData): Promise<void> {
  const reviewId = getString(formData, 'reviewId')
  const reviewNote = getString(formData, 'reviewNote')
  const user = await requireDeveloper()

  if (!reviewId) {
    throw new Error('Review id is required')
  }

  const serviceClient = createServiceRoleClient()
  const reviewedAt = new Date().toISOString()
  const { error } = await serviceClient
    .from('login_reviews')
    .update({
      status: 'rejected',
      is_active: false,
      approved_by: user.id,
      approved_at: reviewedAt,
      review_note: reviewNote || 'Review was not approved for the login page.',
    })
    .eq('id', reviewId)
    .eq('role', 'owner')

  if (error) {
    logger.error('rejectLoginReview: update failed', { reviewId, platformUserId: user.id, error })
    throw new Error(error.message)
  }

  await serviceClient.from('platform_audit_logs').insert({
    platform_user_id: user.id,
    entity_type: 'login_review',
    entity_id: reviewId,
    action: 'rejected',
    old_value: null,
    new_value: { status: 'rejected', is_active: false, review_note: reviewNote || null },
  })

  revalidateLoginReviewSurfaces()
}
