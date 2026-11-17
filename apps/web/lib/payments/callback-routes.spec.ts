import { expect, test } from '@playwright/test'
import { POST as darajaStkCallback } from '../../app/api/payments/daraja/callback/route'
import { POST as darajaC2bValidation } from '../../app/api/payments/daraja/c2b/validation/route'
import { POST as pesapalBusinessIpn } from '../../app/api/payments/pesapal/ipn/route'
import { GET as pesapalBusinessCallback } from '../../app/api/payments/pesapal/callback/route'
import { POST as pesapalSubscriptionIpn } from '../../app/api/payments/pesapal/subscription-ipn/route'

const baseUrl = 'https://retivox.example'

test.describe('payment callback input boundaries', () => {
  test('rejects malformed and incomplete Daraja STK callbacks before settlement', async () => {
    const malformed = await darajaStkCallback(new Request(`${baseUrl}/api/payments/daraja/callback`, {
      method: 'POST', body: '{not-json',
    }))
    expect(malformed.status).toBe(400)

    const incomplete = await darajaStkCallback(new Request(`${baseUrl}/api/payments/daraja/callback`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ Body: { stkCallback: { ResultCode: 0 } } }),
    }))
    expect(incomplete.status).toBe(400)
  })

  test('rejects invalid Daraja C2B shortcodes without accepting a receipt', async () => {
    const response = await darajaC2bValidation(new Request(`${baseUrl}/api/payments/daraja/c2b/validation`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ BusinessShortCode: 'not-a-shortcode' }),
    }))
    expect((await response.json()).ResultCode).toBe(1)
  })

  test('rejects missing Pesapal business and subscription IPN references', async () => {
    const businessResponse = await pesapalBusinessIpn(new Request(`${baseUrl}/api/payments/pesapal/ipn`, {
      method: 'POST', body: JSON.stringify({}),
    }))
    expect(businessResponse.status).toBe(400)

    const subscriptionResponse = await pesapalSubscriptionIpn(new Request(`${baseUrl}/api/payments/pesapal/subscription-ipn`, {
      method: 'POST', body: JSON.stringify({ OrderTrackingId: 'track-1' }),
    }))
    expect(subscriptionResponse.status).toBe(400)
  })

  test('keeps invalid hosted-checkout return destinations on a safe local route', async () => {
    const response = await pesapalBusinessCallback(new Request(
      `${baseUrl}/api/payments/pesapal/callback?returnTo=https%3A%2F%2Fevil.example&OrderTrackingId=&OrderMerchantReference=`,
    ))
    const destination = new URL(response.headers.get('location') ?? '')
    expect(destination.origin).toBe(baseUrl)
    expect(destination.pathname).toBe('/dashboard/employee/transactions')
    expect(destination.searchParams.get('pesapal')).toBe('verification-pending')
  })
})
