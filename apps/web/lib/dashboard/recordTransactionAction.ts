'use server'
/**
 * Server actions for owner/admin dashboard transaction recording.
 */

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { GlobalRole } from '@smartretail/shared'
import { requireRole } from '../auth/helpers'
import { assertBranchAccess } from '../auth/branchAccess'
import logger from '../logger'
import { normalizeKenyanPhoneNumber } from '../payments/daraja'
import { createClient } from '../supabase/server'

export type DashboardTransactionFormState = {
  success: boolean
  error: string | null
  message?: string
  transactionId?: string
}

type SubmittedLineItem = {
  productId: string
  uomId: string
  quantity: number
  recoveryItemId: string | null
}

type DashboardRecordTransactionRow = {
  transaction_id: string
  status: string
  recorded_at: string
  total_amount: number
}

const DEFERRED_CASH_DEPOSIT_CODE = 'PENDING_CASH_RECONCILIATION'

const lineItemSchema = z.object({
  productId: z.string().uuid(),
  uomId: z.string().uuid(),
  quantity: z.coerce.number().positive().max(10000),
  recoveryItemId: z.string().uuid().nullable().optional(),
})

const transactionSchema = z
  .object({
    branchId: z.string().uuid(),
    items: z.array(lineItemSchema).min(1).max(50),
    paymentMethod: z.enum(['mpesa_manual', 'cash']),
    discountAmount: z.coerce.number().min(0).default(0),
    customerName: z.string().trim().max(120).optional(),
    customerPhone: z.string().trim().max(40).optional().transform((value, context) => {
      if (!value) {
        return undefined
      }

      try {
        return normalizeKenyanPhoneNumber(value)
      } catch {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Enter a valid Kenyan mobile phone number',
        })
        return z.NEVER
      }
    }),
    mpesaRefCode: z.string().trim().max(80).optional(),
  })
  .superRefine((value, context) => {
    if (value.paymentMethod === 'mpesa_manual' && (!value.mpesaRefCode || value.mpesaRefCode.length < 5)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['mpesaRefCode'],
        message: 'Enter a valid M-Pesa reference code',
      })
    }

  })

function getString(formData: FormData, key: string): string {
  const value = formData.get(key)
  return typeof value === 'string' ? value.trim() : ''
}

function parseItemsJson(itemsJson: string): SubmittedLineItem[] {
  const parsed: unknown = JSON.parse(itemsJson)

  if (!Array.isArray(parsed)) {
    return []
  }

  return parsed
    .map((item) => {
      if (typeof item !== 'object' || item === null || !('productId' in item) || !('uomId' in item) || !('quantity' in item)) {
        return null
      }

      return {
        productId: String(item.productId),
        uomId: String(item.uomId),
        quantity: Number(item.quantity),
        recoveryItemId: 'recoveryItemId' in item && item.recoveryItemId ? String(item.recoveryItemId) : null,
      }
    })
    .filter((item): item is SubmittedLineItem => item !== null)
}

function getRecordTransactionErrorMessage(message: string | undefined) {
  if (!message) {
    return 'Unable to record transaction'
  }

  if (message.includes('Discount exceeds the maximum allowed')) {
    const maxMatch = message.match(/Maximum allowed:\s*([0-9]+(?:\.[0-9]+)?)/i)
    return maxMatch?.[1]
      ? `The discount is higher than the owner-approved limit for these items. Maximum allowed: ${maxMatch[1]}`
      : 'The discount is higher than the owner-approved limit for these items'
  }

  if (message.includes('Insufficient stock')) {
    return message.replace('Available base quantity', 'Available stock')
  }

  if (message.includes('does not have an approved price') || message.includes('Unable to resolve an approved price')) {
    return 'One selected product or quantity does not have an approved selling price'
  }

  if (message.includes('Selected unit is not available for sales')) {
    return 'One selected unit is not available for selling this product'
  }

  return message
}

