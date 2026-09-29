/**
 * Shared types for the owner settings dashboard.
 *
 * These shapes keep business settings, account settings, subscription data,
 * and form states aligned across the server page and client components.
 */

/**
 * Business settings row fetched from the businesses table.
 */
export type BusinessSettingsRow = {
  id: string
  name: string
  country: string
  currency: string
  timezone: string
  subscription_plan: string
  subscription_status: string
}

/**
 * Owner profile row fetched from the users table.
 */
export type UserProfileRow = {
  id: string
  name: string
  email: string
  phone: string | null
}

/**
 * Subscription row fetched from the subscriptions table.
 */
export type SubscriptionRow = {
  id: string
  plan: string
  status: string
  branch_count: number
  monthly_amount: number
  currency: string
  current_period_end: string | null
  billing_interval: 'monthly' | 'yearly'
  next_plan_key: string | null
  next_billing_interval: 'monthly' | 'yearly' | null
  next_period_start: string | null
}

export type SubscriptionPlanOption = {
  id: string
  plan_key: 'trial' | 'starter' | 'growth' | 'enterprise'
  name: string
  description: string
  monthly_amount: number
  annual_discount_percent: number
  currency: string
  branch_limit: number | null
  sort_order: number
}

/**
 * Manual subscription payment request submitted by an owner.
 */
export type SubscriptionPaymentRequestRow = {
  id: string
  amount: number
  currency: string
  plan_key: string | null
  billing_interval: 'monthly' | 'yearly'
  payment_method: 'mpesa_stk' | 'mpesa_manual' | 'bank_transfer' | 'cash_deposit' | 'other'
  reference_code: string
  payer_phone: string | null
  status: 'pending' | 'verified' | 'rejected'
  review_note: string | null
  submitted_at: string
  reviewed_at: string | null
  provider_checkout_request_id: string | null
  provider_receipt_number: string | null
  provider_paid_amount: number | null
  provider_phone_number: string | null
  provider_result_description: string | null
}

/**
 * Review row displayed on the role-specific login panels.
 */
export type LoginReviewRow = {
  id: string
  role: 'owner' | 'admin' | 'employee'
  quote: string
  reviewer_name: string
  reviewer_title: string
  sort_order: number
  is_active: boolean
  status: 'pending' | 'approved' | 'rejected'
  review_note: string | null
  created_at: string
  approved_at: string | null
}

/**
 * Standard form state returned by settings server actions.
 */
export type FormState = {
  error: string | null
  message?: string | null
  success: boolean
}
