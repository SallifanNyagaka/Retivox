import { createServiceRoleClient } from '../supabase/admin'
import { createClient } from '../supabase/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getBusinessDarajaConfig, initiateDarajaStkPushWithConfig, type DarajaConfig } from './daraja'
import { processBusinessDarajaCallback, type BusinessDarajaCallbackPayload } from './businessDarajaCallback'

type StartedCheckoutRow = {
  business_id: string
  owner_id: string
  transaction_id: string
  amount: number | string
  phone: string
}

export async function getBusinessDarajaSetup(businessId: string): Promise<{ ownerId: string; config: DarajaConfig }> {
  const serviceClient = createServiceRoleClient()
  const { data: owner, error } = await serviceClient.from('users')
    .select('id').eq('business_id', businessId).eq('global_role', 'owner').eq('is_active', true)
    .is('deleted_at', null).order('created_at', { ascending: true }).limit(1).maybeSingle()
  if (error || !owner) throw new Error('The active business owner could not be loaded.')
  return { ownerId: owner.id, config: await getBusinessDarajaConfig(businessId, owner.id) }
}

/** Starts a business-owned STK prompt for a payment row already recorded as pending. */
export async function startBusinessDarajaCheckout(input: {
  businessId: string
  paymentId: string
  phone: string
  setup?: { ownerId: string; config: DarajaConfig }
  sessionClient?: SupabaseClient
}) {
  const serviceClient = createServiceRoleClient()
  // Load configuration before reserving the single checkout attempt.
  const setup = input.setup ?? await getBusinessDarajaSetup(input.businessId)
  const sessionClient = input.sessionClient ?? await createClient()
  const { data, error } = await sessionClient.rpc('start_business_daraja_stk_checkout', {
    p_payment_id: input.paymentId,
    p_phone: input.phone,
  })
  if (error) throw new Error(error.message)
  const row = (Array.isArray(data) ? data[0] : data) as StartedCheckoutRow | null
  if (!row || row.business_id !== input.businessId || row.owner_id !== setup.ownerId) {
    throw new Error('The payment could not be linked to this business.')
  }

  const response = await initiateDarajaStkPushWithConfig({
    phone: row.phone,
    amount: Number(row.amount),
    accountReference: `RV${row.transaction_id.replaceAll('-', '').slice(0, 10)}`,
    transactionDescription: `Retivox sale ${row.transaction_id.slice(0, 8)}`,
  }, setup.config)
  if (response.ResponseCode !== '0' || !response.CheckoutRequestID || !response.MerchantRequestID) {
    throw new Error('Daraja did not confirm the payment prompt request. Check the sale payment status before retrying.')
  }

  const { data: updatedPayment, error: updateError } = await serviceClient
    .from('payments')
    .update({ mpesa_checkout_id: response.CheckoutRequestID, provider_merchant_request_id: response.MerchantRequestID })
    .eq('id', input.paymentId)
    .eq('business_id', input.businessId)
    .eq('provider', 'daraja')
    .is('mpesa_checkout_id', null)
    .select('id')
    .maybeSingle()
  if (updateError || !updatedPayment) {
    throw new Error('The M-Pesa prompt was sent, but its reference could not be saved. Contact support before retrying this sale.')
  }

  // Safaricom can callback before the response's CheckoutRequestID has been
  // committed to payments. The callback inbox retains that event; replay it
  // now that the exact payment correlation is durable.
  const { data: earlyCallbacks } = await serviceClient.from('provider_webhook_events')
    .select('provider_payload')
    .eq('provider', 'daraja')
    .eq('result', 'unmatched')
    .contains('provider_payload', { Body: { stkCallback: { CheckoutRequestID: response.CheckoutRequestID } } })
    .limit(3)
  for (const event of earlyCallbacks ?? []) {
    try {
      await processBusinessDarajaCallback(
        serviceClient,
        event.provider_payload as BusinessDarajaCallbackPayload,
        async () => setup,
      )
    } catch {
      // Keep the inbox event unmatched for callback retry or reconciliation.
      // Never turn an accepted prompt into an assumed successful payment.
    }
  }

  return { checkoutRequestId: response.CheckoutRequestID }
}
