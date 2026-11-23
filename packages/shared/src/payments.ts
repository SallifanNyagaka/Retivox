/**
 * Cross-client payment vocabulary and invariants. The database's existing
 * status strings are kept at the persistence boundary while new flows use an
 * explicit state model.
 */
export type PaymentState =
  | 'created'
  | 'initiating'
  | 'awaiting_customer'
  | 'processing'
  | 'pending_confirmation'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'expired'
  | 'awaiting_manual_verification'
  | 'requires_reconciliation'

export type PaymentAccountType = 'buy_goods' | 'paybill' | 'pochi' | 'manual' | 'other'

export type PaymentProvider = 'daraja' | 'pesapal' | 'manual' | 'cash' | 'card' | 'bank_transfer' | 'other'

export type BusinessPaymentMethodConfig = {
  methodCode: 'mpesa_manual' | 'bank_transfer' | 'card' | 'other'
  accountType: 'buy_goods' | 'paybill' | 'pochi' | 'bank_account' | 'other'
  displayName: string
  merchantNumber?: string | null
  accountReference?: string | null
  isActive: boolean
  isDefault: boolean
}

/** Client-side guidance; the Supabase constraints/RPC remain authoritative. */
export function validateBusinessPaymentMethod(config: BusinessPaymentMethodConfig): string | null {
  if (!config.displayName.trim()) return 'Enter a display name.'
  if (config.isDefault && !config.isActive) return 'An inactive payment method cannot be the default.'
  if (config.methodCode === 'mpesa_manual') {
    if (!['buy_goods', 'paybill', 'pochi'].includes(config.accountType)) {
      return 'Select Buy Goods, Paybill, or Pochi for manual M-PESA.'
    }
    if (!config.merchantNumber?.trim()) {
      return 'Enter the customer-facing Till, Paybill, or Pochi number.'
    }
    if (config.accountType === 'paybill' && !config.accountReference?.trim()) {
      return 'Enter the Paybill account/reference.'
    }
  }
  if (config.methodCode === 'bank_transfer' && config.accountType !== 'bank_account') {
    return 'Select bank account details for a bank transfer.'
  }
  return null
}

const terminalStates = new Set<PaymentState>(['succeeded', 'failed', 'cancelled', 'expired'])
const stateTransitions: Record<PaymentState, ReadonlySet<PaymentState>> = {
  created: new Set(['initiating', 'awaiting_manual_verification', 'cancelled']),
  initiating: new Set(['awaiting_customer', 'processing', 'pending_confirmation', 'failed', 'cancelled', 'requires_reconciliation']),
  awaiting_customer: new Set(['processing', 'pending_confirmation', 'succeeded', 'failed', 'cancelled', 'expired', 'requires_reconciliation']),
  processing: new Set(['pending_confirmation', 'succeeded', 'failed', 'cancelled', 'expired', 'requires_reconciliation']),
  pending_confirmation: new Set(['succeeded', 'failed', 'cancelled', 'expired', 'requires_reconciliation']),
  succeeded: new Set(),
  failed: new Set(),
  cancelled: new Set(),
  expired: new Set(),
  awaiting_manual_verification: new Set(['succeeded', 'failed', 'requires_reconciliation']),
  requires_reconciliation: new Set(['succeeded', 'failed', 'cancelled']),
}

export function canTransitionPayment(from: PaymentState, to: PaymentState): boolean {
  return stateTransitions[from].has(to)
}

export function isTerminalPaymentState(state: PaymentState): boolean {
  return terminalStates.has(state)
}

/** Map legacy payments.status values without treating pending as settlement. */
export function paymentStateFromLegacyStatus(status: string, method?: string): PaymentState {
  switch (status) {
    case 'pending':
      return method === 'mpesa_manual' ? 'awaiting_manual_verification' : 'pending_confirmation'
    case 'pending_verify':
      return method === 'mpesa_manual' ? 'awaiting_manual_verification' : 'pending_confirmation'
    case 'verified':
      return 'succeeded'
    case 'rejected':
      return 'failed'
    case 'voided':
      return 'cancelled'
    default:
      return 'requires_reconciliation'
  }
}

/** Convert a decimal KES amount to integer cents without binary rounding. */
export function toMinorUnits(value: string | number): number {
  const text = typeof value === 'number' ? value.toString() : value.trim()
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text)
  if (!match) throw new Error('Enter a non-negative amount with no more than two decimal places.')
  const whole = Number(match[1])
  const fraction = Number((match[2] ?? '').padEnd(2, '0'))
  const minor = whole * 100 + fraction
  if (!Number.isSafeInteger(minor)) throw new Error('Amount is outside the supported range.')
  return minor
}

export function fromMinorUnits(minor: number): string {
  if (!Number.isSafeInteger(minor) || minor < 0) throw new Error('Minor-unit amount must be a non-negative integer.')
  return `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, '0')}`
}
