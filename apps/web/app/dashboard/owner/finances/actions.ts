'use server'
/**
 * Server actions for owner-only finance records.
 */

import { revalidatePath } from 'next/cache'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { GlobalRole } from '@smartretail/shared'
import { requireRole } from '../../../../lib/auth/helpers'
import { createClient } from '../../../../lib/supabase/server'
import { createServiceRoleClient } from '../../../../lib/supabase/admin'
import { getBusinessPesapalSetup, requestPesapalRefund } from '../../../../lib/payments/pesapal'
import logger from '../../../../lib/logger'

export type FinanceFormState = {
  success: boolean
  error?: string | null
  message?: string
}

const expenseSchema = z.object({
  branchId: z.string().uuid().optional().or(z.literal('')),
  category: z.string().trim().min(1, 'Expense category is required').max(80),
  description: z.string().trim().min(1, 'Expense description is required').max(180),
  amount: z.number().positive('Expense amount must be greater than zero'),
  incurredOn: z.string().trim().optional(),
})

const lossSchema = z.object({
  branchId: z.string().uuid('Select a branch'),
  productId: z.string().uuid('Select a product'),
  uomId: z.string().uuid('Select a unit'),
  quantity: z.number().positive('Loss quantity must be greater than zero'),
  lossType: z.enum(['breakage', 'spoilage', 'theft', 'markdown_damage', 'other']),
  reason: z.string().trim().min(1, 'Loss reason is required').max(240),
  recoverableAmount: z.number().min(0, 'Recoverable amount cannot be negative'),
  recoverySalePrice: z.number().min(0, 'Recovery selling price cannot be negative'),
})

const recurringTemplateSchema = z.object({
  templateId: z.string().uuid().optional().or(z.literal('')),
  branchId: z.string().uuid().optional().or(z.literal('')),
  category: z.string().trim().min(1, 'Expense category is required').max(80),
  description: z.string().trim().min(1, 'Expense description is required').max(180),
  amount: z.number().positive('Recurring expense amount must be greater than zero'),
  dueDay: z.number().int().min(1, 'Due day must be between 1 and 31').max(31, 'Due day must be between 1 and 31'),
  isActive: z.boolean(),
})

const recurringConfirmSchema = z.object({
  instanceId: z.string().uuid('Expense reminder missing'),
  amount: z.number().positive('Expense amount must be greater than zero'),
  incurredOn: z.string().trim().optional(),
  description: z.string().trim().max(180).optional(),
})

const recurringSkipSchema = z.object({
  instanceId: z.string().uuid('Expense reminder missing'),
})

const damageReportReviewSchema = z.object({
  reportId: z.string().uuid('Damage report missing'),
  quantity: z.number().positive('Loss quantity must be greater than zero'),
  lossType: z.enum(['breakage', 'spoilage', 'theft', 'markdown_damage', 'other']),
  reason: z.string().trim().min(1, 'Loss reason is required').max(240),
  recoverySalePrice: z.number().min(0, 'Recovery selling price cannot be negative'),
  reviewNote: z.string().trim().max(180).optional(),
})

const damageReportRejectSchema = z.object({
  reportId: z.string().uuid('Damage report missing'),
  reviewNote: z.string().trim().max(180).optional(),
})

const cashDepositSchema = z.object({
  branchId: z.string().uuid('Select a branch'),
  depositDate: z.string().trim().min(1, 'Deposit date is required'),
  amount: z.number().positive('Cash deposit amount must be greater than zero'),
  depositReference: z.string().trim().min(3, 'Deposit reference is required').max(80),
  note: z.string().trim().max(180).optional(),
})

const cashDepositReviewSchema = z.object({
  depositId: z.string().uuid('Cash deposit missing'),
  action: z.enum(['approve', 'reject']),
  reviewNote: z.string().trim().max(180).optional(),
})

const paymentRefundSchema = z.object({
  paymentId: z.string().uuid(),
  amount: z.number().positive(),
  reason: z.string().trim().min(5).max(240),
})

