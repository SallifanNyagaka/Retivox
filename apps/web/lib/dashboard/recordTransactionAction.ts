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
import { getBusinessDarajaSetup, startBusinessDarajaCheckout } from '../payments/businessDaraja'
import { getBusinessPesapalSetup, startBusinessPesapalCheckout } from '../payments/pesapal'
import { requestOrigin } from '../requestOrigin'
import { headers } from 'next/headers'

export type DashboardTransactionFormState = {
  success: boolean
  error: string | null
  message?: string
  transactionId?: string
  paymentId?: string
  checkoutUrl?: string
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
  replayed?: boolean
}

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

const transactionSchema = z
  .object({
    branchId: z.string().uuid(),
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
    if (!value.splitPayments && value.paymentMethod === 'mpesa_manual' && (!value.mpesaRefCode || value.mpesaRefCode.length < 5)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['mpesaRefCode'],
        message: 'Enter a valid M-Pesa reference code',
      })
    }
    value.splitPayments?.forEach((payment, index) => {
      if (payment.paymentMethod === 'mpesa_manual' && (payment.referenceCode?.length ?? 0) < 5) context.addIssue({ code: z.ZodIssueCode.custom, path: ['splitPayments', index, 'referenceCode'], message: 'Each mobile manual payment needs a valid reference' })
      if (payment.paymentMethod === 'cash' && payment.amountTendered !== undefined && payment.amountTendered < payment.amount) context.addIssue({ code: z.ZodIssueCode.custom, path: ['splitPayments', index, 'amountTendered'], message: 'Cash received must cover its payment amount' })
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
  const requestId = z.string().uuid().safeParse(getString(formData, 'idempotencyKey'))

  if (!businessId) {
    return { success: false, error: 'Business context missing' }
  }
  if (!requestId.success) return { success: false, error: 'This sale form has expired. Refresh it and try again.' }

  let items: SubmittedLineItem[]
  let splitPayments: ReturnType<typeof parseSplitPaymentsJson>

  try {
    items = parseItemsJson(getString(formData, 'itemsJson'))
    splitPayments = parseSplitPaymentsJson(getString(formData, 'splitPaymentsJson'))
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
    await assertBranchAccess(profile.id, validation.data.branchId, role === GlobalRole.Owner ? 'owner' : 'admin', 'record_transaction')

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
      const { data: enabled, error: entitlementError } = await supabase.rpc('business_payment_method_enabled', { p_business_id: businessId, p_method: method })
      if (entitlementError || enabled !== true) return { success: false, error: entitlementError?.message ?? `This subscription plan does not include ${method === 'mpesa_stk' ? 'Daraja M-Pesa prompts' : 'Pesapal hosted checkout'}. Contact the business owner to update plan entitlements.` }
    }

    const needsDaraja = validation.data.paymentMethod === 'mpesa_stk' && !validation.data.splitPayments
      || splitProviderPayment?.paymentMethod === 'mpesa_stk'
    const needsPesapal = validation.data.paymentMethod === 'pesapal' && !validation.data.splitPayments
      || splitProviderPayment?.paymentMethod === 'pesapal'
    const darajaSetup = needsDaraja
      ? await getBusinessDarajaSetup(businessId)
      : undefined
    const pesapalSetup = needsPesapal
      ? await getBusinessPesapalSetup(businessId)
      : undefined
    if (needsPesapal && !pesapalSetup?.config.ipnId) {
      return { success: false, error: 'The owner needs to configure Pesapal and register its IPN before checkout can be used.' }
    }

    const response = await supabase.rpc('dashboard_record_transaction_with_payment_method_v1', {
      p_request_id: requestId.data,
      p_branch_id: validation.data.branchId,
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
        revalidatePath('/dashboard/owner/transactions/new')
        revalidatePath('/dashboard/admin/transactions/new')
      }
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

    if (result?.replayed) {
      revalidatePath('/dashboard/owner/transactions')
      revalidatePath('/dashboard/admin/transactions')
      revalidatePath('/dashboard/owner')
      revalidatePath('/dashboard/admin')
      return { success: true, error: null, message: 'This sale was already recorded. No duplicate sale or payment was created.', transactionId: result.transaction_id }
    }

    let checkoutMessage: string | null = null
    let pesapalCheckoutUrl: string | undefined
    let initiatedPaymentId: string | undefined
    if (splitProviderPayment && result?.transaction_id && splitProviderReference) {
      const { data: payment, error: paymentError } = await supabase.from('payments').select('id')
        .eq('business_id', businessId).eq('transaction_id', result.transaction_id).eq('mpesa_ref_code', splitProviderReference).maybeSingle()
      if (paymentError || !payment) {
        checkoutMessage = 'Sale saved, but its online payment could not be linked. Do not record it again; contact the owner to review the pending payment.'
      } else if (splitProviderPayment.paymentMethod === 'mpesa_stk' && darajaSetup && validation.data.paymentPhone) {
        try {
          initiatedPaymentId = payment.id
          await startBusinessDarajaCheckout({ businessId, paymentId: payment.id, phone: validation.data.paymentPhone, setup: darajaSetup })
          checkoutMessage = 'Sale recorded. An M-Pesa prompt was sent for the split amount; the payment will be confirmed automatically.'
        } catch (checkoutError) {
          logger.error('recordDashboardTransactionForRole: split Daraja checkout failed', { userId: profile.id, businessId, transactionId: result.transaction_id, error: checkoutError })
          checkoutMessage = 'Sale saved with a pending M-Pesa split payment, but the prompt was not confirmed. Review it before retrying.'
        }
      } else if (splitProviderPayment.paymentMethod === 'pesapal' && pesapalSetup) {
        try {
          const returnPath = role === GlobalRole.Owner ? '/dashboard/owner/transactions' : '/dashboard/admin/transactions'
          const started = await startBusinessPesapalCheckout({ businessId, paymentId: payment.id,
            phone: validation.data.customerPhone, email: validation.data.customerEmail || undefined,
            origin: requestOrigin(await headers()), returnPath })
          pesapalCheckoutUrl = started.redirectUrl
          checkoutMessage = 'Sale recorded. Opening Pesapal checkout for the split amount.'
        } catch (checkoutError) {
          logger.error('recordDashboardTransactionForRole: split Pesapal checkout failed', { userId: profile.id, businessId, transactionId: result.transaction_id, error: checkoutError })
          checkoutMessage = 'Sale saved with a pending Pesapal split payment, but checkout was not confirmed. Review it before retrying.'
        }
      }
    }
    if (!validation.data.splitPayments && validation.data.paymentMethod === 'mpesa_stk' && result?.transaction_id && validation.data.paymentPhone) {
      const { data: payment, error: paymentError } = await supabase.from('payments').select('id').eq('business_id', businessId).eq('transaction_id', result.transaction_id).order('payment_at', { ascending: true }).limit(1).maybeSingle()
      if (paymentError || !payment) {
        checkoutMessage = 'Sale saved, but its M-Pesa prompt could not be started. Do not record it again; contact the owner to review this pending payment.'
      } else {
        try {
          initiatedPaymentId = payment.id
          await startBusinessDarajaCheckout({ businessId, paymentId: payment.id, phone: validation.data.paymentPhone, setup: darajaSetup })
          checkoutMessage = 'An M-Pesa prompt was sent. Payment will be confirmed automatically after Safaricom verifies it.'
        } catch (checkoutError) {
          logger.error('recordDashboardTransactionForRole: Daraja checkout start failed', { userId: profile.id, businessId, branchId: validation.data.branchId, transactionId: result.transaction_id, role, error: checkoutError })
          checkoutMessage = 'Sale saved as pending payment, but the prompt result is not confirmed. Do not record this sale again; review its payment status before any retry.'
        }
      }
    }

    if (!validation.data.splitPayments && validation.data.paymentMethod === 'pesapal' && result?.transaction_id && pesapalSetup) {
      const { data: payment, error: paymentError } = await supabase.from('payments').select('id')
        .eq('business_id', businessId).eq('transaction_id', result.transaction_id)
        .order('payment_at', { ascending: true }).limit(1).maybeSingle()
      if (paymentError || !payment) {
        checkoutMessage = 'Sale saved, but the Pesapal checkout could not be linked. Do not record it again; contact the owner to review the pending payment.'
      } else {
        try {
          const returnPath = role === GlobalRole.Owner ? '/dashboard/owner/transactions' : '/dashboard/admin/transactions'
          const started = await startBusinessPesapalCheckout({
            businessId, paymentId: payment.id, phone: validation.data.customerPhone,
            email: validation.data.customerEmail || undefined, origin: requestOrigin(await headers()), returnPath,
          })
          pesapalCheckoutUrl = started.redirectUrl
          checkoutMessage = 'Sale recorded. Opening Pesapal secure checkout.'
        } catch (checkoutError) {
          logger.error('recordDashboardTransactionForRole: Pesapal checkout start failed', { userId: profile.id, businessId, branchId: validation.data.branchId, transactionId: result.transaction_id, role, error: checkoutError })
          checkoutMessage = 'Sale saved as pending payment, but Pesapal did not confirm checkout startup. Do not record the sale again; review its payment status.'
        }
      }
    }

    revalidatePath('/dashboard/owner')
    revalidatePath('/dashboard/owner/transactions')
    revalidatePath('/dashboard/admin')
    revalidatePath('/dashboard/admin/transactions')
    revalidatePath('/dashboard/owner/finances')
    revalidatePath('/dashboard/owner/receivables')

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
      message: checkoutMessage ?? (result?.status === 'verified'
        ? 'Transaction recorded and verified successfully'
        : 'Transaction recorded and sent to owner for verification'),
      transactionId: result?.transaction_id,
      paymentId: initiatedPaymentId,
      checkoutUrl: pesapalCheckoutUrl,
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
