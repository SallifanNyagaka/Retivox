import { NextResponse } from 'next/server'
import { processBusinessPesapalNotification } from '../../../../../lib/payments/pesapal'
import logger from '../../../../../lib/logger'

const returnPaths = new Set([
  '/dashboard/employee/transactions',
  '/dashboard/owner/transactions',
  '/dashboard/admin/transactions',
])

export async function GET(request: Request) {
  const url = new URL(request.url)
  const trackingId = (url.searchParams.get('OrderTrackingId') ?? '').trim()
  const merchantReference = (url.searchParams.get('OrderMerchantReference') ?? '').trim()
  const returnToParam = url.searchParams.get('returnTo') ?? ''
  const returnTo = returnPaths.has(returnToParam) ? returnToParam : '/dashboard/employee/transactions'
  const destination = new URL(returnTo, url.origin)

  if (!trackingId || trackingId.length > 128 || !merchantReference || merchantReference.length > 80) {
    destination.searchParams.set('pesapal', 'verification-pending')
    return NextResponse.redirect(destination)
  }

  try {
    const result = await processBusinessPesapalNotification(trackingId)
    destination.searchParams.set('pesapal', result.verified ? 'verified' : result.matched ? 'pending' : 'unmatched')
  } catch (error) {
    logger.error('Pesapal customer callback verification failed', { trackingId, error })
    destination.searchParams.set('pesapal', 'verification-pending')
  }
  return NextResponse.redirect(destination)
}
