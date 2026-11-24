export type PlatformManualPaymentOption = {
  id: string
  method: 'mpesa_manual' | 'bank_transfer' | 'cash_deposit' | 'other'
  label: string
  destination: string
  accountName: string
  accountReference: string
  instructions: string
  active: boolean
}

export type PlatformSubscriptionPaymentConfig = {
  manual_payment_options: PlatformManualPaymentOption[]
  support_phone: string | null
  support_email: string | null
  support_whatsapp: string | null
  support_website: string | null
  support_message: string
}

export const EMPTY_PLATFORM_SUBSCRIPTION_PAYMENT_CONFIG: PlatformSubscriptionPaymentConfig = {
  manual_payment_options: [],
  support_phone: null,
  support_email: null,
  support_whatsapp: null,
  support_website: null,
  support_message: 'Need help with your subscription payment? Call or message us.',
}

export function parsePlatformManualPaymentOptions(value: unknown): PlatformManualPaymentOption[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return []
    const option = item as Record<string, unknown>
    if (
      typeof option.id !== 'string' ||
      !['mpesa_manual', 'bank_transfer', 'cash_deposit', 'other'].includes(String(option.method)) ||
      typeof option.label !== 'string' || typeof option.destination !== 'string'
    ) return []
    return [{
      id: option.id,
      method: option.method as PlatformManualPaymentOption['method'],
      label: option.label,
      destination: option.destination,
      accountName: typeof option.accountName === 'string' ? option.accountName : '',
      accountReference: typeof option.accountReference === 'string' ? option.accountReference : '',
      instructions: typeof option.instructions === 'string' ? option.instructions : '',
      active: option.active === true,
    }]
  })
}

export function parsePlatformSubscriptionPaymentConfig(value: unknown): PlatformSubscriptionPaymentConfig {
  const row = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
  return {
    manual_payment_options: parsePlatformManualPaymentOptions(row.manual_payment_options),
    support_phone: typeof row.support_phone === 'string' ? row.support_phone : null,
    support_email: typeof row.support_email === 'string' ? row.support_email : null,
    support_whatsapp: typeof row.support_whatsapp === 'string' ? row.support_whatsapp : null,
    support_website: typeof row.support_website === 'string' ? row.support_website : null,
    support_message: typeof row.support_message === 'string'
      ? row.support_message
      : EMPTY_PLATFORM_SUBSCRIPTION_PAYMENT_CONFIG.support_message,
  }
}
