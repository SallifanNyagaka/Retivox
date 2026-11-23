import { getDarajaCallbackDisposition, normalizeKenyanPhoneNumber, shouldDeferSuccessfulDarajaCallback, shouldQueryDarajaStatusForCallback, verifyDarajaStkCheckoutWithConfig, type DarajaConfig } from './daraja'

export type BusinessDarajaCallbackPayload = {
  Body?: { stkCallback?: {
    MerchantRequestID?: string
    CheckoutRequestID?: string
    ResultCode?: number
    ResultDesc?: string
    CallbackMetadata?: { Item?: Array<{ Name?: string; Value?: string | number }> }
  } }
}

type ServiceClient = ReturnType<typeof import('../supabase/admin').createServiceRoleClient>
type DarajaSetup = { ownerId: string; config: DarajaConfig }

function metadataValue(payload: BusinessDarajaCallbackPayload, name: string) {
  return payload.Body?.stkCallback?.CallbackMetadata?.Item?.find((item) => item.Name === name)?.Value ?? null
}

/**
 * Processes one callback by its CheckoutRequestID. Passing a setup from the
 * checkout caller allows the short callback-before-ID-persistence race to be
 * replayed immediately without reloading credentials.
 */
export async function processBusinessDarajaCallback(
  serviceClient: ServiceClient,
  payload: BusinessDarajaCallbackPayload,
  resolveSetup: (businessId: string) => Promise<DarajaSetup>,
) {
  const callback = payload.Body?.stkCallback
  const checkoutRequestId = callback?.CheckoutRequestID?.trim()
  const resultCode = Number(callback?.ResultCode)
  if (!checkoutRequestId || checkoutRequestId.length > 128 || !Number.isInteger(resultCode)) {
    return { httpStatus: 400, result: { ResultCode: 1, ResultDesc: 'Checkout reference is missing' } }
  }

  const { data: payment, error: paymentError } = await serviceClient.from('payments')
    .select('business_id,payment_method,status')
    .eq('provider', 'daraja').eq('mpesa_checkout_id', checkoutRequestId).maybeSingle()
  if (paymentError) throw paymentError
  if (!payment) {
    const { error } = await serviceClient.rpc('record_business_daraja_stk_result', {
      p_checkout_request_id: checkoutRequestId,
      p_merchant_request_id: callback?.MerchantRequestID ?? null,
      p_result_code: resultCode,
      p_result_description: (callback?.ResultDesc ?? 'Unmatched Daraja callback').slice(0, 500),
      p_receipt: metadataValue(payload, 'MpesaReceiptNumber') === null ? null : String(metadataValue(payload, 'MpesaReceiptNumber')),
      p_paid_amount: metadataValue(payload, 'Amount') === null ? null : Number(metadataValue(payload, 'Amount')),
      p_phone: metadataValue(payload, 'PhoneNumber') === null ? null : String(metadataValue(payload, 'PhoneNumber')),
      // The event table is service-role only. Keep the provider phone there so
      // a callback received just before checkout-ID persistence can be replayed.
      // This payload is never sent to logs or clients.
      p_raw_payload: payload,
    })
    if (error) throw error
    return { httpStatus: 200, result: { ResultCode: 0, ResultDesc: 'Unmatched callback retained for replay' } }
  }
  if (payment.payment_method !== 'mpesa_stk') {
    return { httpStatus: 409, result: { ResultCode: 1, ResultDesc: 'Payment is not a Daraja checkout' } }
  }

  const disposition = getDarajaCallbackDisposition(payment.status, resultCode)
  if (disposition === 'already_processed') {
    return { httpStatus: 200, result: { ResultCode: 0, ResultDesc: 'Already processed' } }
  }
  if (disposition === 'verified' && shouldQueryDarajaStatusForCallback(resultCode)) {
    const setup = await resolveSetup(payment.business_id)
    const verifiedCode = await verifyDarajaStkCheckoutWithConfig(checkoutRequestId, setup.config)
    if (shouldDeferSuccessfulDarajaCallback(verifiedCode)) {
      return { httpStatus: 409, result: { ResultCode: 1, ResultDesc: 'Provider status could not be verified' } }
    }
  }

  const receiptValue = metadataValue(payload, 'MpesaReceiptNumber')
  const amountValue = metadataValue(payload, 'Amount')
  const phoneValue = metadataValue(payload, 'PhoneNumber')
  const phone = phoneValue === null ? null : String(phoneValue)
  if (resultCode === 0) {
    const receipt = receiptValue === null ? null : String(receiptValue).trim()
    const amount = amountValue === null ? null : Number(amountValue)
    if (!receipt || !Number.isFinite(amount) || !phone) {
      return { httpStatus: 400, result: { ResultCode: 1, ResultDesc: 'Payment details are incomplete' } }
    }
    normalizeKenyanPhoneNumber(phone)
  }

  const { data: processed, error } = await serviceClient.rpc('record_business_daraja_stk_result', {
    p_checkout_request_id: checkoutRequestId,
    p_merchant_request_id: callback?.MerchantRequestID ?? null,
    p_result_code: resultCode,
    p_result_description: (callback?.ResultDesc ?? 'No Daraja result description').slice(0, 500),
    p_receipt: receiptValue === null ? null : String(receiptValue).trim(),
    p_paid_amount: amountValue === null ? null : Number(amountValue),
    p_phone: phone,
    p_raw_payload: payload,
  })
  if (error) throw error
  if (processed !== true) return { httpStatus: 200, result: { ResultCode: 0, ResultDesc: 'Payment not matched; retained for review' } }
  return { httpStatus: 200, result: { ResultCode: 0, ResultDesc: 'Accepted' } }
}
