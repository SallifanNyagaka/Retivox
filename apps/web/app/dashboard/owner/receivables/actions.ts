'use server'

import { revalidatePath } from 'next/cache'
import { GlobalRole } from '@smartretail/shared'
import { requireRole } from '../../../../lib/auth/helpers'
import { createClient } from '../../../../lib/supabase/server'

export type ReceivablePaymentState = { success: boolean; error: string | null; message?: string }

export async function recordReceivablePayment(
  _previous: ReceivablePaymentState,
  formData: FormData,
): Promise<ReceivablePaymentState> {
  const profile = await requireRole([GlobalRole.Owner])
  const receivableId = String(formData.get('receivableId') ?? '')
  const requestId = String(formData.get('requestId') ?? '')
  const method = String(formData.get('paymentMethod') ?? '')
  const amount = Number(formData.get('amount') ?? 0)
  const tendered = Number(formData.get('amountTendered') || amount)
  const reference = String(formData.get('referenceCode') ?? '').trim()
  if (!receivableId || !requestId || !Number.isFinite(amount) || amount <= 0) return { success: false, error: 'Enter a valid payment amount.' }
  if (method === 'cash' && tendered < amount) return { success: false, error: 'Cash received must cover the amount applied.' }
  if (method === 'mpesa_manual' && reference.length < 5) return { success: false, error: 'Enter a valid M-Pesa reference code.' }
  const supabase = await createClient()
  const response = await supabase.rpc('record_receivable_payment_v2', {
    p_receivable_id: receivableId,
    p_payment_method: method,
    p_amount: amount,
    p_amount_tendered: method === 'cash' ? tendered : amount,
    p_reference_code: reference || null,
    p_local_id: requestId,
  })
  if (response.error) return { success: false, error: response.error.message }
  revalidatePath('/dashboard/owner')
  revalidatePath('/dashboard/owner/finances')
  revalidatePath('/dashboard/owner/receivables')
  return { success: true, error: null, message: 'Payment recorded and account balance updated.' }
}
