import { NextResponse } from 'next/server'
import { getBusinessDarajaSetup } from '../../../../../lib/payments/businessDaraja'
import { processBusinessDarajaCallback, type BusinessDarajaCallbackPayload } from '../../../../../lib/payments/businessDarajaCallback'
import logger from '../../../../../lib/logger'
import { createServiceRoleClient } from '../../../../../lib/supabase/admin'

export async function POST(request: Request) {
  let payload: BusinessDarajaCallbackPayload
  try {
    if (Number(request.headers.get('content-length') ?? 0) > 32768) return NextResponse.json({ ResultCode: 1, ResultDesc: 'Payload too large' }, { status: 413 })
    const text = await request.text()
    if (text.length > 32768) return NextResponse.json({ ResultCode: 1, ResultDesc: 'Payload too large' }, { status: 413 })
    payload = JSON.parse(text) as BusinessDarajaCallbackPayload
  } catch {
    return NextResponse.json({ ResultCode: 1, ResultDesc: 'Invalid callback payload' }, { status: 400 })
  }
  const checkoutRequestId = payload.Body?.stkCallback?.CheckoutRequestID?.trim()
  const resultCode = Number(payload.Body?.stkCallback?.ResultCode)
  if (!checkoutRequestId || checkoutRequestId.length > 128 || !Number.isInteger(resultCode)) {
    return NextResponse.json({ ResultCode: 1, ResultDesc: 'Checkout reference is missing' }, { status: 400 })
  }

  try {
    const serviceClient = createServiceRoleClient()
    const processed = await processBusinessDarajaCallback(
      serviceClient,
      payload,
      getBusinessDarajaSetup,
    )
    return NextResponse.json(processed.result, { status: processed.httpStatus })
  } catch (error) {
    logger.error('Business Daraja callback verification failed', { error })
    return NextResponse.json({ ResultCode: 1, ResultDesc: 'Payment verification temporarily unavailable' }, { status: 503 })
  }
}
