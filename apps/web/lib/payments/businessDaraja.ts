import { createServiceRoleClient } from '../supabase/admin'
import { createClient } from '../supabase/server'
import { getBusinessDarajaConfig, initiateDarajaStkPushWithConfig, type DarajaConfig } from './daraja'

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
}) {
  const serviceClient = createServiceRoleClient()
  // Load configuration before reserving the single checkout attempt.
  const setup = input.setup ?? await getBusinessDarajaSetup(input.businessId)
  const sessionClient = await createClient()
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

  return { checkoutRequestId: response.CheckoutRequestID }
}
