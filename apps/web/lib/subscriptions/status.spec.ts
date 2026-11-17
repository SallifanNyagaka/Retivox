import { expect, test } from '@playwright/test'
import { effectiveSubscriptionStatus } from './status'

const day = 24 * 60 * 60 * 1000

test.describe('effectiveSubscriptionStatus', () => {
  test('keeps a paid subscription active until its period end', () => {
    const now = Date.parse('2026-11-16T12:00:00.000Z')
    expect(effectiveSubscriptionStatus('active', new Date(now + 1).toISOString(), now)).toBe('active')
  })

  test('grants paid subscriptions the full seven-day renewal grace period', () => {
    const now = Date.parse('2026-11-16T12:00:00.000Z')
    const end = new Date(now - 6 * day).toISOString()
    expect(effectiveSubscriptionStatus('active', end, now)).toBe('past_due')
    expect(effectiveSubscriptionStatus('active', new Date(now - 7 * day).toISOString(), now)).toBe('expired')
  })

  test('expires a trial at the end date without a paid renewal grace period', () => {
    const now = Date.parse('2026-11-16T12:00:00.000Z')
    expect(effectiveSubscriptionStatus('active', new Date(now - 1).toISOString(), now, { isTrial: true })).toBe('expired')
  })

  test('expires a voluntarily cancelled paid subscription at the paid period end', () => {
    const now = Date.parse('2026-11-16T12:00:00.000Z')
    expect(effectiveSubscriptionStatus('active', new Date(now - 1).toISOString(), now, { cancelledAt: '2026-11-01T00:00:00.000Z' })).toBe('expired')
  })

  test('leaves lifetime subscriptions without a renewal date unchanged', () => {
    expect(effectiveSubscriptionStatus('active', null, Date.now())).toBe('active')
  })

  test('preserves unknown stored states and ignores invalid dates', () => {
    const now = Date.parse('2026-11-16T12:00:00.000Z')
    expect(effectiveSubscriptionStatus('suspended', 'invalid-date', now)).toBe('suspended')
    expect(effectiveSubscriptionStatus(null, 'invalid-date', now)).toBe('unknown')
  })
})
