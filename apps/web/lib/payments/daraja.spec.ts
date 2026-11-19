import { expect, test } from '@playwright/test'
import {
  buildDarajaStkRequestBody,
  getDarajaCallbackDisposition,
  initiateDarajaStkPushWithConfig,
  isDarajaPaymentTerminal,
  normalizeKenyanPhoneNumber,
  shouldDeferSuccessfulDarajaCallback,
  shouldQueryDarajaStatusForCallback,
  type DarajaConfig,
} from './daraja'

test.describe('normalizeKenyanPhoneNumber', () => {
  test('normalizes valid Safaricom 07 and 01 formats', () => {
    expect(normalizeKenyanPhoneNumber('0712345678')).toBe('254712345678')
    expect(normalizeKenyanPhoneNumber('712345678')).toBe('254712345678')
    expect(normalizeKenyanPhoneNumber('+254712345678')).toBe('254712345678')
    expect(normalizeKenyanPhoneNumber('254712345678')).toBe('254712345678')
    expect(normalizeKenyanPhoneNumber('0112345678')).toBe('254112345678')
    expect(normalizeKenyanPhoneNumber('112345678')).toBe('254112345678')
    expect(normalizeKenyanPhoneNumber('254112345678')).toBe('254112345678')
  })

  test('allows ordinary spaces, hyphens and parentheses', () => {
    expect(normalizeKenyanPhoneNumber('0712 345 678')).toBe('254712345678')
    expect(normalizeKenyanPhoneNumber('0712-345-678')).toBe('254712345678')
    expect(normalizeKenyanPhoneNumber('(+254) 712-345-678')).toBe('254712345678')
  })

  test('rejects empty, malformed, non-Kenyan and incorrectly sized numbers', () => {
    const invalidInputs = [
      '',
      '   ',
      '0212345678',
      '254212345678',
      '+255712345678',
      '071234567',
      '07123456789',
      '71234567',
      '7123456789',
      'phone-0712345678',
    ]

    for (const input of invalidInputs) {
      expect(() => normalizeKenyanPhoneNumber(input)).toThrow(/Safaricom phone number/)
    }
  })
})

const productionBuyGoodsConfig: DarajaConfig = {
  consumerKey: 'test-key',
  consumerSecret: 'test-secret',
  shortcode: '1303513',
  tillNumber: '1773827',
  passkey: 'test-passkey',
  callbackUrl: 'https://retivox.example/api/daraja/stk-callback',
  environment: 'production',
  baseUrl: 'https://api.safaricom.co.ke',
  transactionType: 'CustomerBuyGoodsOnline',
  accountReference: 'RETIVOX',
}

test.describe('Daraja Buy Goods STK request', () => {
  test('uses the Store/API shortcode for BusinessShortCode and password, and Till for PartyB', () => {
    const body = buildDarajaStkRequestBody({ transactionDescription: 'Subscription' }, productionBuyGoodsConfig, '20261119101010')
    expect(body.BusinessShortCode).toBe('1303513')
    expect(body.PartyB).toBe('1773827')
    expect(body.TransactionType).toBe('CustomerBuyGoodsOnline')
    expect(body.Password).toBe(Buffer.from('1303513test-passkey20261119101010').toString('base64'))
  })

  test('sends the separated identifiers in the actual STK request', async () => {
    const originalFetch = globalThis.fetch
    const requests: Array<{ url: string; init?: RequestInit }> = []
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      requests.push({ url, init })
      if (url.includes('/oauth/v1/generate')) {
        return new Response(JSON.stringify({ access_token: 'test-token' }), { status: 200 })
      }
      return new Response(JSON.stringify({ ResponseCode: '0', CheckoutRequestID: 'ws_CO_test', MerchantRequestID: 'merchant-test' }), { status: 200 })
    }) as typeof fetch
    try {
      await initiateDarajaStkPushWithConfig({
        phone: '0712345678', amount: 10, transactionDescription: 'Test purchase',
      }, productionBuyGoodsConfig)
      const stkRequest = requests.find((request) => request.url.includes('/mpesa/stkpush/v1/processrequest'))
      const body = JSON.parse(String(stkRequest?.init?.body)) as Record<string, unknown>
      expect(body.BusinessShortCode).toBe('1303513')
      expect(body.PartyB).toBe('1773827')
      expect(body.TransactionType).toBe('CustomerBuyGoodsOnline')
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

test.describe('Daraja callback finality', () => {
  test('settles successful callbacks only through the verified path', () => {
    expect(getDarajaCallbackDisposition('pending', 0)).toBe('verified')
    expect(shouldQueryDarajaStatusForCallback(0)).toBe(true)
  })

  test('records definitive callback failures such as 2002 without waiting for a status query', () => {
    expect(getDarajaCallbackDisposition('pending_verify', 2002)).toBe('failed')
    expect(shouldQueryDarajaStatusForCallback(2002)).toBe(false)
  })

  test('does not let a delayed 4999 status query defeat a successful callback', () => {
    expect(shouldDeferSuccessfulDarajaCallback(4999)).toBe(false)
    expect(shouldDeferSuccessfulDarajaCallback(0)).toBe(false)
  })

  test('keeps definitive failed payments terminal when delayed callbacks arrive', () => {
    expect(isDarajaPaymentTerminal('rejected')).toBe(true)
    expect(getDarajaCallbackDisposition('rejected', 0)).toBe('already_processed')
    expect(isDarajaPaymentTerminal('verified')).toBe(true)
    expect(isDarajaPaymentTerminal('pending_verify')).toBe(false)
  })
})
