'use server'
/**
 * Server actions for admin damaged stock reports.
 */

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { GlobalRole } from '@smartretail/shared'
import { requireRole } from '../../../../lib/auth/helpers'
import { assertBranchAccess } from '../../../../lib/auth/branchAccess'
import logger from '../../../../lib/logger'
import { createClient } from '../../../../lib/supabase/server'

export type AdminDamagedStockFormState = {
  success: boolean
  message?: string | null
  error?: string | null
}

const adminDamageReportSchema = z.object({
  branchId: z.string().uuid('Select a store'),
  productId: z.string().uuid('Select a product'),
  uomId: z.string().uuid('Select a unit'),
  quantity: z.number().positive('Quantity must be greater than zero'),
  lossType: z.enum(['breakage', 'spoilage', 'theft', 'markdown_damage', 'other']),
  reason: z.string().trim().min(1, 'Explain what happened').max(240, 'Reason is too long'),
})

function getString(formData: FormData, key: string): string {
  const value = formData.get(key)
  return typeof value === 'string' ? value.trim() : ''
}

function getAdminDamageMessage(errorMessage: string) {
  if (errorMessage.includes('higher than available stock')) {
    return 'The damaged quantity is higher than the available stock for this product.'
  }

  if (errorMessage.includes('whole base unit')) {
    return 'This quantity does not convert cleanly to individual units. Please adjust the quantity.'
  }

  if (errorMessage.includes('Selected unit is not linked')) {
    return 'That unit is not linked to this product anymore. Please refresh and try again.'
  }

  if (errorMessage.includes('only report damaged stock in individual units')) {
    return 'Damaged stock can only be reported in the product individual unit. Please refresh and try again.'
  }

  if (errorMessage.includes('Unauthorized')) {
    return 'You can only report damaged stock for stores you manage.'
  }

  return errorMessage
}

export async function reportAdminDamagedStock(
  _prevState: AdminDamagedStockFormState,
  formData: FormData
): Promise<AdminDamagedStockFormState> {
  const profile = await requireRole([GlobalRole.Admin])

  if (!profile.business_id) {
    logger.warn('reportAdminDamagedStock: business scope missing', { userId: profile.id })
    return { success: false, error: 'Business context missing. Please refresh and try again.' }
  }

  const validation = adminDamageReportSchema.safeParse({
    branchId: getString(formData, 'branchId'),
    productId: getString(formData, 'productId'),
    uomId: getString(formData, 'uomId'),
    quantity: Number(getString(formData, 'quantity')),
    lossType: getString(formData, 'lossType'),
    reason: getString(formData, 'reason'),
  })

  if (!validation.success) {
    return { success: false, error: validation.error.errors[0]?.message ?? 'Invalid damaged stock report' }
  }

  try {
    await assertBranchAccess(profile.id, validation.data.branchId, 'admin', 'admin_report_damaged_stock')

    const supabase = await createClient()
    const { error } = await supabase.rpc('admin_report_inventory_loss', {
      p_branch_id: validation.data.branchId,
      p_product_id: validation.data.productId,
      p_uom_id: validation.data.uomId,
      p_quantity_in_uom: validation.data.quantity,
      p_loss_type: validation.data.lossType,
      p_reason: validation.data.reason,
    })

    if (error) {
      logger.error('reportAdminDamagedStock: RPC failed', {
        userId: profile.id,
        businessId: profile.business_id,
        branchId: validation.data.branchId,
        error,
      })
      return { success: false, error: getAdminDamageMessage(error.message ?? 'Unable to submit damaged stock report') }
    }

    revalidatePath('/dashboard/admin/damaged-stock')
    revalidatePath('/dashboard/admin/stock')
    revalidatePath('/dashboard/owner/finances')
    return { success: true, message: 'Damaged stock report submitted for owner review.', error: null }
  } catch (error: unknown) {
    logger.error('reportAdminDamagedStock: unexpected error', {
      userId: profile.id,
      businessId: profile.business_id,
      error,
    })
    return { success: false, error: error instanceof Error ? getAdminDamageMessage(error.message) : 'Server error' }
  }
}
