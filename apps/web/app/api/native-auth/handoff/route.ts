import { createHash } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '../../../../lib/supabase/admin'

export const dynamic = 'force-dynamic'

const noStore = { 'Cache-Control': 'no-store, max-age=0', Pragma: 'no-cache' }

export async function POST(request: NextRequest) {
  let body: unknown
  try {
    const rawBody = await request.text()
    if (Buffer.byteLength(rawBody, 'utf8') > 2048) {
      return NextResponse.json({ success: false, error: 'Invalid sign-in handoff.' }, { status: 413, headers: noStore })
    }
    body = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid sign-in handoff.' }, { status: 400, headers: noStore })
  }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ success: false, error: 'Invalid sign-in handoff.' }, { status: 400, headers: noStore })
  }

  const { code, verifier } = body as Record<string, unknown>
  if (typeof code !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(code)
      || typeof verifier !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(verifier)) {
    return NextResponse.json({ success: false, error: 'This sign-in handoff is invalid or expired. Sign in normally.' }, { status: 400, headers: noStore })
  }

  const codeHash = createHash('sha256').update(code).digest('hex')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  const serviceClient = createServiceRoleClient()
  await serviceClient
    .from('native_app_auth_handoffs')
    .delete()
    .lt('expires_at', new Date().toISOString())
  const { data, error } = await serviceClient.rpc('consume_native_app_auth_handoff', {
    p_code_hash: codeHash,
    p_code_challenge: challenge,
  })

  if (error) {
    return NextResponse.json({ success: false, error: 'Could not complete app sign-in. Sign in normally.' }, { status: 503, headers: noStore })
  }

  const handoff = Array.isArray(data) ? data[0] as Record<string, unknown> | undefined : undefined
  const userId = typeof handoff?.user_id === 'string' ? handoff.user_id : ''
  const refreshToken = typeof handoff?.refresh_token === 'string' ? handoff.refresh_token : ''
  if (!userId || !refreshToken) {
    return NextResponse.json({ success: false, error: 'This sign-in handoff is invalid or expired. Sign in normally.' }, { status: 401, headers: noStore })
  }

  const { data: profile, error: profileError } = await serviceClient
    .from('users')
    .select('id')
    .eq('id', userId)
    .eq('is_active', true)
    .is('deleted_at', null)
    .maybeSingle()
  if (profileError || !profile) {
    return NextResponse.json({ success: false, error: 'This account is not active. Sign in normally or contact support.' }, { status: 403, headers: noStore })
  }

  return NextResponse.json(
    { success: true, refresh_token: refreshToken },
    { headers: noStore },
  )
}
