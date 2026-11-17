import { NextResponse } from 'next/server'
import { processBusinessPesapalNotification } from '../../../../../lib/payments/pesapal'
import logger from '../../../../../lib/logger'

type PesapalNotification = {
  OrderTrackingId?: string
  orderTrackingId?: string
  OrderMerchantReference?: string
  orderMerchantReference?: string
  OrderNotificationType?: string
  orderNotificationType?: string
}

async function payloadFrom(request: Request): Promise<PesapalNotification> {
  const url = new URL(request.url)
  if (request.method === 'GET') return {
    OrderTrackingId: url.searchParams.get('OrderTrackingId') ?? url.searchParams.get('orderTrackingId') ?? undefined,
    OrderMerchantReference: url.searchParams.get('OrderMerchantReference') ?? url.searchParams.get('orderMerchantReference') ?? undefined,
    OrderNotificationType: url.searchParams.get('OrderNotificationType') ?? url.searchParams.get('orderNotificationType') ?? undefined,
  }
  if (Number(request.headers.get('content-length') ?? 0) > 16384) throw new Error('Payload too large')
  const text = await request.text()
  if (text.length > 16384) throw new Error('Payload too large')
  const body = JSON.parse(text) as unknown
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid payload')
  return body as PesapalNotification
}

export async function GET(request: Request) { return handle(request) }
export async function POST(request: Request) { return handle(request) }

async function handle(request: Request) {
  let body: PesapalNotification
  try { body = await payloadFrom(request) } catch {
    return NextResponse.json({ status: 500, message: 'Invalid Pesapal notification' }, { status: 400 })
  }
  const trackingId = String(body.OrderTrackingId ?? body.orderTrackingId ?? '').trim()
  const merchantReference = String(body.OrderMerchantReference ?? body.orderMerchantReference ?? '').trim()
  const notificationType = String(body.OrderNotificationType ?? body.orderNotificationType ?? '').trim()
  if (!trackingId || trackingId.length > 128 || !merchantReference || merchantReference.length > 80
      || !['IPNCHANGE', 'CALLBACKURL'].includes(notificationType.toUpperCase())) {
    return NextResponse.json({ status: 500, message: 'Invalid Pesapal notification fields' }, { status: 400 })
  }

  try {
    const result = await processBusinessPesapalNotification(trackingId)
    // Callback references are not trusted for settlement. Status is fetched from Pesapal and
    // its merchant_reference is compared with the pending payment in the database.
    logger.info('Pesapal IPN processed', { trackingId, matched: result.matched, verified: result.verified })
    return NextResponse.json({
      orderNotificationType: notificationType,
      orderTrackingId: trackingId,
      orderMerchantReference: merchantReference,
      status: 200,
    })
  } catch (error) {
    logger.error('Pesapal IPN status verification failed', { trackingId, error })
    return NextResponse.json({
      orderNotificationType: notificationType,
      orderTrackingId: trackingId,
      orderMerchantReference: merchantReference,
      status: 500,
    }, { status: 503 })
  }
}
