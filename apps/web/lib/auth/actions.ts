'use server'

/**
 * This file contains Next.js Server Actions for authentication.
 *
 * Server Actions run on the server and are called directly from client components.
 * They handle business registration, login and logout.
 * All validation uses Zod schemas from @smartretail/shared.
 *
 * IMPORTANT: The admin client uses the service role key which bypasses RLS.
 * It is only used during registration when the user has no business_id yet.
 * It must never be exposed to the client.
 */

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '../supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import {
  createBusinessSchema,
  loginSchema,
  registerUserSchema,
  GlobalRole,
} from '@smartretail/shared'
import logger from '../logger'

/**
 * Form state returned by all server actions to the client.
 */
export type FormState = {
  error: string | null
  success: boolean
  globalRole?: GlobalRole
}

/**
 * Safely extracts a trimmed string value from FormData.
 */
const getStringValue = (formData: FormData, key: string): string => {
  const value = formData.get(key)
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Creates a Supabase admin client that bypasses RLS.
 * Used only for initial business and user creation during registration.
 * Never called from client-side code.
 */
const getAdminClient = () =>
  createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

/**
 * Creates a new business and owner account in one atomic flow.
 *
 * Flow:
 * 1. Validate user and business data using Zod schemas
 * 2. Create Supabase auth user
 * 3. Insert business record using admin client (bypasses RLS)
 * 4. Insert user profile record using admin client
 * 5. Insert trial subscription using admin client
 *
 * Redirect is handled client-side after success to allow
 * the client to show a success message first.
 *
 * @param prevState Previous form state from the client
 * @param formData The submitted registration form data
 * @returns FormState describing success or failure
 */
export async function registerBusinessAndOwner(
  _prevState: FormState,
  formData: FormData
): Promise<FormState> {
  const name = getStringValue(formData, 'name')
  const email = getStringValue(formData, 'email')
  const phone = getStringValue(formData, 'phone')
  const password = getStringValue(formData, 'password')
  const businessName = getStringValue(formData, 'businessName')
  const country = getStringValue(formData, 'country')
  const currency = getStringValue(formData, 'currency')
  const timezone = getStringValue(formData, 'timezone')

  // Validate user fields
  const userSchema = registerUserSchema.pick({ name: true, email: true, password: true })
  const userResult = userSchema.safeParse({ name, email, password })

  if (!userResult.success) {
    return {
      error: userResult.error.errors[0]?.message ?? 'Invalid user data',
      success: false,
    }
  }

  // Validate business fields
  const businessResult = createBusinessSchema.safeParse({
    name: businessName,
    country,
    currency,
    timezone,
  })

  if (!businessResult.success) {
    return {
      error: businessResult.error.errors[0]?.message ?? 'Invalid business data',
      success: false,
    }
  }

  // Create Supabase auth user — regular client is fine for auth
  const supabase = await createClient()
  const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
    email,
    password,
  })

  if (signUpError || !signUpData?.user) {
    logger.error('Auth signUp failed', { email, error: signUpError?.message })
    return {
      error: signUpError?.message ?? 'Unable to create account',
      success: false,
    }
  }

  const userId = signUpData.user.id

  // Generate URL-safe slug from business name
  const slug = businessName
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')

  // Use admin client for all DB inserts — user has no business_id yet
  // so RLS would block these inserts with the regular client
  const adminClient = getAdminClient()

  // Insert business record
  const { data: businessData, error: businessInsertError } = await adminClient
    .from('businesses')
    .insert({ name: businessName, slug, country, currency, timezone })
    .select('id')
    .single()

  if (businessInsertError || !businessData?.id) {
    logger.error('Business insert failed', { email, error: businessInsertError?.message })
    return {
      error: businessInsertError?.message ?? 'Unable to create business',
      success: false,
    }
  }

  const businessId = businessData.id

  // Insert user profile — links auth user to business
  const { error: userInsertError } = await adminClient.from('users').insert({
    id: userId,
    business_id: businessId,
    name,
    email,
    phone,
    global_role: 'owner',
  })

  if (userInsertError) {
    logger.error('User profile insert failed', { userId, businessId, error: userInsertError.message })
    return {
      error: userInsertError.message ?? 'Unable to create user profile',
      success: false,
    }
  }

  // Insert starter subscription. Payment collection starts manually in owner settings.
  const { error: subscriptionError } = await adminClient.from('subscriptions').insert({
    business_id: businessId,
    plan: 'starter',
    status: 'active',
    branch_count: 1,
    monthly_amount: 200,
    currency: 'KES',
    payment_provider: 'manual',
    current_period_start: new Date().toISOString(),
    current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  })

  if (subscriptionError) {
    logger.error('Subscription insert failed', { businessId, error: subscriptionError.message })
    return {
      error: subscriptionError.message ?? 'Unable to create subscription',
      success: false,
    }
  }

  logger.info('Business and owner registered successfully', { userId, businessId })

  return { error: null, success: true }
}

/**
 * Authenticates an existing user.
 *
 * The returned globalRole is used by the client to redirect
 * to the correct dashboard after login.
 *
 * @param prevState Previous form state from the client
 * @param formData The submitted login form data
 * @returns FormState describing success or failure with globalRole
 */
export async function loginUser(
  _prevState: FormState,
  formData: FormData
): Promise<FormState> {
  const email = getStringValue(formData, 'email')
  const password = getStringValue(formData, 'password')

  // Validate login fields
  const loginResult = loginSchema.safeParse({ email, password })

  if (!loginResult.success) {
    return {
      error: loginResult.error.errors[0]?.message ?? 'Invalid login data',
      success: false,
    }
  }

  const supabase = await createClient()
  const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
    email,
    password,
  })

  if (signInError || !signInData?.user) {
    // Never expose the real error — generic message for security
    logger.warn('Failed login attempt', { email })
    return { error: 'Invalid email or password', success: false }
  }

  // Fetch user profile to get role and active status
  const { data: profileData, error: profileError } = await supabase
    .from('users')
    .select('global_role, is_active')
    .eq('id', signInData.user.id)
    .maybeSingle()

  if (profileError || !profileData || profileData.is_active === false || !profileData.global_role) {
    await supabase.auth.signOut()
    logger.warn('Login blocked — profile missing or inactive', { email })
    return { error: 'Account not found or deactivated', success: false }
  }

  logger.info('User logged in successfully', { email, role: profileData.global_role })

  const routes: Record<GlobalRole, string> = {
    owner: '/dashboard/owner',
    admin: '/dashboard/admin',
    employee: '/dashboard/employee',
  }

  redirect(routes[profileData.global_role as GlobalRole] ?? '/dashboard/owner')
}

/**
 * Signs out the current user and clears the server-side session cache.
 * Redirects to /login after sign out.
 */
export async function logoutUser(): Promise<void> {
  const supabase = await createClient()
  await supabase.auth.signOut()
  revalidatePath('/')
  redirect('/login')
}
