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
import { createHash, randomBytes } from 'node:crypto'
import { createClient } from '../supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import {
  createBusinessSchema,
  loginSchema,
  registerUserSchema,
  GlobalRole,
} from '@smartretail/shared'
import logger from '../logger'
import { isRetivoxEmailInUse, RETIVOX_EMAIL_IN_USE_MESSAGE } from './accountEmail'
import { recordLoginAttempt } from '../platform/auth'
import { createServiceRoleClient } from '../supabase/admin'

/**
 * Form state returned by all server actions to the client.
 */
export type FormState = {
  error: string | null
  success: boolean
  globalRole?: GlobalRole
  nativeReturnUrl?: string | null
  notice?: string | null
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

async function rollbackIncompleteRegistration(adminClient: ReturnType<typeof getAdminClient>, userId: string, businessId?: string) {
  try {
    const { error: authDeleteError } = await adminClient.auth.admin.deleteUser(userId)
    if (authDeleteError) {
      logger.error('Incomplete registration cleanup could not remove auth user', { userId, businessId, error: authDeleteError })
      return
    }
    if (businessId) {
      const { error: businessDeleteError } = await adminClient.from('businesses').delete().eq('id', businessId)
      if (businessDeleteError) logger.error('Incomplete registration cleanup could not remove new business', { userId, businessId, error: businessDeleteError })
    }
  } catch (error) {
    logger.error('Incomplete registration cleanup threw an error', { userId, businessId, error })
  }
}

/**
 * Creates a new business and owner account with compensating cleanup if a
 * later database insert fails after Supabase Auth has created the user.
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
  const nativeApp = getStringValue(formData, 'nativeApp') === '1'
  const nativeState = getStringValue(formData, 'nativeState')
  const codeChallenge = getStringValue(formData, 'codeChallenge')

  if (nativeApp && (!/^[A-Za-z0-9_-]{43}$/.test(nativeState) || !/^[A-Za-z0-9_-]{43}$/.test(codeChallenge))) {
    return { error: 'The app registration session expired. Return to Retivox and try again.', success: false }
  }

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

  // A normalized email identifies exactly one Retivox account across all roles.
  // Check before Auth sign-up to avoid creating partial businesses on conflicts.
  const adminClient = getAdminClient()
  try {
    if (await isRetivoxEmailInUse(adminClient, email)) {
      return { error: RETIVOX_EMAIL_IN_USE_MESSAGE, success: false }
    }
  } catch (error: unknown) {
    logger.error('Account email registration check failed', {
      email,
      error,
    })
    return {
      error: 'We could not verify this email right now. Please try again shortly.',
      success: false,
    }
  }

  // Create Supabase auth user — regular client is fine for auth
  const supabase = await createClient()
  const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
    email: email.trim().toLowerCase(),
    password,
  })

  if (signUpError || !signUpData?.user) {
    logger.error('Auth signUp failed', { email, error: signUpError?.message })
    return {
      error: signUpError?.message ?? 'Unable to create account',
      success: false,
    }
  }

  if (
    !signUpData.session &&
    Array.isArray(signUpData.user.identities) &&
    signUpData.user.identities.length === 0
  ) {
    return {
      error: RETIVOX_EMAIL_IN_USE_MESSAGE,
      success: false,
    }
  }

  const userId = signUpData.user.id
  const { data: trialPlan } = await adminClient
    .from('platform_subscription_plans')
    .select('trial_days')
    .eq('plan_key', 'trial')
    .maybeSingle()
  const trialDays = Math.min(90, Math.max(0, Number(trialPlan?.trial_days ?? 30)))
  const trialStartedAt = new Date()
  const trialEndsAt = new Date(trialStartedAt.getTime() + trialDays * 24 * 60 * 60 * 1000)

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
  // Insert business record
  const { data: businessData, error: businessInsertError } = await adminClient
    .from('businesses')
    .insert({
      name: businessName,
      slug,
      country,
      currency,
      timezone,
      subscription_plan: 'trial',
      subscription_status: 'active',
      trial_ends_at: trialEndsAt.toISOString(),
    })
    .select('id')
    .single()

  if (businessInsertError || !businessData?.id) {
    logger.error('Business insert failed', { email, error: businessInsertError?.message })
    await rollbackIncompleteRegistration(adminClient, userId)
    return {
      error: 'Unable to finish business registration. Please try again.',
      success: false,
    }
  }

  const businessId = businessData.id

  // Insert user profile — links auth user to business
  const { error: userInsertError } = await adminClient.from('users').insert({
    id: userId,
    business_id: businessId,
    name,
    email: email.trim().toLowerCase(),
    phone,
    global_role: 'owner',
  })

  if (userInsertError) {
    logger.error('User profile insert failed', { userId, businessId, error: userInsertError.message })
    await rollbackIncompleteRegistration(adminClient, userId, businessId)
    return {
      error: 'Unable to finish business registration. Please try again.',
      success: false,
    }
  }

  // Start every new business on the platform-configured free trial.
  const { data: subscription, error: subscriptionError } = await adminClient.from('subscriptions').insert({
    business_id: businessId,
    plan: 'trial',
    status: 'active',
    branch_count: 1,
    monthly_amount: 0,
    currency: 'KES',
    payment_provider: null,
    current_period_start: trialStartedAt.toISOString(),
    current_period_end: trialEndsAt.toISOString(),
  }).select('id').single()

  if (subscriptionError || !subscription?.id) {
    logger.error('Subscription insert failed', { businessId, error: subscriptionError })
    await rollbackIncompleteRegistration(adminClient, userId, businessId)
    return {
      error: 'Unable to finish business registration. Please try again.',
      success: false,
    }
  }

  const { error: trialEventError } = await adminClient.from('subscription_license_events').insert({
    business_id: businessId,
    subscription_id: subscription.id,
    actor_user_id: userId,
    event_type: 'trial_started',
    from_plan: null,
    to_plan: 'trial',
    from_interval: null,
    to_interval: 'monthly',
    reason: `Configured ${trialDays}-day free trial started at registration`,
  })
  if (trialEventError) {
    logger.error('Trial subscription audit insert failed', { userId, businessId, error: trialEventError })
    await rollbackIncompleteRegistration(adminClient, userId, businessId)
    return { error: 'Unable to finish business registration. Please try again.', success: false }
  }

  if (nativeApp) {
    if (!signUpData.session?.refresh_token) {
      return {
        error: null,
        success: true,
        notice: 'Your account is created. Verify your email, then sign in to Retivox to continue.',
      }
    }

    const handoffCode = randomBytes(32).toString('base64url')
    const codeHash = createHash('sha256').update(handoffCode).digest('hex')
    await adminClient.from('native_app_auth_handoffs').delete().lt('expires_at', new Date().toISOString())
    const { error: handoffError } = await adminClient
      .from('native_app_auth_handoffs')
      .insert({
        code_hash: codeHash,
        code_challenge: codeChallenge,
        user_id: userId,
        refresh_token: signUpData.session.refresh_token,
        expires_at: new Date(Date.now() + 3 * 60 * 1000).toISOString(),
      })

    if (handoffError) {
      logger.error('Native registration handoff could not be created', { userId, error: handoffError.message })
      return {
        error: null,
        success: true,
        notice: 'Your account is created. Sign in to Retivox with the email and password you just registered.',
      }
    }

    const callback = new URL('retivox://auth/callback')
    callback.searchParams.set('code', handoffCode)
    callback.searchParams.set('state', nativeState)
    logger.info('Business and owner registered successfully', { userId, businessId, nativeHandoff: true })
    return { error: null, success: true, nativeReturnUrl: callback.toString() }
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
    email: email.trim().toLowerCase(),
    password,
  })

  if (signInError || !signInData?.user) {
    // Never expose the real error — generic message for security
    logger.warn('Failed login attempt', { email })
    await recordLoginAttempt({
      email,
      surface: 'tenant',
      success: false,
      failureReason: 'Invalid email or password',
    })
    return { error: 'We could not sign you in. Check your email and password, or if you are new to Retivox, create an account with us first.', success: false }
  }

  // Fetch user profile to get role and active status
  const { data: profileData, error: profileError } = await supabase
    .from('users')
    .select('business_id, global_role, is_active')
    .eq('id', signInData.user.id)
    .maybeSingle()

  if (profileError || !profileData || profileData.is_active === false || !profileData.global_role) {
    await supabase.auth.signOut()
    logger.warn('Login blocked — profile missing or inactive', { email })
    await recordLoginAttempt({
      businessId: profileData?.business_id ?? null,
      email,
      attemptedRole: profileData?.global_role ?? null,
      surface: 'tenant',
      success: false,
      failureReason: 'Account not found or deactivated',
    })
    return { error: 'Account not found or deactivated', success: false }
  }

  const serviceClient = createServiceRoleClient()
  const { data: businessStatus } = await serviceClient
    .from('businesses')
    .select('is_active, platform_status, subscription_status')
    .eq('id', profileData.business_id)
    .maybeSingle()

  if (
    businessStatus &&
    (businessStatus.is_active === false ||
      businessStatus.platform_status === 'deactivated' ||
      businessStatus.platform_status === 'deletion_scheduled')
  ) {
    await supabase.auth.signOut()
    await recordLoginAttempt({
      businessId: profileData.business_id,
      email,
      attemptedRole: profileData.global_role,
      surface: 'tenant',
      success: false,
      failureReason: 'Business account deactivated by platform',
    })
    return { error: 'This business account has been deactivated. Contact Retivox support.', success: false }
  }

  logger.info('User logged in successfully', { email, role: profileData.global_role })

  await recordLoginAttempt({
    businessId: profileData.business_id,
    email,
    attemptedRole: profileData.global_role,
    surface: 'tenant',
    success: true,
  })

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
