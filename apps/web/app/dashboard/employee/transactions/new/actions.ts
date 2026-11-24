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
import { normalizeKenyanPhoneNumber } from '../../../../../lib/payments/daraja'
import { getBusinessDarajaSetup, startBusinessDarajaCheckout } from '../../../../../lib/payments/businessDaraja'
import { createClient } from '../../../../../lib/supabase/server'
import { getBusinessPesapalSetup, startBusinessPesapalCheckout } from '../../../../../lib/payments/pesapal'
import { requestOrigin } from '../../../../../lib/requestOrigin'
import { headers } from 'next/headers'

/**
 * Form state returned by the employee transaction form.
 */
export type EmployeeTransactionFormState = {
  success: boolean
  error: string | null
  message?: string
  transactionId?: string
  paymentId?: string
  checkoutUrl?: string
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
  replayed?: boolean
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

const splitPaymentSchema = z.object({
  paymentMethod: z.enum(['cash','mpesa_manual','mpesa_stk','pesapal']),
  amount: z.coerce.number().positive(),
  amountTendered: z.coerce.number().positive().optional(),
  referenceCode: z.string().trim().max(80).optional(),
})

/**
 * Validates the employee transaction form payload.
 */
const transactionSchema = z
  .object({
    items: z.array(lineItemSchema).min(1).max(50),
    paymentMethod: z.enum(['mpesa_manual', 'mpesa_stk', 'pesapal', 'cash', 'card', 'bank_transfer', 'other']),
    amountPaid: z.coerce.number().min(0),
    amountTendered: z.coerce.number().min(0).optional(),
    isCredit: z.enum(['true', 'false']).transform((value) => value === 'true'),
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
    customerEmail: z.string().trim().email().max(254).optional().or(z.literal('')),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    mpesaRefCode: z.string().trim().max(80).optional(),
    manualPaymentMethodId: z.string().uuid().optional(),
    manualPaymentMethodVersion: z.coerce.number().int().positive().optional(),
    paymentPhone: z.string().trim().max(40).optional().transform((value, context) => {
      if (!value) return undefined
      try { return normalizeKenyanPhoneNumber(value) } catch {
        context.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a valid Kenyan mobile phone number for the M-Pesa prompt' })
        return z.NEVER
      }
    }),
    splitPayments: z.array(splitPaymentSchema).max(8).optional(),
  })
  .superRefine((value, context) => {
    if (value.splitPayments === undefined && value.paymentMethod === 'mpesa_manual' && (!value.mpesaRefCode || value.mpesaRefCode.length < 5)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['mpesaRefCode'],
        message: 'Enter a valid M-Pesa reference code',
      })
    }
    value.splitPayments?.forEach((payment, index) => {
      if (payment.paymentMethod === 'mpesa_manual' && (payment.referenceCode?.length ?? 0) < 5) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ['splitPayments', index, 'referenceCode'], message: 'Each mobile manual payment needs a valid reference' })
      }
      if (payment.paymentMethod === 'cash' && payment.amountTendered !== undefined && payment.amountTendered < payment.amount) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ['splitPayments', index, 'amountTendered'], message: 'Cash received must cover its payment amount' })
      }
    })
    const onlineSplitMethods = value.splitPayments?.filter((payment) => payment.paymentMethod === 'mpesa_stk' || payment.paymentMethod === 'pesapal') ?? []
    if (onlineSplitMethods.length > 1) context.addIssue({ code: z.ZodIssueCode.custom, path: ['splitPayments'], message: 'Use at most one online provider checkout in a split sale.' })
    if (onlineSplitMethods.some((payment) => payment.paymentMethod === 'mpesa_stk') && !value.paymentPhone) context.addIssue({ code: z.ZodIssueCode.custom, path: ['paymentPhone'], message: 'Enter the customer phone number for the M-Pesa prompt.' })
    if (onlineSplitMethods.some((payment) => payment.paymentMethod === 'pesapal') && !value.customerPhone && !value.customerEmail) context.addIssue({ code: z.ZodIssueCode.custom, path: ['customerPhone'], message: 'Pesapal checkout needs a customer phone number or email address.' })
    if (value.isCredit && (!value.customerName || !value.customerPhone || !value.dueDate)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['dueDate'], message: 'Credit sales need customer name, phone number, and a due date' })
    if (!value.splitPayments && value.paymentMethod === 'mpesa_stk' && (!value.paymentPhone || (value.isCredit && value.amountPaid <= 0))) context.addIssue({ code: z.ZodIssueCode.custom, path: ['paymentPhone'], message: value.isCredit && value.amountPaid <= 0 ? 'Enter the amount being paid now to send an M-Pesa prompt' : 'Enter the customer phone number for the M-Pesa prompt' })
    if (!value.splitPayments && value.paymentMethod === 'pesapal' && (!value.customerPhone && !value.customerEmail || (value.isCredit && value.amountPaid <= 0))) context.addIssue({ code: z.ZodIssueCode.custom, path: ['customerPhone'], message: value.isCredit && value.amountPaid <= 0 ? 'Enter an amount paid now before starting Pesapal checkout' : 'Pesapal checkout needs a customer phone number or email address' })
    if (!value.isCredit && value.amountTendered !== undefined && value.amountTendered < value.amountPaid) context.addIssue({ code: z.ZodIssueCode.custom, path: ['amountTendered'], message: 'Cash received must cover the sale total' })
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

