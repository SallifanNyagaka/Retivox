'use server'
/**
 * Server actions for owner-only finance records.
 */

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { GlobalRole } from '@smartretail/shared'
import { requireRole } from '../../../../lib/auth/helpers'
import { createClient } from '../../../../lib/supabase/server'
import logger from '../../../../lib/logger'

export type FinanceFormState = {
  success: boolean
  error?: string | null
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
