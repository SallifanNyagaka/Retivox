'use server'
/**
 * Server actions for employee web transaction recording.
 *
 * These actions authenticate first, derive the employee branch server-side, and
 * delegate sale creation to the atomic employee_record_transaction RPC.
 */

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAuth } from '../../../../../lib/auth/helpers'
import { getEmployeeProfile } from '../../../../../lib/employee/auth'
import logger from '../../../../../lib/logger'
import { createClient } from '../../../../../lib/supabase/server'

/**
 * Form state returned by the employee transaction form.
 */
export type EmployeeTransactionFormState = {
  success: boolean
  error: string | null
  message?: string
  transactionId?: string
}

/**
 * Valid line item submitted by the client.
 */
type SubmittedLineItem = {
  productId: string
  uomId: string
  quantity: number
  recoveryItemId: string | null
}

/**
 * RPC response row returned after recording a transaction.
 */
type EmployeeRecordTransactionRow = {
  transaction_id: string
  status: string
  recorded_at: string
  total_amount: number
}

/**
 * Validates submitted transaction line items.
 */
const lineItemSchema = z.object({
  productId: z.string().uuid(),
  uomId: z.string().uuid(),
  quantity: z.coerce.number().positive().max(10000),
  recoveryItemId: z.string().uuid().nullable().optional(),
})

/**
 * Validates the employee transaction form payload.
 */
const transactionSchema = z
  .object({
    items: z.array(lineItemSchema).min(1).max(50),
    paymentMethod: z.enum(['mpesa_manual', 'cash']),
    discountAmount: z.coerce.number().min(0).default(0),
    customerName: z.string().trim().max(120).optional(),
    customerPhone: z.string().trim().max(40).optional(),
    mpesaRefCode: z.string().trim().max(80).optional(),
    cashDepositCode: z.string().trim().max(80).optional(),
  })
  .superRefine((value, context) => {
    if (value.paymentMethod === 'mpesa_manual' && (!value.mpesaRefCode || value.mpesaRefCode.length < 5)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['mpesaRefCode'],
        message: 'Enter a valid M-Pesa reference code',
      })
    }

    if (value.paymentMethod === 'cash' && (!value.cashDepositCode || value.cashDepositCode.length < 3)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['cashDepositCode'],
        message: 'Enter a valid cash deposit/reference code',
      })
    }
  })

/**
 * Safely reads a trimmed string from FormData.
 */
function getString(formData: FormData, key: string): string {
  const value = formData.get(key)
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Parses the JSON line item payload from FormData.
 */
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

/**
 * Converts database sale validation errors into employee-friendly messages.
 */
function getRecordTransactionErrorMessage(message: string | undefined) {
  if (!message) {
    return 'Unable to record transaction'
  }

  if (message.includes('Discount exceeds the maximum allowed')) {
    const maxMatch = message.match(/Maximum allowed:\s*([0-9]+(?:\.[0-9]+)?)/i)

    if (maxMatch?.[1]) {
      return `The discount is higher than the owner-approved limit for these items. Maximum allowed: ${maxMatch[1]}`
    }

    return 'The discount is higher than the owner-approved limit for these items'
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

/**
 * Records an employee transaction through the atomic database RPC.
 */
export async function recordEmployeeTransaction(
  _prevState: EmployeeTransactionFormState,
  formData: FormData
): Promise<EmployeeTransactionFormState> {
  const user = await requireAuth()
  const employeeProfile = await getEmployeeProfile(user.id)

  if (!employeeProfile || !employeeProfile.isActive || !employeeProfile.branchId) {
    logger.warn('recordEmployeeTransaction: employee scope missing', {
      userId: user.id,
      hasProfile: Boolean(employeeProfile),
      branchId: employeeProfile?.branchId ?? null,
    })
    return { success: false, error: 'Your employee branch assignment is not active' }
  }

  let items: SubmittedLineItem[]

  try {
    items = parseItemsJson(getString(formData, 'itemsJson'))
  } catch (error: unknown) {
    logger.warn('recordEmployeeTransaction: invalid items JSON', { userId: user.id, error })
    return { success: false, error: 'Add at least one valid product' }
  }

  const validation = transactionSchema.safeParse({
    items,
    paymentMethod: getString(formData, 'paymentMethod'),
    discountAmount: getString(formData, 'discountAmount') || '0',
    customerName: getString(formData, 'customerName') || undefined,
    customerPhone: getString(formData, 'customerPhone') || undefined,
    mpesaRefCode: getString(formData, 'mpesaRefCode') || undefined,
    cashDepositCode: getString(formData, 'cashDepositCode') || undefined,
  })

  if (!validation.success) {
    return {
      success: false,
      error: validation.error.errors[0]?.message ?? 'Invalid transaction details',
    }
  }

  try {
    const supabase = await createClient()
    const response = await supabase.rpc('employee_record_transaction', {
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
      p_cash_deposit_code: validation.data.cashDepositCode ?? null,
    })

    if (response.error) {
      logger.error('recordEmployeeTransaction: rpc failed', {
        userId: employeeProfile.id,
        businessId: employeeProfile.businessId,
        branchId: employeeProfile.branchId,
        error: response.error,
      })
      return { success: false, error: getRecordTransactionErrorMessage(response.error.message) }
    }

    const result = Array.isArray(response.data)
      ? ((response.data[0] ?? null) as EmployeeRecordTransactionRow | null)
      : ((response.data ?? null) as EmployeeRecordTransactionRow | null)

    revalidatePath('/dashboard/employee')
    revalidatePath('/dashboard/employee/transactions')

    logger.info('Employee transaction recorded', {
      userId: employeeProfile.id,
      businessId: employeeProfile.businessId,
      branchId: employeeProfile.branchId,
      transactionId: result?.transaction_id ?? null,
    })

    return {
      success: true,
      error: null,
      message: 'Transaction recorded successfully',
      transactionId: result?.transaction_id,
    }
  } catch (error: unknown) {
    logger.error('recordEmployeeTransaction: unexpected error', {
      userId: employeeProfile.id,
      businessId: employeeProfile.businessId,
      branchId: employeeProfile.branchId,
      error,
    })
    return { success: false, error: error instanceof Error ? error.message : 'Server error' }
  }
}