const refundReviewSchema = z.object({
  refundRequestId: z.string().uuid(),
  approved: z.boolean(),
  note: z.string().trim().max(240).optional(),
})

const manualRefundSchema = z.object({
  refundRequestId: z.string().uuid(),
  reference: z.string().trim().max(100).optional(),
})

function getString(formData: FormData, key: string): string {
  const value = formData.get(key)
  return typeof value === 'string' ? value.trim() : ''
}

function revalidateFinanceRoutes() {
  revalidatePath('/dashboard/owner/finances')
  revalidatePath('/dashboard/owner/stock')
  revalidatePath('/dashboard/admin/stock')
  revalidatePath('/dashboard/employee')
  revalidatePath('/dashboard/employee/damaged-stock')
  revalidatePath('/dashboard/employee/transactions/new')
  revalidatePath('/dashboard/employee/transactions')
}

export async function requestPaymentRefund(formData: FormData): Promise<FinanceFormState> {
  const profile = await requireRole([GlobalRole.Owner, GlobalRole.Admin])
  const parsed = paymentRefundSchema.safeParse({
    paymentId: getString(formData, 'paymentId'),
    amount: Number(getString(formData, 'amount')),
    reason: getString(formData, 'reason'),
  })
  if (!parsed.success) return { success: false, error: parsed.error.errors[0]?.message ?? 'Invalid refund request' }
  if (!profile.business_id) return { success: false, error: 'Business context missing' }
  const supabase = await createClient()
  const { error } = await supabase.rpc('request_payment_refund', {
    p_payment_id: parsed.data.paymentId, p_amount: parsed.data.amount, p_reason: parsed.data.reason,
  })
  if (error) return { success: false, error: error.message }
  revalidateFinanceRoutes()
  return { success: true }
}

export async function reviewPaymentRefund(formData: FormData): Promise<FinanceFormState> {
  const profile = await requireRole([GlobalRole.Owner, GlobalRole.Admin])
  const parsed = refundReviewSchema.safeParse({
    refundRequestId: getString(formData, 'refundRequestId'),
    approved: getString(formData, 'approved') === 'true',
    note: getString(formData, 'note') || undefined,
  })
  if (!parsed.success) return { success: false, error: parsed.error.errors[0]?.message ?? 'Invalid refund review' }
  if (!profile.business_id) return { success: false, error: 'Business context missing' }
  const supabase = await createClient()
  const { error } = await supabase.rpc('review_payment_refund_request', {
    p_refund_request_id: parsed.data.refundRequestId, p_approved: parsed.data.approved, p_note: parsed.data.note ?? null,
  })
  if (error) return { success: false, error: error.message }
  revalidateFinanceRoutes()
  return { success: true }
}

