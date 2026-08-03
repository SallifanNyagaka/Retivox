import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse } from 'next/server'

type MobileSessionPayload = {
  accessToken?: unknown
  refreshToken?: unknown
  path?: unknown
}

type MobileUserRow = {
  global_role: 'owner' | 'admin' | 'employee' | null
  is_active: boolean | null
}

const DASHBOARD_PREFIXES = {
  owner: '/dashboard/owner/',
  admin: '/dashboard/admin/',
} as const

/**
 * Establishes the normal web cookie session for an already authenticated
 * mobile owner or admin. Tokens are posted over HTTPS and are never put in a
 * URL, log entry, or persisted by this route.
 */
export async function POST(request: Request) {
  const payload = await readPayload(request)
  const accessToken = typeof payload?.accessToken === 'string' ? payload.accessToken : ''
  const refreshToken = typeof payload?.refreshToken === 'string' ? payload.refreshToken : ''
  const path = typeof payload?.path === 'string' ? payload.path : ''

  if (!accessToken || !refreshToken || !isDashboardPath(path)) {
    return NextResponse.json({ error: 'Invalid mobile dashboard request.' }, { status: 400 })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json({ error: 'Dashboard authentication is unavailable.' }, { status: 503 })
  }

  const redirectUrl = new URL(path, request.url)
  const response = NextResponse.redirect(redirectUrl, 303)
  response.headers.set('Cache-Control', 'no-store')

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      get(name: string) {
        return request.headers.get('cookie')
          ?.split(';')
          .map((item) => item.trim())
          .find((item) => item.startsWith(`${name}=`))
          ?.slice(name.length + 1)
      },
      set(name: string, value: string, options: CookieOptions) {
        response.cookies.set({ name, value, ...options })
      },
      remove(name: string, options: CookieOptions) {
        response.cookies.set({ name, value: '', ...options, maxAge: 0 })
      },
    },
  })

  const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  })

  if (sessionError || !sessionData.user) {
    return NextResponse.json({ error: 'Your mobile session has expired. Reopen Retivox and try again.' }, { status: 401 })
  }

  const { data: profileData, error: profileError } = await supabase
    .from('users')
    .select('global_role, is_active')
    .eq('id', sessionData.user.id)
    .maybeSingle()

  const profile = profileData as MobileUserRow | null
  if (profileError || !profile || profile.is_active !== true || !canOpenPath(profile.global_role, path)) {
    return NextResponse.json({ error: 'You are not allowed to open this dashboard section.' }, { status: 403 })
  }

  return response
}

async function readPayload(request: Request): Promise<MobileSessionPayload | null> {
  try {
    const value = await request.json()
    return value && typeof value === 'object' ? value as MobileSessionPayload : null
  } catch {
    return null
  }
}

function isDashboardPath(path: string): boolean {
  return Object.values(DASHBOARD_PREFIXES).some((prefix) => path.startsWith(prefix))
}

function canOpenPath(role: MobileUserRow['global_role'], path: string): boolean {
  return (role === 'owner' && path.startsWith(DASHBOARD_PREFIXES.owner)) ||
    (role === 'admin' && path.startsWith(DASHBOARD_PREFIXES.admin))
}