function parseSplitPaymentsJson(value: string) {
  if (!value) return undefined
  const parsed: unknown = JSON.parse(value)
  if (!Array.isArray(parsed)) throw new Error('Payment split details are invalid')
  return parsed.map((entry) => {
    if (!entry || typeof entry !== 'object') throw new Error('Payment split details are invalid')
    const row = entry as Record<string, unknown>
    return {
      paymentMethod: String(row.paymentMethod),
      amount: Number(row.amount),
      amountTendered: row.amountTendered === '' || row.amountTendered == null ? undefined : Number(row.amountTendered),
      referenceCode: typeof row.referenceCode === 'string' ? row.referenceCode : undefined,
    }
  })
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
  const requestId = z.string().uuid().safeParse(getString(formData, 'idempotencyKey'))

  if (!employeeProfile || !employeeProfile.isActive || !employeeProfile.branchId) {
    logger.warn('recordEmployeeTransaction: employee scope missing', {
      userId: user.id,
      hasProfile: Boolean(employeeProfile),
      branchId: employeeProfile?.branchId ?? null,
    })
    return { success: false, error: 'Your employee branch assignment is not active' }
  }
  if (!requestId.success) return { success: false, error: 'This sale form has expired. Refresh it and try again.' }

  let items: SubmittedLineItem[]
  let splitPayments: ReturnType<typeof parseSplitPaymentsJson>

  try {
    items = parseItemsJson(getString(formData, 'itemsJson'))
    splitPayments = parseSplitPaymentsJson(getString(formData, 'splitPaymentsJson'))
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
    manualPaymentMethodId: getString(formData, 'manualPaymentMethodId') || undefined,
    manualPaymentMethodVersion: getString(formData, 'manualPaymentMethodVersion') || undefined,
    paymentPhone: getString(formData, 'paymentPhone') || undefined,
    splitPayments,
    customerEmail: getString(formData, 'customerEmail') || undefined,
    amountPaid: getString(formData, 'amountPaid') || '0',
    amountTendered: getString(formData, 'amountTendered') || undefined,
    isCredit: getString(formData, 'isCredit') || 'false',
    dueDate: getString(formData, 'dueDate') || undefined,
  })

  if (!validation.success) {
    return {
      success: false,
      error: validation.error.errors[0]?.message ?? 'Invalid transaction details',
    }
  }

  if (!validation.data.splitPayments && !['cash', 'mpesa_manual', 'mpesa_stk', 'pesapal'].includes(validation.data.paymentMethod)) {
    return { success: false, error: 'This payment method is not available until its online checkout and payment confirmation are configured.' }
  }

  try {
    const supabase = await createClient()
    const splitProviderPayment = validation.data.splitPayments?.find((payment) => payment.paymentMethod === 'mpesa_stk' || payment.paymentMethod === 'pesapal')
    const splitProviderReference = splitProviderPayment
      ? `${splitProviderPayment.paymentMethod === 'mpesa_stk' ? 'STK-PENDING' : 'PESAPAL-PENDING'}:${requestId.data}`
      : null
    const onlineMethods = new Set([
      ...(validation.data.splitPayments ?? []).map((payment) => payment.paymentMethod),
      ...(validation.data.splitPayments ? [] : [validation.data.paymentMethod]),
    ].filter((method): method is 'mpesa_stk' | 'pesapal' => method === 'mpesa_stk' || method === 'pesapal'))
    for (const method of onlineMethods) {
      const { data: enabled, error: entitlementError } = await supabase.rpc('business_payment_method_enabled', { p_business_id: employeeProfile.businessId, p_method: method })
      if (entitlementError || enabled !== true) return { success: false, error: entitlementError?.message ?? `This subscription plan does not include ${method === 'mpesa_stk' ? 'Daraja M-Pesa prompts' : 'Pesapal hosted checkout'}. Contact the business owner to update plan entitlements.` }
    }
    const needsDaraja = validation.data.paymentMethod === 'mpesa_stk' && !validation.data.splitPayments
      || splitProviderPayment?.paymentMethod === 'mpesa_stk'
    const needsPesapal = validation.data.paymentMethod === 'pesapal' && !validation.data.splitPayments
      || splitProviderPayment?.paymentMethod === 'pesapal'
    const darajaSetup = needsDaraja
      ? await getBusinessDarajaSetup(employeeProfile.businessId)
      : undefined
    const pesapalSetup = needsPesapal
      ? await getBusinessPesapalSetup(employeeProfile.businessId)
      : undefined
    if (needsPesapal && !pesapalSetup?.config.ipnId) {
      return { success: false, error: 'The owner needs to configure Pesapal and register its IPN before checkout can be used.' }
    }
    const response = await supabase.rpc('employee_record_transaction_with_payment_method_v1', {
      p_request_id: requestId.data,
      p_items: validation.data.items.map((item) => ({
        productId: item.productId,
        uomId: item.uomId,
        quantity: item.quantity,
        recoveryItemId: item.recoveryItemId ?? null,
      })),
      p_payment_method: ['mpesa_stk', 'pesapal'].includes(validation.data.paymentMethod) ? 'mpesa_manual' : validation.data.paymentMethod,
      p_amount_paid: validation.data.isCredit ? validation.data.amountPaid : null,
      p_amount_tendered: validation.data.paymentMethod === 'cash' ? validation.data.amountTendered ?? validation.data.amountPaid : null,
      p_discount_amount: validation.data.discountAmount,
      p_customer_name: validation.data.customerName ?? null,
      p_customer_phone: validation.data.customerPhone ?? null,
      p_customer_email: validation.data.customerEmail || null,
      p_reference_code: validation.data.paymentMethod === 'mpesa_stk' ? `STK-PENDING:${requestId.data}` : validation.data.paymentMethod === 'pesapal' ? `PESAPAL-PENDING:${requestId.data}` : validation.data.mpesaRefCode ?? null,
      p_due_date: validation.data.dueDate || null,
      p_is_credit: validation.data.isCredit,
      p_manual_payment_method_id: (
        (!validation.data.splitPayments && validation.data.paymentMethod === 'mpesa_manual') ||
        validation.data.splitPayments?.some((payment) => payment.paymentMethod === 'mpesa_manual')
      ) ? validation.data.manualPaymentMethodId ?? null : null,
      p_manual_payment_method_version: (
        (!validation.data.splitPayments && validation.data.paymentMethod === 'mpesa_manual') ||
        validation.data.splitPayments?.some((payment) => payment.paymentMethod === 'mpesa_manual')
      ) ? validation.data.manualPaymentMethodVersion ?? null : null,
      p_split_payments: validation.data.splitPayments?.map((payment) => ({
        paymentMethod: payment.paymentMethod === 'mpesa_stk' || payment.paymentMethod === 'pesapal' ? 'mpesa_manual' : payment.paymentMethod,
        amount: payment.amount,
        amountTendered: payment.paymentMethod === 'cash' ? payment.amountTendered ?? payment.amount : payment.amount,
        referenceCode: payment === splitProviderPayment ? splitProviderReference : payment.referenceCode ?? null,
      })) ?? null,
    })

    if (response.error) {
      if (response.error.message.includes('Insufficient stock')) {
        revalidatePath('/dashboard/employee/transactions/new')
      }
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

    if (result?.replayed) {
      revalidatePath('/dashboard/employee/transactions')
      revalidatePath('/dashboard/employee')
      return { success: true, error: null, message: 'This sale was already recorded. No duplicate sale or payment was created.', transactionId: result.transaction_id }
    }

    let successMessage = 'Transaction recorded successfully'
    let checkoutUrl: string | undefined
    let initiatedPaymentId: string | undefined
    if (splitProviderPayment && result?.transaction_id && splitProviderReference) {
      const { data: payment, error: paymentError } = await supabase.from('payments').select('id')
        .eq('business_id', employeeProfile.businessId).eq('transaction_id', result.transaction_id).eq('mpesa_ref_code', splitProviderReference).maybeSingle()
      if (paymentError || !payment) {
        successMessage = 'Sale saved, but its online payment could not be linked. Do not record it again; contact the owner to review the pending payment.'
      } else if (splitProviderPayment.paymentMethod === 'mpesa_stk' && darajaSetup && validation.data.paymentPhone) {
        try {
          initiatedPaymentId = payment.id
          await startBusinessDarajaCheckout({ businessId: employeeProfile.businessId, paymentId: payment.id, phone: validation.data.paymentPhone, setup: darajaSetup })
          successMessage = 'Sale recorded. An M-Pesa prompt was sent for the split amount; the payment will be confirmed automatically.'
        } catch (checkoutError) {
          logger.error('recordEmployeeTransaction: split Daraja checkout failed', { userId: employeeProfile.id, businessId: employeeProfile.businessId, transactionId: result.transaction_id, error: checkoutError })
          successMessage = 'Sale saved with a pending M-Pesa split payment, but the prompt was not confirmed. Review it before retrying.'
        }
      } else if (splitProviderPayment.paymentMethod === 'pesapal' && pesapalSetup) {
        try {
          const started = await startBusinessPesapalCheckout({ businessId: employeeProfile.businessId, paymentId: payment.id,
            phone: validation.data.customerPhone, email: validation.data.customerEmail || undefined,
            origin: requestOrigin(await headers()), returnPath: '/dashboard/employee/transactions' })
          checkoutUrl = started.redirectUrl
          successMessage = 'Sale recorded. Opening Pesapal checkout for the split amount.'
        } catch (checkoutError) {
          logger.error('recordEmployeeTransaction: split Pesapal checkout failed', { userId: employeeProfile.id, businessId: employeeProfile.businessId, transactionId: result.transaction_id, error: checkoutError })
          successMessage = 'Sale saved with a pending Pesapal split payment, but checkout was not confirmed. Review it before retrying.'
        }
      }
    }
    if (!validation.data.splitPayments && validation.data.paymentMethod === 'mpesa_stk' && result?.transaction_id && validation.data.paymentPhone) {
      const { data: payment, error: paymentError } = await supabase.from('payments').select('id').eq('business_id', employeeProfile.businessId).eq('transaction_id', result.transaction_id).order('payment_at', { ascending: true }).limit(1).maybeSingle()
      if (paymentError || !payment) {
        successMessage = 'Sale saved, but its M-Pesa prompt could not be started. Do not record it again; contact the owner to review this pending payment.'
      } else {
        try {
          initiatedPaymentId = payment.id
          await startBusinessDarajaCheckout({ businessId: employeeProfile.businessId, paymentId: payment.id, phone: validation.data.paymentPhone, setup: darajaSetup })
          successMessage = 'Sale recorded. An M-Pesa prompt was sent; the payment will be confirmed automatically after Safaricom verifies it.'
        } catch (checkoutError) {
          logger.error('recordEmployeeTransaction: Daraja checkout start failed', { userId: employeeProfile.id, businessId: employeeProfile.businessId, transactionId: result.transaction_id, error: checkoutError })
          successMessage = 'Sale saved as pending payment, but the prompt result is not confirmed. Do not record this sale again; review its payment status before any retry.'
        }
      }
    }

    if (!validation.data.splitPayments && validation.data.paymentMethod === 'pesapal' && result?.transaction_id && pesapalSetup) {
      const { data: payment, error: paymentError } = await supabase.from('payments').select('id')
        .eq('business_id', employeeProfile.businessId).eq('transaction_id', result.transaction_id)
        .order('payment_at', { ascending: true }).limit(1).maybeSingle()
      if (paymentError || !payment) {
        successMessage = 'Sale saved, but the Pesapal checkout could not be linked. Do not record it again; contact the owner to review the pending payment.'
      } else {
        try {
          const started = await startBusinessPesapalCheckout({
            businessId: employeeProfile.businessId, paymentId: payment.id,
            phone: validation.data.customerPhone, email: validation.data.customerEmail || undefined,
            origin: requestOrigin(await headers()), returnPath: '/dashboard/employee/transactions',
          })
          checkoutUrl = started.redirectUrl
          successMessage = 'Sale recorded. Opening Pesapal secure checkout.'
        } catch (checkoutError) {
          logger.error('recordEmployeeTransaction: Pesapal checkout start failed', { userId: employeeProfile.id, businessId: employeeProfile.businessId, transactionId: result.transaction_id, error: checkoutError })
          successMessage = 'Sale saved as pending payment, but Pesapal did not confirm checkout startup. Do not record the sale again; review its payment status.'
        }
      }
    }

    revalidatePath('/dashboard/employee')
    revalidatePath('/dashboard/employee/transactions')
    revalidatePath('/dashboard/owner')
    revalidatePath('/dashboard/owner/finances')
    revalidatePath('/dashboard/owner/receivables')

    logger.info('Employee transaction recorded', {
      userId: employeeProfile.id,
      businessId: employeeProfile.businessId,
      branchId: employeeProfile.branchId,
      transactionId: result?.transaction_id ?? null,
    })

    return {
      success: true,
      error: null,
      message: successMessage,
      transactionId: result?.transaction_id,
      paymentId: initiatedPaymentId,
      checkoutUrl,
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