export async function recordManualPaymentRefund(formData: FormData): Promise<FinanceFormState> {
  const profile = await requireRole([GlobalRole.Owner])
  const parsed = manualRefundSchema.safeParse({
    refundRequestId: getString(formData, 'refundRequestId'), reference: getString(formData, 'reference') || undefined,
  })
  if (!parsed.success) return { success: false, error: parsed.error.errors[0]?.message ?? 'Invalid refund completion' }
  const service = createServiceRoleClient()
  const { data: refund, error: lookupError } = await service.from('payment_refund_requests')
    .select('id,business_id,payment_id,amount,reason,status,provider_submission_at,payments!inner(provider,provider_transaction_id,payment_method)')
    .eq('id', parsed.data.refundRequestId).eq('business_id', profile.business_id ?? '').maybeSingle()
  if (lookupError || !refund) return { success: false, error: lookupError?.message ?? 'Refund request was not found for this business.' }
  const payment = Array.isArray(refund.payments) ? refund.payments[0] : refund.payments
  if (refund.status === 'processing' && payment?.provider === 'pesapal' && (parsed.data.reference ?? '').trim().length < 3) {
    return { success: false, error: 'Enter the actual Pesapal refund confirmation reference after checking that the customer received the funds.' }
  }
  if (payment?.provider === 'pesapal' && refund.status === 'approved') {
    if (!payment.provider_transaction_id) return { success: false, error: 'The Pesapal confirmation code is missing; the refund was not submitted.' }
    let setup: Awaited<ReturnType<typeof getBusinessPesapalSetup>>
    try { setup = await getBusinessPesapalSetup(profile.business_id ?? '') } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Pesapal settings could not be loaded.' }
    }
    const { data: claimed, error: claimError } = await service.from('payment_refund_requests')
      .update({ status: 'processing', provider_submission_message: 'Submitting refund request to Pesapal.' })
      .eq('id', refund.id).eq('business_id', profile.business_id ?? '').eq('status', 'approved').select('id').maybeSingle()
    if (claimError || !claimed) return { success: false, error: 'This refund has already been submitted or changed.' }
    try {
      const providerResult = await requestPesapalRefund(setup.config, {
        confirmationCode: payment.provider_transaction_id, amount: Number(refund.amount),
        username: profile.name || profile.email || 'Retivox business owner', remarks: refund.reason,
      })
      if (!providerResult.accepted) {
        await service.from('payment_refund_requests').update({ status: 'approved', provider_submission_message: providerResult.message }).eq('id', refund.id).eq('status', 'processing')
        revalidateFinanceRoutes()
        return { success: false, error: providerResult.message }
      }
      await service.from('payment_refund_requests').update({ provider_submission_at: new Date().toISOString(), provider_submission_message: providerResult.message }).eq('id', refund.id).eq('status', 'processing')
      revalidateFinanceRoutes()
      return { success: true, message: `${providerResult.message} This does not mean the customer has received the refund yet.` }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Pesapal refund submission could not be confirmed.'
      await service.from('payment_refund_requests').update({ provider_submission_message: `Submission result unknown: ${message}. Check Pesapal before retrying.` }).eq('id', refund.id).eq('status', 'processing')
      revalidateFinanceRoutes()
      return { success: false, error: `Pesapal response is uncertain. Check the merchant portal before retrying. ${message}` }
    }
  }
  const supabase = await createClient()
  const { error } = await supabase.rpc('record_manual_payment_refund', {
    p_refund_request_id: parsed.data.refundRequestId, p_reference: parsed.data.reference ?? null,
  })
  if (error) return { success: false, error: error.message }
  revalidateFinanceRoutes()
  return { success: true }
}

export async function reconcileDarajaC2BPayment(_previous: FinanceFormState, formData: FormData): Promise<FinanceFormState> {
  const profile = await requireRole([GlobalRole.Owner, GlobalRole.Admin])
  const unmatchedPaymentId = getString(formData, 'unmatchedPaymentId')
  const paymentId = getString(formData, 'paymentId')
  if (!profile.business_id || !/^[0-9a-f-]{36}$/i.test(unmatchedPaymentId) || !/^[0-9a-f-]{36}$/i.test(paymentId)) {
    return { success: false, error: 'Choose a valid provider receipt and pending sale payment.' }
  }
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('owner_reconcile_daraja_c2b_payment', {
    p_unmatched_payment_id: unmatchedPaymentId,
    p_payment_id: paymentId,
  })
  if (error) return { success: false, error: error.message }
  if (data !== true) return { success: false, error: 'This receipt is no longer available for reconciliation.' }
  revalidateFinanceRoutes()
  return { success: true }
}

