import { expect, test } from '@playwright/test'
import {
  canTransitionPayment,
  fromMinorUnits,
  isTerminalPaymentState,
  paymentStateFromLegacyStatus,
  toMinorUnits,
  validateBusinessPaymentMethod,
} from '@smartretail/shared'

test.describe('shared payment invariants', () => {
  test('legacy manual M-PESA payments remain pending verification', () => {
    expect(paymentStateFromLegacyStatus('pending_verify', 'mpesa_manual')).toBe('awaiting_manual_verification')
    expect(paymentStateFromLegacyStatus('pending_verify', 'mpesa_stk')).toBe('pending_confirmation')
    expect(canTransitionPayment('awaiting_manual_verification', 'succeeded')).toBe(true)
    expect(canTransitionPayment('awaiting_manual_verification', 'failed')).toBe(true)
    expect(canTransitionPayment('awaiting_manual_verification', 'awaiting_customer')).toBe(false)
  })

  test('terminal provider outcomes cannot be silently reversed', () => {
    expect(isTerminalPaymentState('succeeded')).toBe(true)
    expect(canTransitionPayment('failed', 'succeeded')).toBe(false)
    expect(canTransitionPayment('requires_reconciliation', 'succeeded')).toBe(true)
  })

  test('decimal amounts use exact integer minor units', () => {
    expect(toMinorUnits('10.05')).toBe(1005)
    expect(fromMinorUnits(1005)).toBe('10.05')
    expect(() => toMinorUnits('10.005')).toThrow(/two decimal places/)
  })

  test('manual payment destinations require the matching public account details', () => {
    const paybill = {
      methodCode: 'mpesa_manual' as const,
      accountType: 'paybill' as const,
      displayName: 'Main Paybill',
      merchantNumber: '123456',
      accountReference: '',
      isActive: true,
      isDefault: true,
    }
    expect(validateBusinessPaymentMethod(paybill)).toMatch(/Paybill account\/reference/)
    expect(validateBusinessPaymentMethod({ ...paybill, accountReference: 'SHOP-01' })).toBeNull()
    expect(validateBusinessPaymentMethod({
      ...paybill,
      accountType: 'pochi',
      accountReference: '',
      merchantNumber: '',
    })).toMatch(/customer-facing/)
  })
})
