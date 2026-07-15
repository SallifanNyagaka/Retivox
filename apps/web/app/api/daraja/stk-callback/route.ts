import { NextResponse } from 'next/server'
import { createServiceRoleClient } from '../../../../lib/supabase/admin'

type DarajaCallbackPayload = {
  Body?: {
    stkCallback?: {
      MerchantRequestID?: string
      CheckoutRequestID?: string
      ResultCode?: number
      ResultDesc?: string
      CallbackMetadata?: unknown
    }
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
      p_raw_payload: payload,
    })

    if (error) {
      throw error
    }

    return NextResponse.json({ ResultCode: 0, ResultDesc: 'Accepted' })
  } catch (error: unknown) {
    return NextResponse.json(
      {
        ResultCode: 1,
        ResultDesc: error instanceof Error ? error.message : 'Unable to process callback',
      },
      { status: 500 }
    )
  }
}