export async function recordFinanceExpense(_prevState: FinanceFormState, formData: FormData): Promise<FinanceFormState> {
  const profile = await requireRole([GlobalRole.Owner])
  const validation = expenseSchema.safeParse({
    branchId: getString(formData, 'branchId'),
    category: getString(formData, 'category'),
    description: getString(formData, 'description'),
    amount: Number(getString(formData, 'amount')),
    incurredOn: getString(formData, 'incurredOn'),
  })

  if (!validation.success) {
    return { success: false, error: validation.error.errors[0]?.message ?? 'Invalid expense' }
  }

  const businessId = profile.business_id

  if (!businessId) {
    logger.error('recordFinanceExpense: missing business id', { userId: profile.id })
    return { success: false, error: 'Business context missing' }
  }

  try {
    const supabase = await createClient()
    const { error } = await supabase.rpc('record_owner_finance_expense', {
      p_branch_id: validation.data.branchId || null,
      p_category: validation.data.category,
      p_description: validation.data.description,
      p_amount: validation.data.amount,
      p_incurred_on: validation.data.incurredOn || null,
    })

    if (error) {
      logger.error('recordFinanceExpense: RPC failed', { businessId, error })
      return { success: false, error: error.message ?? 'Unable to record expense' }
    }

    revalidateFinanceRoutes()
    return { success: true, error: null }
  } catch (error: unknown) {
    logger.error('recordFinanceExpense: unexpected error', { businessId, error })
    return { success: false, error: error instanceof Error ? error.message : 'Server error' }
  }
}

export async function recordInventoryLoss(_prevState: FinanceFormState, formData: FormData): Promise<FinanceFormState> {
  const profile = await requireRole([GlobalRole.Owner])
  const validation = lossSchema.safeParse({
    branchId: getString(formData, 'branchId'),
    productId: getString(formData, 'productId'),
    uomId: getString(formData, 'uomId'),
    quantity: Number(getString(formData, 'quantity')),
    lossType: getString(formData, 'lossType'),
    reason: getString(formData, 'reason'),
    recoverableAmount: Number(getString(formData, 'recoverableAmount') || 0),
    recoverySalePrice: Number(getString(formData, 'recoverySalePrice') || 0),
  })

  if (!validation.success) {
    return { success: false, error: validation.error.errors[0]?.message ?? 'Invalid inventory loss' }
  }

  const businessId = profile.business_id

  if (!businessId) {
    logger.error('recordInventoryLoss: missing business id', { userId: profile.id })
    return { success: false, error: 'Business context missing' }
  }

  try {
    const supabase = await createClient()
    const { error } = await supabase.rpc('record_inventory_loss_event', {
      p_branch_id: validation.data.branchId,
      p_product_id: validation.data.productId,
      p_uom_id: validation.data.uomId,
      p_quantity_in_uom: validation.data.quantity,
      p_loss_type: validation.data.lossType,
      p_reason: validation.data.reason,
      p_recoverable_amount: validation.data.recoverableAmount,
      p_recovery_sale_price_per_uom: validation.data.recoverySalePrice || null,
    })

    if (error) {
      logger.error('recordInventoryLoss: RPC failed', { businessId, error })
      return { success: false, error: error.message ?? 'Unable to record inventory loss' }
    }

    revalidateFinanceRoutes()
    return { success: true, error: null }
  } catch (error: unknown) {
    logger.error('recordInventoryLoss: unexpected error', { businessId, error })
    return { success: false, error: error instanceof Error ? error.message : 'Server error' }
  }
}

