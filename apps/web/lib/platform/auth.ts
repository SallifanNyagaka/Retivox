/**
 * Platform console authentication.
 *
 * Platform users are Retivox operators and are intentionally separate from
 * tenant business users. Sessions are stored server-side and referenced by an
 * opaque HTTP-only cookie.
 */

import crypto from 'crypto'
import { promisify } from 'node:util'
import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { createServiceRoleClient } from '../supabase/admin'

export type PlatformUser = {
  id: string
  name: string
  email: string
  role: 'developer' | 'operator' | 'support'
}

type PlatformUserRow = PlatformUser & {
  password_salt: string
  password_hash: string
  is_active: boolean
}

type PlatformSessionRow = {
  id: string
  platform_user_id: string
  expires_at: string
  last_seen_at: string
  platform_users: PlatformSessionUserRow | PlatformSessionUserRow[] | null
}

type PlatformSessionUserRow = Pick<PlatformUserRow, 'id' | 'name' | 'email' | 'role' | 'is_active'>

const PLATFORM_SESSION_COOKIE = 'retivox_platform_session'
const PLATFORM_SESSION_MAX_AGE_SECONDS = 60 * 60 * 12
const PLATFORM_SESSION_HEARTBEAT_MS = 5 * 60 * 1000
const PASSWORD_ITERATIONS = 210_000
const PASSWORD_KEY_LENGTH = 64
const PASSWORD_DIGEST = 'sha512'
const PLATFORM_LOGIN_WINDOW_MS = 15 * 60 * 1000
const PLATFORM_LOGIN_MAX_FAILURES = 8
const pbkdf2Async = promisify(crypto.pbkdf2)

function hashValue(value: string) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function normalizeJoin<Row>(value: Row | Row[] | null | undefined): Row | null {
  if (!value) return null
  return Array.isArray(value) ? value[0] ?? null : value
}

export async function hashPlatformPassword(password: string, salt: string) {
  const hash = await pbkdf2Async(password, salt, PASSWORD_ITERATIONS, PASSWORD_KEY_LENGTH, PASSWORD_DIGEST)
  return hash.toString('hex')
}

export async function createPlatformPassword(password: string) {
  const salt = crypto.randomBytes(16).toString('hex')
  return {
    salt,
    hash: await hashPlatformPassword(password, salt),
  }
}

