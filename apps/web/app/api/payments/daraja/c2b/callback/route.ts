import { NextResponse } from 'next/server'
import { createServiceRoleClient } from '../../../../../../lib/supabase/admin'
import logger from '../../../../../../lib/logger'

type C2BConfirmation = {
  TransID?: string | number
  TransAmount?: string | number
  MSISDN?: string | number
  BillRefNumber?: string | number
  BusinessShortCode?: string | number
  TransTime?: string | number
}

export async function POST(request: Request) {
  let body: C2BConfirmation
  try {
    if (Number(request.headers.get('content-length') ?? 0) > 16384) {
      return NextResponse.json({ ResultCode: 1, ResultDesc: 'Payload too large' }, { status: 413 })
    }
    const text = await request.text()
    if (text.length > 16384) return NextResponse.json({ ResultCode: 1, ResultDesc: 'Payload too large' }, { status: 413 })
    const parsed = JSON.parse(text) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid payload')
    body = parsed as C2BConfirmation
  } catch {
    return NextResponse.json({ ResultCode: 1, ResultDesc: 'Invalid C2B confirmation' }, { status: 400 })
  }

  const shortcode = String(body.BusinessShortCode ?? '').trim()
  const receipt = String(body.TransID ?? '').trim()
  const amount = Number(body.TransAmount)
  if (!/^\d{4,12}$/.test(shortcode) || !/^[A-Z0-9]{5,32}$/i.test(receipt) || !Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ ResultCode: 1, ResultDesc: 'Required payment details are invalid' }, { status: 400 })
  }

  try {
    const client = createServiceRoleClient()
    const { error } = await client.rpc('record_business_daraja_c2b_payment', {
      p_shortcode: shortcode,
      p_receipt: receipt,
      p_amount: amount,
      p_phone: String(body.MSISDN ?? '').slice(0, 32),
      p_bill_reference: String(body.BillRefNumber ?? '').slice(0, 128),
      p_transaction_time: String(body.TransTime ?? '').slice(0, 32),
    })
    if (error) throw error
    // Receipt rows remain unverified until a business user checks the provider statement.
    return NextResponse.json({ ResultCode: 0, ResultDesc: 'Received for reconciliation' })
  } catch (error) {
    logger.error('Daraja C2B confirmation could not be recorded', { receipt, error })
    return NextResponse.json({ ResultCode: 1, ResultDesc: 'Temporarily unable to record the confirmation' }, { status: 503 })
  }
}
