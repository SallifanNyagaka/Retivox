import { NextResponse } from 'next/server'
import { normalizeKenyanPhoneNumber, verifyDarajaStkCheckout } from '../../../../lib/payments/daraja'
import { createServiceRoleClient } from '../../../../lib/supabase/admin'

type DarajaCallbackPayload = {
  Body?: {
    stkCallback?: {
      MerchantRequestID?: string
      CheckoutRequestID?: string
      ResultCode?: number
      ResultDesc?: string
      CallbackMetadata?: {
        Item?: Array<{
          Name?: string
          Value?: string | number
        }>
      }
    }
  }
}

function getMetadataValue(payload: DarajaCallbackPayload, name: string) {
  return payload.Body?.stkCallback?.CallbackMetadata?.Item?.find((item) => item.Name === name)?.Value ?? null
}

function maskPhoneNumber(value: string | number | null) {
  if (!value) return null
  const phone = String(value)

  if (phone.length <= 6) return '***'

  return `${phone.slice(0, 3)}***${phone.slice(-3)}`
}

function sanitizeCallbackPayload(payload: DarajaCallbackPayload): DarajaCallbackPayload {
  return {
    ...payload,
    Body: payload.Body
      ? {
          ...payload.Body,
          stkCallback: payload.Body.stkCallback
            ? {
                ...payload.Body.stkCallback,
                CallbackMetadata: payload.Body.stkCallback.CallbackMetadata
                  ? {
                      Item: payload.Body.stkCallback.CallbackMetadata.Item?.map((item) => (
                        item.Name === 'PhoneNumber'
                          ? { ...item, Value: maskPhoneNumber(item.Value ?? null) ?? undefined }
                          : item
                      )),
                    }
                  : undefined,
              }
            : undefined,
        }
      : undefined,
  }
}

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get('content-length') ?? 0)
  if (contentLength > 32768) {
    return NextResponse.json({ ResultCode: 1, ResultDesc: 'Payload too large' }, { status: 413 })
  }

  let payload: DarajaCallbackPayload

  try {
    const body = await request.text()
    if (body.length > 32768) {
      return NextResponse.json({ ResultCode: 1, ResultDesc: 'Payload too large' }, { status: 413 })
    }
    payload = JSON.parse(body) as DarajaCallbackPayload
  } catch {
    return NextResponse.json({ ResultCode: 1, ResultDesc: 'Invalid JSON payload' }, { status: 400 })
  }

  const callback = payload.Body?.stkCallback

  const checkoutRequestId = callback?.CheckoutRequestID?.trim()
  const resultCode = Number(callback?.ResultCode)
  if (!checkoutRequestId || checkoutRequestId.length > 128 || !Number.isInteger(resultCode)) {
    return NextResponse.json({ ResultCode: 1, ResultDesc: 'Missing CheckoutRequestID' }, { status: 400 })
  }

  try {
    const serviceClient = createServiceRoleClient()
    const { data: payment, error: lookupError } = await serviceClient
      .from('subscription_payment_requests')
      .select('id, amount, payer_phone, status, provider_merchant_request_id')
      .eq('provider', 'daraja')
      .eq('provider_checkout_request_id', checkoutRequestId)
      .order('submitted_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (lookupError) {
      throw lookupError
    }

    if (!payment) {
      return NextResponse.json({ ResultCode: 1, ResultDesc: 'Payment request not found' }, { status: 404 })
    }

    if (payment.status !== 'pending') {
      return NextResponse.json({ ResultCode: 0, ResultDesc: 'Already processed' })
    }

    if (
      payment.provider_merchant_request_id &&
      payment.provider_merchant_request_id !== callback?.MerchantRequestID
    ) {
      return NextResponse.json({ ResultCode: 1, ResultDesc: 'Merchant request mismatch' }, { status: 400 })
    }

    const verifiedResultCode = await verifyDarajaStkCheckout(checkoutRequestId)
    if (verifiedResultCode !== resultCode) {
      return NextResponse.json({ ResultCode: 1, ResultDesc: 'Provider result mismatch' }, { status: 409 })
    }

    const receiptValue = getMetadataValue(payload, 'MpesaReceiptNumber')
    const amountValue = getMetadataValue(payload, 'Amount')
    const phoneValue = getMetadataValue(payload, 'PhoneNumber')
    const receiptNumber = receiptValue === null ? null : String(receiptValue).trim()
    const paidAmount = amountValue === null ? null : Number(amountValue)
    const phoneNumber = phoneValue === null ? null : String(phoneValue)

    if (resultCode === 0) {
      let normalizedPhone: string
      try {
        normalizedPhone = normalizeKenyanPhoneNumber(phoneNumber ?? '')
      } catch {
        return NextResponse.json({ ResultCode: 1, ResultDesc: 'Invalid payment phone' }, { status: 400 })
      }

      if (!receiptNumber || !Number.isFinite(paidAmount) || paidAmount !== Number(payment.amount) || normalizedPhone !== payment.payer_phone) {
        return NextResponse.json({ ResultCode: 1, ResultDesc: 'Payment details mismatch' }, { status: 400 })
      }
    }

    const { data: processed, error } = await serviceClient.rpc('platform_record_daraja_payment_result_v2', {
      p_checkout_request_id: checkoutRequestId,
      p_merchant_request_id: callback?.MerchantRequestID ?? null,
      p_result_code: resultCode,
      p_result_description: (callback?.ResultDesc ?? 'No Daraja result description').slice(0, 500),
      p_raw_payload: sanitizeCallbackPayload(payload),
      p_provider_receipt_number: receiptNumber,
      p_provider_paid_amount: paidAmount,
      p_provider_phone_number: phoneNumber,
    })

    if (error) {
      throw error
    }
    if (processed !== true) {
      return NextResponse.json({ ResultCode: 1, ResultDesc: 'Payment could not be verified' }, { status: 409 })
    }

    return NextResponse.json({ ResultCode: 0, ResultDesc: 'Accepted' })
  } catch {
    return NextResponse.json({ ResultCode: 1, ResultDesc: 'Payment verification temporarily unavailable' }, { status: 503 })
  }
}
