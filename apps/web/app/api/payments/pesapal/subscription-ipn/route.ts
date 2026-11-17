import { NextResponse } from 'next/server'
import { processPlatformPesapalNotification } from '../../../../../lib/payments/pesapal'
import logger from '../../../../../lib/logger'

type Notice = { OrderTrackingId?: string; OrderMerchantReference?: string; OrderNotificationType?: string }

async function handle(request: Request) {
  let body: Notice
  try {
    if (request.method === 'GET') {
      const url = new URL(request.url)
      body = { OrderTrackingId: url.searchParams.get('OrderTrackingId') ?? undefined,
        OrderMerchantReference: url.searchParams.get('OrderMerchantReference') ?? undefined,
        OrderNotificationType: url.searchParams.get('OrderNotificationType') ?? undefined }
    } else {
      const raw = await request.text()
      if (raw.length > 16384) throw new Error('Payload too large')
      const parsed: unknown = JSON.parse(raw)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid JSON payload')
      body = parsed as Notice
    }
  } catch {
    return NextResponse.json({ status: 500, message: 'Invalid Pesapal notification' }, { status: 400 })
  }
  const trackingId = String(body.OrderTrackingId ?? '').trim()
  const merchantReference = String(body.OrderMerchantReference ?? '').trim()
  const notificationType = String(body.OrderNotificationType ?? '').trim().toUpperCase()
  if (!trackingId || trackingId.length > 128 || !merchantReference || merchantReference.length > 80
      || !['IPNCHANGE', 'CALLBACKURL', 'RECURRING'].includes(notificationType)) {
    return NextResponse.json({ status: 500, message: 'Invalid Pesapal notification fields' }, { status: 400 })
  }
  try {
    const result = await processPlatformPesapalNotification(trackingId, merchantReference, notificationType)
    logger.info('Platform subscription Pesapal IPN processed', { trackingId, notificationType, matched: result.matched, verified: result.verified })
    return NextResponse.json({ orderNotificationType: notificationType, orderTrackingId: trackingId,
      orderMerchantReference: merchantReference, status: 200 })
  } catch (error) {
    logger.error('Platform subscription Pesapal IPN verification failed', { trackingId, error })
    return NextResponse.json({ orderNotificationType: notificationType, orderTrackingId: trackingId,
      orderMerchantReference: merchantReference, status: 500 }, { status: 503 })
  }
}

export async function GET(request: Request) { return handle(request) }
export async function POST(request: Request) { return handle(request) }