export async function upsertRecurringFinanceExpense(_prevState: FinanceFormState, formData: FormData): Promise<FinanceFormState> {
  const profile = await requireRole([GlobalRole.Owner])
  const validation = recurringTemplateSchema.safeParse({
    templateId: getString(formData, 'templateId'),
    branchId: getString(formData, 'branchId'),
    category: getString(formData, 'category'),
    description: getString(formData, 'description'),
    amount: Number(getString(formData, 'amount')),
    dueDay: Number(getString(formData, 'dueDay') || 28),
    isActive: getString(formData, 'isActive') !== 'false',
  })

  if (!validation.success) {
    return { success: false, error: validation.error.errors[0]?.message ?? 'Invalid recurring expense' }
  }

  const businessId = profile.business_id

  if (!businessId) {
    logger.error('upsertRecurringFinanceExpense: missing business id', { userId: profile.id })
    return { success: false, error: 'Business context missing' }
  }

  try {
    const supabase = await createClient()
    const { error } = await supabase.rpc('upsert_recurring_finance_expense_template', {
      p_template_id: validation.data.templateId || null,
      p_branch_id: validation.data.branchId || null,
      p_category: validation.data.category,
      p_description: validation.data.description,
      p_default_amount: validation.data.amount,
      p_due_day: validation.data.dueDay,
      p_is_active: validation.data.isActive,
    })

    if (error) {
      logger.error('upsertRecurringFinanceExpense: RPC failed', { businessId, error })
      return { success: false, error: error.message ?? 'Unable to save recurring expense' }
    }

    revalidateFinanceRoutes()
    return { success: true, error: null }
  } catch (error: unknown) {
    logger.error('upsertRecurringFinanceExpense: unexpected error', { businessId, error })
    return { success: false, error: error instanceof Error ? error.message : 'Server error' }
  }
}

export async function confirmRecurringFinanceExpense(_prevState: FinanceFormState, formData: FormData): Promise<FinanceFormState> {
  const profile = await requireRole([GlobalRole.Owner])
  const validation = recurringConfirmSchema.safeParse({
    instanceId: getString(formData, 'instanceId'),
    amount: Number(getString(formData, 'amount')),
    incurredOn: getString(formData, 'incurredOn'),
    description: getString(formData, 'description') || undefined,
  })

  if (!validation.success) {
    return { success: false, error: validation.error.errors[0]?.message ?? 'Invalid recurring expense confirmation' }
  }

  const businessId = profile.business_id

  if (!businessId) {
    logger.error('confirmRecurringFinanceExpense: missing business id', { userId: profile.id })
    return { success: false, error: 'Business context missing' }
  }

  try {
    const supabase = await createClient()
    const { error } = await supabase.rpc('confirm_recurring_finance_expense_instance', {
      p_instance_id: validation.data.instanceId,
      p_amount: validation.data.amount,
      p_incurred_on: validation.data.incurredOn || null,
      p_description: validation.data.description || null,
    })

    if (error) {
      logger.error('confirmRecurringFinanceExpense: RPC failed', { businessId, error })
      return { success: false, error: error.message ?? 'Unable to confirm recurring expense' }
    }

    revalidateFinanceRoutes()
    return { success: true, error: null }
  } catch (error: unknown) {
    logger.error('confirmRecurringFinanceExpense: unexpected error', { businessId, error })
    return { success: false, error: error instanceof Error ? error.message : 'Server error' }
  }
}

export async function skipRecurringFinanceExpense(_prevState: FinanceFormState, formData: FormData): Promise<FinanceFormState> {
  const profile = await requireRole([GlobalRole.Owner])
  const validation = recurringSkipSchema.safeParse({
    instanceId: getString(formData, 'instanceId'),
  })

  if (!validation.success) {
    return { success: false, error: validation.error.errors[0]?.message ?? 'Invalid recurring expense reminder' }
  }

  const businessId = profile.business_id

  if (!businessId) {
    logger.error('skipRecurringFinanceExpense: missing business id', { userId: profile.id })
    return { success: false, error: 'Business context missing' }
  }

  try {
    const supabase = await createClient()
    const { error } = await supabase.rpc('skip_recurring_finance_expense_instance', {
      p_instance_id: validation.data.instanceId,
    })

    if (error) {
      logger.error('skipRecurringFinanceExpense: RPC failed', { businessId, error })
      return { success: false, error: error.message ?? 'Unable to skip recurring expense' }
    }

    revalidateFinanceRoutes()
    return { success: true, error: null }
  } catch (error: unknown) {
    logger.error('skipRecurringFinanceExpense: unexpected error', { businessId, error })
    return { success: false, error: error instanceof Error ? error.message : 'Server error' }
  }
}

