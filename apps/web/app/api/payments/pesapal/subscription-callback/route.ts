import { NextResponse } from 'next/server'
import { processPlatformPesapalNotification } from '../../../../../lib/payments/pesapal'
import logger from '../../../../../lib/logger'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const trackingId = (url.searchParams.get('OrderTrackingId') ?? '').trim()
  const merchantReference = (url.searchParams.get('OrderMerchantReference') ?? '').trim()
  const destination = new URL('/dashboard/owner/settings', url.origin)
  if (!trackingId || trackingId.length > 128 || !merchantReference || merchantReference.length > 80) {
    destination.searchParams.set('subscriptionPayment', 'verification-pending')
    return NextResponse.redirect(destination)
  }
  try {
    const result = await processPlatformPesapalNotification(trackingId, merchantReference)
    destination.searchParams.set('subscriptionPayment', result.verified ? 'verified' : result.matched ? 'pending' : 'unmatched')
  } catch (error) {
    logger.error('Platform subscription Pesapal callback verification failed', { trackingId, error })
    destination.searchParams.set('subscriptionPayment', 'verification-pending')
  }
  return NextResponse.redirect(destination)
}
