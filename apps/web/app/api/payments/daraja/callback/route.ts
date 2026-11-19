import { NextResponse } from 'next/server'
import { getBusinessDarajaSetup } from '../../../../../lib/payments/businessDaraja'
import { getDarajaCallbackDisposition, normalizeKenyanPhoneNumber, shouldDeferSuccessfulDarajaCallback, shouldQueryDarajaStatusForCallback, verifyDarajaStkCheckoutWithConfig } from '../../../../../lib/payments/daraja'
import logger from '../../../../../lib/logger'
import { createServiceRoleClient } from '../../../../../lib/supabase/admin'

type DarajaCallbackPayload = {
  Body?: { stkCallback?: {
    MerchantRequestID?: string
    CheckoutRequestID?: string
    ResultCode?: number
    ResultDesc?: string
    CallbackMetadata?: { Item?: Array<{ Name?: string; Value?: string | number }> }
  } }
}

function value(payload: DarajaCallbackPayload, name: string) {
  return payload.Body?.stkCallback?.CallbackMetadata?.Item?.find((item) => item.Name === name)?.Value ?? null
}

function safePayload(payload: DarajaCallbackPayload): DarajaCallbackPayload {
  return {
    ...payload,
    Body: payload.Body ? { stkCallback: payload.Body.stkCallback ? {
      ...payload.Body.stkCallback,
      CallbackMetadata: payload.Body.stkCallback.CallbackMetadata ? {
        Item: payload.Body.stkCallback.CallbackMetadata.Item?.map((item) => item.Name === 'PhoneNumber' ? { ...item, Value: 'redacted' } : item),
      } : undefined,
    } : undefined } : undefined,
  }
}

export async function POST(request: Request) {
  let payload: DarajaCallbackPayload
  try {
    if (Number(request.headers.get('content-length') ?? 0) > 32768) return NextResponse.json({ ResultCode: 1, ResultDesc: 'Payload too large' }, { status: 413 })
    const text = await request.text()
    if (text.length > 32768) return NextResponse.json({ ResultCode: 1, ResultDesc: 'Payload too large' }, { status: 413 })
    payload = JSON.parse(text) as DarajaCallbackPayload
  } catch {
    return NextResponse.json({ ResultCode: 1, ResultDesc: 'Invalid callback payload' }, { status: 400 })
  }

  const callback = payload.Body?.stkCallback
  const checkoutRequestId = callback?.CheckoutRequestID?.trim()
  const resultCode = Number(callback?.ResultCode)
  if (!checkoutRequestId || checkoutRequestId.length > 128 || !Number.isInteger(resultCode)) {
    return NextResponse.json({ ResultCode: 1, ResultDesc: 'Checkout reference is missing' }, { status: 400 })
  }

  try {
    const serviceClient = createServiceRoleClient()
    const { data: payment, error: paymentError } = await serviceClient.from('payments')
      .select('business_id,payment_method,status,provider_merchant_request_id')
      .eq('provider', 'daraja').eq('mpesa_checkout_id', checkoutRequestId).maybeSingle()
    if (paymentError) throw paymentError
    if (!payment) {
      const { error: unmatchedError } = await serviceClient.rpc('record_business_daraja_stk_result', {
        p_checkout_request_id: checkoutRequestId,
        p_merchant_request_id: callback?.MerchantRequestID ?? null,
        p_result_code: resultCode,
        p_result_description: (callback?.ResultDesc ?? 'Unmatched Daraja callback').slice(0, 500),
        p_receipt: value(payload, 'MpesaReceiptNumber') === null ? null : String(value(payload, 'MpesaReceiptNumber')),
        p_paid_amount: value(payload, 'Amount') === null ? null : Number(value(payload, 'Amount')),
        p_phone: value(payload, 'PhoneNumber') === null ? null : String(value(payload, 'PhoneNumber')),
        p_raw_payload: safePayload(payload),
      })
      if (unmatchedError) throw unmatchedError
      return NextResponse.json({ ResultCode: 0, ResultDesc: 'Unmatched callback retained for review' })
    }
    if (payment.payment_method !== 'mpesa_stk') return NextResponse.json({ ResultCode: 1, ResultDesc: 'Payment is not a Daraja checkout' }, { status: 409 })
    const disposition = getDarajaCallbackDisposition(payment.status, resultCode)
    if (disposition === 'already_processed') return NextResponse.json({ ResultCode: 0, ResultDesc: 'Already processed' })

    // Safaricom callback failures are final for the correlated checkout. Only
    // successful callbacks need the extra status query; 4999 is query-pending,
    // so it must not supersede a final success callback.
    if (disposition === 'verified' && shouldQueryDarajaStatusForCallback(resultCode)) {
      const setup = await getBusinessDarajaSetup(payment.business_id)
      const verifiedCode = await verifyDarajaStkCheckoutWithConfig(checkoutRequestId, setup.config)
      if (shouldDeferSuccessfulDarajaCallback(verifiedCode)) {
        return NextResponse.json({ ResultCode: 1, ResultDesc: 'Provider status could not be verified' }, { status: 409 })
      }
    }

    const receiptValue = value(payload, 'MpesaReceiptNumber')
    const amountValue = value(payload, 'Amount')
    const phoneValue = value(payload, 'PhoneNumber')
    const phone = phoneValue === null ? null : String(phoneValue)
    if (resultCode === 0) {
      const receipt = receiptValue === null ? null : String(receiptValue).trim()
      const amount = amountValue === null ? null : Number(amountValue)
      if (!receipt || !Number.isFinite(amount) || !phone) return NextResponse.json({ ResultCode: 1, ResultDesc: 'Payment details are incomplete' }, { status: 400 })
      // Fail closed on malformed provider metadata; the database checks the saved phone and amount again.
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
      p_raw_payload: safePayload(payload),
    })
    if (error) throw error
    if (processed !== true) return NextResponse.json({ ResultCode: 0, ResultDesc: 'Payment not matched; retained for review' })
    return NextResponse.json({ ResultCode: 0, ResultDesc: 'Accepted' })
  } catch (error) {
    logger.error('Business Daraja callback verification failed', { error })
    return NextResponse.json({ ResultCode: 1, ResultDesc: 'Payment verification temporarily unavailable' }, { status: 503 })
  }
}
