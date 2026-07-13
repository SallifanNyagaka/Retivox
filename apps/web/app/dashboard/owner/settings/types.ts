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
  created_at: string
}

/**
 * Standard form state returned by settings server actions.
 */
export type FormState = {
  error: string | null
  success: boolean
}
