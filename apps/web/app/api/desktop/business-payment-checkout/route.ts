import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getBusinessDarajaSetup, startBusinessDarajaCheckout } from '../../../../lib/payments/businessDaraja'
import { createServiceRoleClient } from '../../../../lib/supabase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const requestSchema = z.object({
  paymentId: z.string().uuid(),
  phone: z.string().trim().min(9).max(20),
})

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(request: Request) {
  const authorization = request.headers.get('authorization') ?? ''
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : ''
  if (!token || token.length > 8192) return json({ error: 'Sign in online before requesting an M-PESA prompt.' }, 401)

  let body: unknown
  try {
    const raw = await request.text()
    if (raw.length > 4096) return json({ error: 'Payment request is too large.' }, 413)
    body = JSON.parse(raw)
  } catch {
    return json({ error: 'Invalid payment request.' }, 400)
  }
  const parsed = requestSchema.safeParse(body)
  if (!parsed.success) return json({ error: parsed.error.issues[0]?.message ?? 'Check the payment details.' }, 400)

  const service = createServiceRoleClient()
  const { data: auth, error: authError } = await service.auth.getUser(token)
  if (authError || !auth.user) return json({ error: 'Your online session expired. Sign in again.' }, 401)

  const { data: profile, error: profileError } = await service.from('users')
    .select('id,business_id,global_role,is_active,deleted_at')
    .eq('id', auth.user.id)
    .maybeSingle()
  if (profileError || !profile || !profile.business_id || !profile.is_active || profile.deleted_at) {
    return json({ error: 'This account is not active for business payments.' }, 403)
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !anonKey) return json({ error: 'Payment service is temporarily unavailable.' }, 503)
  const sessionClient = createSupabaseClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data: payment, error: paymentError } = await service.from('payments')
    .select('id,business_id,payment_method,status,reference_code')
    .eq('id', parsed.data.paymentId)
    .eq('business_id', profile.business_id)
    .maybeSingle()
  const stkIntent = payment?.payment_method === 'mpesa_stk' ||
    (payment?.payment_method === 'mpesa_manual' && payment.reference_code?.startsWith('STK-PENDING:'))
  if (paymentError || !payment || !stkIntent || payment.status !== 'pending_verify') {
    return json({ error: 'This payment is not waiting for an M-PESA prompt.' }, 409)
  }

  const { data: enabled, error: entitlementError } = await sessionClient.rpc('business_payment_method_enabled', {
    p_business_id: profile.business_id,
    p_method: 'mpesa_stk',
  })
  if (entitlementError || enabled !== true) {
    return json({ error: entitlementError?.message ?? 'M-PESA prompts are not enabled for this business plan.' }, 403)
  }

  try {
    const setup = await getBusinessDarajaSetup(profile.business_id)
    await startBusinessDarajaCheckout({
      businessId: profile.business_id,
      paymentId: payment.id,
      phone: parsed.data.phone,
      setup,
      sessionClient,
    })
    return json({ success: true, paymentId: payment.id })
  } catch (error) {
    // Server-side errors are sanitized by the payment service. Never serialize
    // configuration, tokens, passkeys, or provider request bodies to clients.
    return json({ error: error instanceof Error ? error.message : 'Could not start the payment prompt.' }, 409)
  }
}