export async function isPlatformLoginRateLimited(email: string) {
  const serviceClient = createServiceRoleClient()
  const cutoff = new Date(Date.now() - PLATFORM_LOGIN_WINDOW_MS).toISOString()
  const { count, error } = await serviceClient
    .from('platform_login_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('email', email.toLowerCase())
    .eq('surface', 'platform')
    .eq('success', false)
    .gte('created_at', cutoff)

  if (error) {
    throw new Error('Unable to check platform login attempts')
  }

  return (count ?? 0) >= PLATFORM_LOGIN_MAX_FAILURES
}

async function getRequestMeta() {
  const requestHeaders = await headers()
  const forwardedFor = requestHeaders.get('x-forwarded-for')
  const ipAddress = forwardedFor?.split(',')[0]?.trim() ?? requestHeaders.get('x-real-ip') ?? null
  const userAgent = requestHeaders.get('user-agent') ?? null

  return { ipAddress, userAgent }
}

export async function recordLoginAttempt(input: {
  businessId?: string | null
  platformUserId?: string | null
  email: string
  attemptedRole?: string | null
  surface: 'tenant' | 'platform'
  success: boolean
  failureReason?: string | null
}) {
  try {
    const { ipAddress, userAgent } = await getRequestMeta()
    const serviceClient = createServiceRoleClient()

    await serviceClient.from('platform_login_attempts').insert({
      business_id: input.businessId ?? null,
      platform_user_id: input.platformUserId ?? null,
      email: input.email.toLowerCase(),
      attempted_role: input.attemptedRole ?? null,
      surface: input.surface,
      success: input.success,
      failure_reason: input.failureReason ?? null,
      ip_address: ipAddress,
      user_agent: userAgent,
    })
  } catch {
    // Login attempts must never block the login flow itself.
  }
}

export async function bootstrapPlatformUserIfNeeded(email: string, password: string): Promise<PlatformUserRow | null> {
  const bootstrapEmail = process.env.PLATFORM_BOOTSTRAP_EMAIL?.trim().toLowerCase()
  const bootstrapPassword = process.env.PLATFORM_BOOTSTRAP_PASSWORD ?? ''

  if (!bootstrapEmail || !bootstrapPassword || email.toLowerCase() !== bootstrapEmail || password !== bootstrapPassword) {
    return null
  }

  const serviceClient = createServiceRoleClient()
  const { count } = await serviceClient
    .from('platform_users')
    .select('id', { count: 'exact', head: true })

  if ((count ?? 0) > 0) {
    return null
  }

  const passwordDetails = await createPlatformPassword(password)
  const { data, error } = await serviceClient
    .from('platform_users')
    .insert({
      name: process.env.PLATFORM_BOOTSTRAP_NAME?.trim() || 'Retivox Developer',
      email: bootstrapEmail,
      password_salt: passwordDetails.salt,
      password_hash: passwordDetails.hash,
      role: 'developer',
      is_active: true,
    })
    .select('id, name, email, role, password_salt, password_hash, is_active')
    .single()

  if (error) {
    throw new Error(error.message)
  }

  return data as PlatformUserRow
}

export async function createPlatformSession(platformUserId: string) {
  const token = crypto.randomBytes(32).toString('base64url')
  const tokenHash = hashValue(token)
  const expiresAt = new Date(Date.now() + PLATFORM_SESSION_MAX_AGE_SECONDS * 1000)
  const { ipAddress, userAgent } = await getRequestMeta()
  const serviceClient = createServiceRoleClient()

  const { error } = await serviceClient.from('platform_sessions').insert({
    platform_user_id: platformUserId,
    token_hash: tokenHash,
    user_agent: userAgent,
    ip_address: ipAddress,
    expires_at: expiresAt.toISOString(),
  })

  if (error) {
    throw new Error(error.message)
  }

  const cookieStore = await cookies()
  cookieStore.set({
    name: PLATFORM_SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: PLATFORM_SESSION_MAX_AGE_SECONDS,
  })
}

export async function getPlatformUser(): Promise<PlatformUser | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get(PLATFORM_SESSION_COOKIE)?.value

  if (!token) {
    return null
  }

  const serviceClient = createServiceRoleClient()
  const { data, error } = await serviceClient
    .from('platform_sessions')
    .select('id, platform_user_id, expires_at, last_seen_at, platform_users!inner(id, name, email, role, is_active)')
    .eq('token_hash', hashValue(token))
    .gt('expires_at', new Date().toISOString())
    .maybeSingle()

  if (error || !data) {
    return null
  }

  const session = data as PlatformSessionRow
  const user = normalizeJoin(session.platform_users)

  if (!user?.is_active) {
    return null
  }

  if (Date.now() - new Date(session.last_seen_at).getTime() >= PLATFORM_SESSION_HEARTBEAT_MS) {
    await serviceClient
      .from('platform_sessions')
      .update({ last_seen_at: new Date().toISOString() })
      .eq('id', session.id)
  }

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
  }
}

export async function requirePlatformUser(): Promise<PlatformUser> {
  const user = await getPlatformUser()

  if (!user) {
    redirect('/platform/login')
  }

  return user
}

export async function clearPlatformSession() {
  const cookieStore = await cookies()
  const token = cookieStore.get(PLATFORM_SESSION_COOKIE)?.value

  if (token) {
    const serviceClient = createServiceRoleClient()
    await serviceClient.from('platform_sessions').delete().eq('token_hash', hashValue(token))
  }

  cookieStore.set({
    name: PLATFORM_SESSION_COOKIE,
    value: '',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  })
}