export async function recordBranchCashDeposit(_prevState: FinanceFormState, formData: FormData): Promise<FinanceFormState> {
  const profile = await requireRole([GlobalRole.Owner, GlobalRole.Admin, GlobalRole.Employee])
  const validation = cashDepositSchema.safeParse({
    branchId: getString(formData, 'branchId'),
    depositDate: getString(formData, 'depositDate'),
    amount: Number(getString(formData, 'amount')),
    depositReference: getString(formData, 'depositReference'),
    note: getString(formData, 'note') || undefined,
  })

  if (!validation.success) {
    return { success: false, error: validation.error.errors[0]?.message ?? 'Invalid cash deposit' }
  }

  const businessId = profile.business_id

  if (!businessId) {
    logger.error('recordBranchCashDeposit: missing business id', { userId: profile.id })
    return { success: false, error: 'Business context missing' }
  }

  try {
    const supabase = await createClient()
    const { error } = await supabase.rpc('record_branch_cash_deposit_v2', {
      p_branch_id: validation.data.branchId,
      p_deposit_date: validation.data.depositDate,
      p_amount: validation.data.amount,
      p_deposit_reference: validation.data.depositReference,
      p_note: validation.data.note ?? null,
      p_local_id: randomUUID(),
    })

    if (error) {
      logger.error('recordBranchCashDeposit: RPC failed', { businessId, branchId: validation.data.branchId, error })
      return { success: false, error: error.message ?? 'Unable to record cash deposit' }
    }

    revalidateFinanceRoutes()
    revalidatePath('/dashboard/owner/transactions')
    revalidatePath('/dashboard/admin/transactions')
    return { success: true, error: null }
  } catch (error: unknown) {
    logger.error('recordBranchCashDeposit: unexpected error', { businessId, error })
    return { success: false, error: error instanceof Error ? error.message : 'Server error' }
  }
}

export async function reviewBranchCashDeposit(_prevState: FinanceFormState, formData: FormData): Promise<FinanceFormState> {
  const profile = await requireRole([GlobalRole.Owner, GlobalRole.Admin])
  const validation = cashDepositReviewSchema.safeParse({
    depositId: getString(formData, 'depositId'),
    action: getString(formData, 'action'),
    reviewNote: getString(formData, 'reviewNote') || undefined,
  })

  if (!validation.success) {
    return { success: false, error: validation.error.errors[0]?.message ?? 'Invalid cash deposit review' }
  }

  const businessId = profile.business_id

  if (!businessId) {
    logger.error('reviewBranchCashDeposit: missing business id', { userId: profile.id })
    return { success: false, error: 'Business context missing' }
  }

  try {
    const supabase = await createClient()
    const { error } = await supabase.rpc('review_branch_cash_deposit_v2', {
      p_deposit_id: validation.data.depositId,
      p_action: validation.data.action,
      p_review_note: validation.data.reviewNote ?? null,
      p_local_id: randomUUID(),
    })

    if (error) {
      logger.error('reviewBranchCashDeposit: RPC failed', {
        businessId,
        depositId: validation.data.depositId,
        action: validation.data.action,
        error,
      })
      return { success: false, error: error.message ?? 'Unable to review cash deposit' }
    }

    revalidateFinanceRoutes()
    revalidatePath('/dashboard/owner/transactions')
    revalidatePath('/dashboard/admin/transactions')
    return { success: true, error: null }
  } catch (error: unknown) {
    logger.error('reviewBranchCashDeposit: unexpected error', { businessId, error })
    return { success: false, error: error instanceof Error ? error.message : 'Server error' }
  }
}

