import { NextResponse } from 'next/server'
import { createServiceRoleClient } from '../../../../../../lib/supabase/admin'

type C2BValidation = { BusinessShortCode?: string | number }

export async function POST(request: Request) {
  try {
    if (Number(request.headers.get('content-length') ?? 0) > 8192) return NextResponse.json({ ResultCode: 1, ResultDesc: 'Invalid request' })
    const text = await request.text()
    if (text.length > 8192) return NextResponse.json({ ResultCode: 1, ResultDesc: 'Invalid request' })
    const body = JSON.parse(text) as C2BValidation
    const shortcode = String(body?.BusinessShortCode ?? '').trim()
    if (!/^\d{4,12}$/.test(shortcode)) return NextResponse.json({ ResultCode: 1, ResultDesc: 'Invalid shortcode' })
    const client = createServiceRoleClient()
    const { count, error } = await client.from('business_payment_provider_settings')
      .select('id', { count: 'exact', head: true }).eq('provider', 'daraja').eq('is_active', true).eq('business_shortcode', shortcode)
    if (error || count !== 1) return NextResponse.json({ ResultCode: 1, ResultDesc: 'Shortcode is not uniquely configured' })
    // The merchant's C2B receipts still require reconciliation in Retivox.
    return NextResponse.json({ ResultCode: 0, ResultDesc: 'Accepted for merchant reconciliation' })
  } catch {
    return NextResponse.json({ ResultCode: 1, ResultDesc: 'Unable to validate payment' })
  }
}
