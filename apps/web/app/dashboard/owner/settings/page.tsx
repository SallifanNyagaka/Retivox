/**
 * Owner settings dashboard page.
 *
 * Loads business profile, owner account, and subscription information before
 * rendering the interactive settings dashboard.
 */

import { GlobalRole } from '@smartretail/shared'
import { requireRole } from '../../../../lib/auth/helpers'
import { createClient } from '../../../../lib/supabase/server'
import { createServiceRoleClient } from '../../../../lib/supabase/admin'
import logger from '../../../../lib/logger'
import { Card } from '../../../../components/ui/Card'
import SettingsPageClient from './SettingsPageClient'
import type { BusinessSettingsRow, LoginReviewRow, SubscriptionPaymentRequestRow, SubscriptionPlanOption, SubscriptionRow, UserProfileRow } from './types'

/**
 * Owner settings page server component.
 */
export default async function SettingsPage() {
  const profile = await requireRole([GlobalRole.Owner])
  const businessId = profile.business_id

  if (!businessId) {
    throw new Error('Owner profile missing business ID')
  }

  let business: BusinessSettingsRow | null = null
  let ownerProfile: UserProfileRow | null = null
  let subscription: SubscriptionRow | null = null
  let subscriptionPlans: SubscriptionPlanOption[] = []
  let subscriptionPaymentRequests: SubscriptionPaymentRequestRow[] = []
  let loginReviews: LoginReviewRow[] = []
  let pageError: string | null = null

  try {
    const supabase = await createClient()
    const serviceClient = createServiceRoleClient()

    const [businessResponse, ownerResponse, subscriptionResponse, paymentRequestsResponse, reviewsResponse, plansResponse] = await Promise.all([
      supabase
        .from('businesses')
        .select('id, name, country, currency, timezone, subscription_plan, subscription_status')
        .eq('id', businessId)
        .single(),
      supabase
        .from('users')
        .select('id, name, email, phone')
        .eq('business_id', businessId)
        .eq('id', profile.id)
        .single(),
      supabase
        .from('subscriptions')
        .select('id, plan, status, branch_count, monthly_amount, currency, current_period_end, billing_interval, next_plan_key, next_billing_interval, next_period_start')
        .eq('business_id', businessId)
        .maybeSingle(),
      supabase.rpc('owner_my_subscription_payment_requests', {
        p_limit: 10,
      }),
      supabase.rpc('owner_my_login_reviews', {
        p_limit: 10,
      }),
      serviceClient
        .from('platform_subscription_plans')
        .select('id, plan_key, name, description, monthly_amount, annual_discount_percent, currency, branch_limit, sort_order')
        .eq('is_active', true)
        .order('sort_order', { ascending: true }),
    ])

    if (businessResponse.error) {
      throw businessResponse.error
    }

    if (ownerResponse.error) {
      throw ownerResponse.error
    }

    if (subscriptionResponse.error) {
      throw subscriptionResponse.error
    }

    if (paymentRequestsResponse.error) {
      throw paymentRequestsResponse.error
    }

    if (reviewsResponse.error) {
      throw reviewsResponse.error
    }
    if (plansResponse.error) {
      throw plansResponse.error
    }

    business = businessResponse.data as BusinessSettingsRow
    ownerProfile = ownerResponse.data as UserProfileRow
    subscription = (subscriptionResponse.data ?? null) as SubscriptionRow | null
    subscriptionPaymentRequests = (paymentRequestsResponse.data ?? []) as SubscriptionPaymentRequestRow[]
    loginReviews = (reviewsResponse.data ?? []) as LoginReviewRow[]
    subscriptionPlans = (plansResponse.data ?? []) as SubscriptionPlanOption[]
  } catch (error: unknown) {
    logger.error('SettingsPage data fetch failed', { businessId, error })
    pageError = error instanceof Error ? error.message : 'Unable to load settings'
  }

  if (pageError || !business || !ownerProfile) {
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h1
            className="font-bold"
            style={{
              fontSize: '22px',
              color: 'var(--color-text-primary)',
              letterSpacing: '-0.3px',
            }}
          >
            Settings
          </h1>
          <p style={{ fontSize: '14px', color: 'var(--color-text-muted)', marginTop: '4px' }}>
            Manage business preferences, account security, and subscription details.
          </p>
        </div>

        <Card>
          <p style={{ fontSize: '14px', color: 'var(--color-danger)', margin: 0 }}>
            Failed to load settings. Please refresh and try again.
          </p>
        </Card>
      </div>
    )
  }

  return (
    <SettingsPageClient
      billingAsOf={new Date().toISOString()}
      business={business}
      ownerProfile={ownerProfile}
      subscription={subscription}
      subscriptionPlans={subscriptionPlans}
      subscriptionPaymentRequests={subscriptionPaymentRequests}
      loginReviews={loginReviews}
    />
  )
}
