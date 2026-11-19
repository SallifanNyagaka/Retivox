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

async function persistCallbackDiagnostic(
  serviceClient: ReturnType<typeof createServiceRoleClient>,
  payload: DarajaCallbackPayload,
  checkoutRequestId: string,
  resultCode: number,
  outcome: string,
  detail?: string,
) {
  const sanitizedPayload = sanitizeCallbackPayload(payload) as Record<string, unknown>
  const { error } = await serviceClient.from('provider_webhook_events').upsert({
    provider: 'daraja',
    event_id: `platform-stk:${checkoutRequestId}:${resultCode}`,
    result: outcome,
    processed_at: outcome === 'platform_callback_received' ? null : new Date().toISOString(),
    provider_payload: {
      ...sanitizedPayload,
      retivox_diagnostic: {
        outcome,
        detail: detail?.slice(0, 500) ?? null,
      },
    },
  }, { onConflict: 'provider,event_id' })

  // Diagnostics should never prevent a verified callback from being settled.
  if (error) console.error('Unable to persist platform Daraja callback diagnostic', error.message)
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
    await persistCallbackDiagnostic(serviceClient, payload, checkoutRequestId, resultCode, 'platform_callback_received')
    const { data: payment, error: lookupError } = await serviceClient
      .from('subscription_payment_requests')
      .select('id, amount, payer_phone, status, payment_method, provider, provider_merchant_request_id')
      .eq('provider_checkout_request_id', checkoutRequestId)
      .order('submitted_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (lookupError) {
      throw lookupError
    }

    if (!payment) {
      await persistCallbackDiagnostic(serviceClient, payload, checkoutRequestId, resultCode, 'platform_payment_unmatched')
      return NextResponse.json({ ResultCode: 1, ResultDesc: 'Payment request not found' }, { status: 404 })
    }

    // Older STK requests did not persist provider='daraja' alongside their
    // checkout ID. Accept those pending requests while still rejecting other
    // tenders, then repair the marker so the settlement RPC can match them.
    if (payment.payment_method !== 'mpesa_stk' || (payment.provider && payment.provider !== 'daraja')) {
      await persistCallbackDiagnostic(serviceClient, payload, checkoutRequestId, resultCode, 'platform_payment_type_mismatch')
      return NextResponse.json({ ResultCode: 1, ResultDesc: 'Payment request is not a Daraja STK checkout' }, { status: 409 })
    }

    if (payment.status !== 'pending') {
      await persistCallbackDiagnostic(serviceClient, payload, checkoutRequestId, resultCode, 'platform_already_processed')
      return NextResponse.json({ ResultCode: 0, ResultDesc: 'Already processed' })
    }

    if (
      payment.provider_merchant_request_id &&
      payment.provider_merchant_request_id !== callback?.MerchantRequestID
    ) {
      await persistCallbackDiagnostic(serviceClient, payload, checkoutRequestId, resultCode, 'platform_merchant_request_mismatch')
      return NextResponse.json({ ResultCode: 1, ResultDesc: 'Merchant request mismatch' }, { status: 400 })
    }

    let verifiedResultCode: number
    try {
      verifiedResultCode = await verifyDarajaStkCheckout(checkoutRequestId)
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Unknown Daraja status-query error'
      await persistCallbackDiagnostic(serviceClient, payload, checkoutRequestId, resultCode, 'platform_status_query_error', detail)
      return NextResponse.json({ ResultCode: 1, ResultDesc: 'Payment verification temporarily unavailable' }, { status: 503 })
    }
    if (verifiedResultCode !== resultCode) {
      await persistCallbackDiagnostic(
        serviceClient,
        payload,
        checkoutRequestId,
        resultCode,
        'platform_result_code_mismatch',
        `Callback result ${resultCode}; Daraja status query result ${verifiedResultCode}.`,
      )
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
        await persistCallbackDiagnostic(serviceClient, payload, checkoutRequestId, resultCode, 'platform_invalid_payment_phone')
        return NextResponse.json({ ResultCode: 1, ResultDesc: 'Invalid payment phone' }, { status: 400 })
      }

      if (!receiptNumber || !Number.isFinite(paidAmount) || paidAmount !== Number(payment.amount) || normalizedPhone !== payment.payer_phone) {
        await persistCallbackDiagnostic(serviceClient, payload, checkoutRequestId, resultCode, 'platform_payment_details_mismatch')
        return NextResponse.json({ ResultCode: 1, ResultDesc: 'Payment details mismatch' }, { status: 400 })
      }
    }

    if (payment.provider !== 'daraja') {
      const { error: providerError } = await serviceClient
        .from('subscription_payment_requests')
        .update({ provider: 'daraja' })
        .eq('id', payment.id)
        .eq('status', 'pending')
      if (providerError) throw providerError
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
      await persistCallbackDiagnostic(serviceClient, payload, checkoutRequestId, resultCode, 'platform_settlement_rpc_error', error.message)
      throw error
    }
    if (processed !== true) {
      await persistCallbackDiagnostic(serviceClient, payload, checkoutRequestId, resultCode, 'platform_settlement_rejected')
      return NextResponse.json({ ResultCode: 1, ResultDesc: 'Payment could not be verified' }, { status: 409 })
    }

    await persistCallbackDiagnostic(serviceClient, payload, checkoutRequestId, resultCode, 'platform_settled')
    return NextResponse.json({ ResultCode: 0, ResultDesc: 'Accepted' })
  } catch (error) {
    console.error('Platform Daraja STK callback processing failed', error instanceof Error ? error.message : 'Unknown error')
    return NextResponse.json({ ResultCode: 1, ResultDesc: 'Payment verification temporarily unavailable' }, { status: 503 })
  }
}