export async function approveEmployeeDamageReport(formData: FormData): Promise<void> {
  const profile = await requireRole([GlobalRole.Owner])
  const validation = damageReportReviewSchema.safeParse({
    reportId: getString(formData, 'reportId'),
    quantity: Number(getString(formData, 'quantity')),
    lossType: getString(formData, 'lossType'),
    reason: getString(formData, 'reason'),
    recoverySalePrice: Number(getString(formData, 'recoverySalePrice') || 0),
    reviewNote: getString(formData, 'reviewNote') || undefined,
  })

  if (!validation.success) {
    throw new Error(validation.error.errors[0]?.message ?? 'Invalid damage report')
  }

  const businessId = profile.business_id

  if (!businessId) {
    throw new Error('Business context missing')
  }

  const supabase = await createClient()
  const updateResponse = await supabase.rpc('owner_update_employee_inventory_loss_report', {
    p_report_id: validation.data.reportId,
    p_quantity_in_uom: validation.data.quantity,
    p_loss_type: validation.data.lossType,
    p_reason: validation.data.reason,
    p_recovery_sale_price_per_base_unit: validation.data.recoverySalePrice || null,
    p_review_note: validation.data.reviewNote ?? null,
  })

  if (updateResponse.error) {
    logger.error('approveEmployeeDamageReport: update RPC failed', { businessId, error: updateResponse.error })
    throw new Error(updateResponse.error.message ?? 'Unable to update damage report')
  }

  const { error } = await supabase.rpc('owner_approve_employee_inventory_loss_report', {
    p_report_id: validation.data.reportId,
    p_recovery_sale_price_per_base_unit: validation.data.recoverySalePrice || null,
    p_review_note: validation.data.reviewNote ?? null,
  })

  if (error) {
    logger.error('approveEmployeeDamageReport: RPC failed', { businessId, error })
    throw new Error(error.message ?? 'Unable to approve damage report')
  }

  revalidateFinanceRoutes()
}

export async function updateEmployeeDamageReport(formData: FormData): Promise<void> {
  const profile = await requireRole([GlobalRole.Owner])
  const validation = damageReportReviewSchema.safeParse({
    reportId: getString(formData, 'reportId'),
    quantity: Number(getString(formData, 'quantity')),
    lossType: getString(formData, 'lossType'),
    reason: getString(formData, 'reason'),
    recoverySalePrice: Number(getString(formData, 'recoverySalePrice') || 0),
    reviewNote: getString(formData, 'reviewNote') || undefined,
  })

  if (!validation.success) {
    throw new Error(validation.error.errors[0]?.message ?? 'Invalid damage report')
  }

  const businessId = profile.business_id

  if (!businessId) {
    throw new Error('Business context missing')
  }

  const supabase = await createClient()
  const { error } = await supabase.rpc('owner_update_employee_inventory_loss_report', {
    p_report_id: validation.data.reportId,
    p_quantity_in_uom: validation.data.quantity,
    p_loss_type: validation.data.lossType,
    p_reason: validation.data.reason,
    p_recovery_sale_price_per_base_unit: validation.data.recoverySalePrice || null,
    p_review_note: validation.data.reviewNote ?? null,
  })

  if (error) {
    logger.error('updateEmployeeDamageReport: RPC failed', { businessId, error })
    throw new Error(error.message ?? 'Unable to update damage report')
  }

  revalidateFinanceRoutes()
}

export async function rejectEmployeeDamageReport(formData: FormData): Promise<void> {
  const profile = await requireRole([GlobalRole.Owner])
  const validation = damageReportRejectSchema.safeParse({
    reportId: getString(formData, 'reportId'),
    reviewNote: getString(formData, 'reviewNote') || undefined,
  })

  if (!validation.success) {
    throw new Error(validation.error.errors[0]?.message ?? 'Invalid damage report')
  }

  const businessId = profile.business_id

  if (!businessId) {
    throw new Error('Business context missing')
  }

  const supabase = await createClient()
  const { error } = await supabase.rpc('owner_reject_employee_inventory_loss_report', {
    p_report_id: validation.data.reportId,
    p_review_note: validation.data.reviewNote ?? null,
  })

  if (error) {
    logger.error('rejectEmployeeDamageReport: RPC failed', { businessId, error })
    throw new Error(error.message ?? 'Unable to reject damage report')
  }

  revalidateFinanceRoutes()
}
