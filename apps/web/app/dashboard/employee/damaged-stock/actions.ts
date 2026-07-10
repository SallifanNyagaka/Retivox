'use server'
/**
 * Server actions for employee damaged stock reports.
 */

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAuth } from '../../../../lib/auth/helpers'
import { getEmployeeProfile } from '../../../../lib/employee/auth'
import logger from '../../../../lib/logger'
import { createClient } from '../../../../lib/supabase/server'

export type DamagedStockFormState = {
  success: boolean
  message?: string | null
  error?: string | null
}

const damageReportSchema = z.object({
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

function getEmployeeDamageMessage(errorMessage: string) {
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

  return errorMessage
}

export async function reportDamagedStock(_prevState: DamagedStockFormState, formData: FormData): Promise<DamagedStockFormState> {
  const user = await requireAuth()
  const employeeProfile = await getEmployeeProfile(user.id)

  if (!employeeProfile || !employeeProfile.isActive || !employeeProfile.branchId) {
    logger.warn('reportDamagedStock: employee scope missing', {
      userId: user.id,
      hasProfile: Boolean(employeeProfile),
    })
    return { success: false, error: 'Your employee branch is not active. Please contact your manager.' }
  }

  const validation = damageReportSchema.safeParse({
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
    const supabase = await createClient()
    const { error } = await supabase.rpc('employee_report_inventory_loss', {
      p_product_id: validation.data.productId,
      p_uom_id: validation.data.uomId,
      p_quantity_in_uom: validation.data.quantity,
      p_loss_type: validation.data.lossType,
      p_reason: validation.data.reason,
    })

    if (error) {
      logger.error('reportDamagedStock: RPC failed', {
        userId: employeeProfile.id,
        businessId: employeeProfile.businessId,
        branchId: employeeProfile.branchId,
        error,
      })
      return { success: false, error: getEmployeeDamageMessage(error.message ?? 'Unable to submit damaged stock report') }
    }

    revalidatePath('/dashboard/employee/damaged-stock')
    revalidatePath('/dashboard/employee')
    revalidatePath('/dashboard/owner/finances')
    return { success: true, message: 'Damaged stock report submitted for owner review.', error: null }
  } catch (error: unknown) {
    logger.error('reportDamagedStock: unexpected error', {
      userId: employeeProfile.id,
      businessId: employeeProfile.businessId,
      branchId: employeeProfile.branchId,
      error,
    })
    return { success: false, error: error instanceof Error ? error.message : 'Server error' }
  }
}
