import { expect, test } from '@playwright/test'
import { normalizeKenyanPhoneNumber } from './daraja'

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