async function recordDashboardTransactionForRole(
  formData: FormData,
  role: GlobalRole.Owner | GlobalRole.Admin
): Promise<DashboardTransactionFormState> {
  const profile = await requireRole([role])
  const businessId = profile.business_id

  if (!businessId) {
    return { success: false, error: 'Business context missing' }
  }

  let items: SubmittedLineItem[]

  try {
    items = parseItemsJson(getString(formData, 'itemsJson'))
  } catch (error: unknown) {
    logger.warn('recordDashboardTransactionForRole: invalid items JSON', { userId: profile.id, role, error })
    return { success: false, error: 'Add at least one valid product' }
  }

  const validation = transactionSchema.safeParse({
    branchId: getString(formData, 'branchId'),
    items,
    paymentMethod: getString(formData, 'paymentMethod'),
    discountAmount: getString(formData, 'discountAmount') || '0',
    customerName: getString(formData, 'customerName') || undefined,
    customerPhone: getString(formData, 'customerPhone') || undefined,
    mpesaRefCode: getString(formData, 'mpesaRefCode') || undefined,
  })

  if (!validation.success) {
    return {
      success: false,
      error: validation.error.errors[0]?.message ?? 'Invalid transaction details',
    }
  }

  try {
    await assertBranchAccess(profile.id, validation.data.branchId, role === GlobalRole.Owner ? 'owner' : 'admin', 'record_transaction')

    const supabase = await createClient()
    const response = await supabase.rpc('dashboard_record_transaction', {
      p_branch_id: validation.data.branchId,
      p_items: validation.data.items.map((item) => ({
        productId: item.productId,
        uomId: item.uomId,
        quantity: item.quantity,
        recoveryItemId: item.recoveryItemId ?? null,
      })),
      p_payment_method: validation.data.paymentMethod,
      p_discount_amount: validation.data.discountAmount,
      p_customer_name: validation.data.customerName ?? null,
      p_customer_phone: validation.data.customerPhone ?? null,
      p_mpesa_ref_code: validation.data.mpesaRefCode ?? null,
      p_cash_deposit_code: validation.data.paymentMethod === 'cash' ? DEFERRED_CASH_DEPOSIT_CODE : null,
    })

    if (response.error) {
      logger.error('recordDashboardTransactionForRole: rpc failed', {
        userId: profile.id,
        businessId,
        branchId: validation.data.branchId,
        role,
        error: response.error,
      })
      return { success: false, error: getRecordTransactionErrorMessage(response.error.message) }
    }

    const result = Array.isArray(response.data)
      ? ((response.data[0] ?? null) as DashboardRecordTransactionRow | null)
      : ((response.data ?? null) as DashboardRecordTransactionRow | null)

    if (validation.data.paymentMethod === 'cash' && result?.transaction_id) {
      const clearDeferredCashCodeResponse = await supabase
        .from('payments')
        .update({ cash_deposit_code: null })
        .eq('business_id', businessId)
        .eq('transaction_id', result.transaction_id)
        .eq('payment_method', 'cash')

      if (clearDeferredCashCodeResponse.error) {
        logger.warn('recordDashboardTransactionForRole: unable to clear deferred cash code', {
          userId: profile.id,
          businessId,
          branchId: validation.data.branchId,
          role,
          transactionId: result.transaction_id,
          error: clearDeferredCashCodeResponse.error,
        })
      }
    }

    revalidatePath('/dashboard/owner')
    revalidatePath('/dashboard/owner/transactions')
    revalidatePath('/dashboard/admin')
    revalidatePath('/dashboard/admin/transactions')

    logger.info('Dashboard transaction recorded', {
      userId: profile.id,
      businessId,
      branchId: validation.data.branchId,
      role,
      transactionId: result?.transaction_id ?? null,
      status: result?.status ?? null,
    })

    return {
      success: true,
      error: null,
      message: result?.status === 'verified'
        ? 'Transaction recorded and verified successfully'
        : 'Transaction recorded and sent to owner for verification',
      transactionId: result?.transaction_id,
    }
  } catch (error: unknown) {
    logger.error('recordDashboardTransactionForRole: unexpected error', {
      userId: profile.id,
      businessId,
      role,
      error,
    })
    return { success: false, error: error instanceof Error ? error.message : 'Server error' }
  }
}

export async function recordOwnerTransaction(
  _prevState: DashboardTransactionFormState,
  formData: FormData
): Promise<DashboardTransactionFormState> {
  return recordDashboardTransactionForRole(formData, GlobalRole.Owner)
}

export async function recordAdminTransaction(
  _prevState: DashboardTransactionFormState,
  formData: FormData
): Promise<DashboardTransactionFormState> {
  return recordDashboardTransactionForRole(formData, GlobalRole.Admin)
}
