import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Read online payment entitlements through the authenticated database function.
 * Fail closed whenever the current subscription cannot be verified.
 */
export async function isBusinessPaymentMethodEnabled(
  client: SupabaseClient,
  businessId: string,
  method: 'mpesa_stk' | 'pesapal' | 'card' | 'bank_transfer',
): Promise<boolean> {
  const { data, error } = await client.rpc('business_payment_method_enabled', {
    p_business_id: businessId,
    p_method: method,
  })
  return !error && data === true
}

export function paymentMethodForProvider(provider: 'daraja' | 'pesapal') {
  return provider === 'daraja' ? 'mpesa_stk' : 'pesapal'
}
