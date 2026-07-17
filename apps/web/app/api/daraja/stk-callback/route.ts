import { NextResponse } from 'next/server'
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
  let payload: DarajaCallbackPayload

  try {
    payload = (await request.json()) as DarajaCallbackPayload
  } catch {
    return NextResponse.json({ ResultCode: 1, ResultDesc: 'Invalid JSON payload' }, { status: 400 })
  }

  const callback = payload.Body?.stkCallback

  if (!callback?.CheckoutRequestID) {
    return NextResponse.json({ ResultCode: 1, ResultDesc: 'Missing CheckoutRequestID' }, { status: 400 })
  }

  try {
    const serviceClient = createServiceRoleClient()
    const { error } = await serviceClient.rpc('platform_record_daraja_payment_result', {
      p_checkout_request_id: callback.CheckoutRequestID,
      p_merchant_request_id: callback.MerchantRequestID ?? null,
      p_result_code: Number(callback.ResultCode ?? 1),
      p_result_description: callback.ResultDesc ?? 'No Daraja result description',
      p_raw_payload: sanitizeCallbackPayload(payload),
    })

    if (error) {
      throw error
    }

    const receiptNumber = getMetadataValue(payload, 'MpesaReceiptNumber')
    const paidAmount = getMetadataValue(payload, 'Amount')
    const phoneNumber = getMetadataValue(payload, 'PhoneNumber')

    if (Number(callback.ResultCode ?? 1) === 0) {
      await serviceClient
        .from('subscription_payment_requests')
        .update({
          provider_receipt_number: receiptNumber ? String(receiptNumber) : null,
          provider_paid_amount: paidAmount ? Number(paidAmount) : null,
          provider_phone_number: phoneNumber ? String(phoneNumber) : null,
        })
        .eq('provider_checkout_request_id', callback.CheckoutRequestID)
    }

    return NextResponse.json({ ResultCode: 0, ResultDesc: 'Accepted' })
  } catch {
    return NextResponse.json({ ResultCode: 0, ResultDesc: 'Accepted' })
  }
}
