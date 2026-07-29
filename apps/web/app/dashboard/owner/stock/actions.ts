'use server'
/**
 * Server actions for branch-scoped stock operations.
 *
 * Every mutation validates input, authorizes the current user through
 * branch-scoped access, delegates atomic stock writes to Postgres RPCs, and
 * revalidates owner/admin stock dashboards.
 *
 * Future rate limiting: supplier delivery recording and manual stock
 * adjustments should sit behind infrastructure rate limits once usage grows,
 * because runaway clients could otherwise create high write pressure.
 */

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { GlobalRole } from '@smartretail/shared'
import { requireRole } from '../../../../lib/auth/helpers'
import { assertBranchAccess } from '../../../../lib/auth/branchAccess'
import { createClient } from '../../../../lib/supabase/server'
import logger from '../../../../lib/logger'
import type { FormState } from './types'

/**
 * Single cost/expense line attached to a supplier delivery item.
 */
type DeliveryCostDraft = {
  description: string
  amount: number
}

/**
 * Single supplier delivery line item parsed from the form.
 */
type DeliveryDraftItem = {
  productId: string
  uomId: string
  quantity: number
  unitCost: string
  costs: DeliveryCostDraft[]
  notes: string
}

/**
 * Single supplier delivery line item parsed from the edit form.
 */
type DeliveryEditDraftItem = DeliveryDraftItem & {
  deliveryItemId: string
}

/**
 * Validates supplier delivery requests.
 */
const recordDeliverySchema = z.object({
  branchId: z.string().uuid(),
  supplierId: z.string().uuid().optional().or(z.literal('')),
  supplierName: z.string().trim().min(1, 'Supplier name is required').max(120),
  supplierPhone: z.string().trim().max(40).optional().default(''),
  supplierEmail: z.string().trim().email('Enter a valid supplier email').optional().or(z.literal('')).default(''),
  supplierContactPerson: z.string().trim().max(120).optional().default(''),
  supplierNotes: z.string().trim().max(240).optional().default(''),
  referenceCode: z.string().trim().max(80).optional().default(''),
  priceRating: z.number().int().min(1).max(5).optional(),
  stockQualityRating: z.number().int().min(1).max(5).optional(),
  availabilityRating: z.number().int().min(1).max(5).optional(),
  ratingNote: z.string().trim().max(240).optional().default(''),
  items: z
    .array(
      z.object({
        productId: z.string().uuid('Select a product'),
        uomId: z.string().uuid('Select a unit'),
        quantity: z.number().positive('Quantity must be greater than zero'),
        unitCost: z.string().trim().max(32),
        costs: z.array(
          z.object({
            description: z.string().trim().min(1, 'Cost description is required').max(120),
            amount: z.number().positive('Cost amount must be greater than zero'),
          })
        ),
        notes: z.string().trim().max(300),
      })
    )
    .min(1, 'Add at least one product'),
})

/**
 * Validates threshold update requests.
 */
const updateThresholdSchema = z.object({
  stockId: z.string().uuid(),
  branchId: z.string().uuid(),
  threshold: z.number().int().min(0, 'Threshold must be zero or greater'),
})

/**
 * Validates delivery workflow action requests.
 */
const deliveryActionSchema = z.object({
  deliveryId: z.string().uuid(),
})

/**
 * Validates supplier delivery edit requests.
 */
const editDeliverySchema = z.object({
  deliveryId: z.string().uuid(),
  branchId: z.string().uuid(),
  supplierName: z.string().trim().min(1, 'Supplier name is required').max(120),
  referenceCode: z.string().trim().max(80).optional().default(''),
  reason: z.string().trim().max(500),
  items: z
    .array(
      z.object({
        deliveryItemId: z.string().uuid(),
        productId: z.string().uuid('Select a product'),
        uomId: z.string().uuid('Select a unit'),
        quantity: z.number().positive('Quantity must be greater than zero'),
        unitCost: z.string().trim().max(32),
        costs: z.array(
          z.object({
            description: z.string().trim().min(1, 'Cost description is required').max(120),
            amount: z.number().positive('Cost amount must be greater than zero'),
          })
        ),
        notes: z.string().trim().max(300),
      })
    )
    .min(1, 'Keep at least one delivery item'),
})

/**
 * Validates delivery edit approval requests.
 */
const deliveryEditReviewSchema = z.object({
  requestId: z.string().uuid(),
  action: z.enum(['approve', 'reject']),
})

/**
 * Validates high-risk manual adjustment requests.
 */
const manualAdjustmentSchema = z.object({
  stockId: z.string().uuid(),
  branchId: z.string().uuid(),
  quantity: z.number().int().positive('Quantity must be greater than zero'),
  operation: z.enum(['add', 'remove']),
  reason: z.string().trim().min(10, 'Reason must be at least 10 characters').max(500),
})

/**
 * Safely reads a trimmed string from FormData.
 */
function getString(formData: FormData, key: string): string {
  const value = formData.get(key)
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Parses delivery item rows from FormData.
 */
function parseDeliveryItems(formData: FormData): DeliveryDraftItem[] {
  const count = Number(formData.get('itemsCount') ?? 0)
  const safeCount = Number.isFinite(count) && count > 0 ? count : 0
  const items: DeliveryDraftItem[] = []

  for (let index = 0; index < safeCount; index += 1) {
    const productId = getString(formData, `productId_${index}`)
    const quantityValue = getString(formData, `quantity_${index}`)
    const costCount = Number(formData.get(`costCount_${index}`) ?? 0)
    const safeCostCount = Number.isFinite(costCount) && costCount > 0 ? costCount : 0
    const costs: DeliveryCostDraft[] = []

    if (!productId && !quantityValue) {
      continue
    }

    for (let costIndex = 0; costIndex < safeCostCount; costIndex += 1) {
      const description = getString(formData, `costDescription_${index}_${costIndex}`)
      const amountValue = getString(formData, `costAmount_${index}_${costIndex}`)
      const amount = Number(amountValue)

      if (!description && !amountValue) {
        continue
      }

      costs.push({
        description,
        amount,
      })
    }

    const totalUnitCost = costs.reduce((sum, cost) => (
      Number.isFinite(cost.amount) && cost.amount > 0 ? sum + cost.amount : sum
    ), 0)

    items.push({
      productId,
      uomId: getString(formData, `uomId_${index}`),
      quantity: Number(quantityValue),
      unitCost: totalUnitCost > 0 ? String(totalUnitCost) : getString(formData, `unitCost_${index}`),
      costs,
      notes: getString(formData, `notes_${index}`),
    })
  }

  return items
}

/**
 * Parses existing delivery item rows from FormData.
 */
function parseDeliveryEditItems(formData: FormData): DeliveryEditDraftItem[] {
  const count = Number(formData.get('itemsCount') ?? 0)
  const safeCount = Number.isFinite(count) && count > 0 ? count : 0
  const items: DeliveryEditDraftItem[] = []

  for (let index = 0; index < safeCount; index += 1) {
    const deliveryItemId = getString(formData, `deliveryItemId_${index}`)
    const productId = getString(formData, `productId_${index}`)
    const quantityValue = getString(formData, `quantity_${index}`)
    const costCount = Number(formData.get(`costCount_${index}`) ?? 0)
    const safeCostCount = Number.isFinite(costCount) && costCount > 0 ? costCount : 0
    const costs: DeliveryCostDraft[] = []

    if (!deliveryItemId && !productId && !quantityValue) {
      continue
    }

    for (let costIndex = 0; costIndex < safeCostCount; costIndex += 1) {
      const description = getString(formData, `costDescription_${index}_${costIndex}`)
      const amountValue = getString(formData, `costAmount_${index}_${costIndex}`)
      const amount = Number(amountValue)

      if (!description && !amountValue) {
        continue
      }

      costs.push({
        description,
        amount,
      })
    }

    const totalUnitCost = costs.reduce((sum, cost) => (
      Number.isFinite(cost.amount) && cost.amount > 0 ? sum + cost.amount : sum
    ), 0)

    items.push({
      deliveryItemId,
      productId,
      uomId: getString(formData, `uomId_${index}`),
      quantity: Number(quantityValue),
      unitCost: totalUnitCost > 0 ? String(totalUnitCost) : getString(formData, `unitCost_${index}`),
      costs,
      notes: getString(formData, `notes_${index}`),
    })
  }

  return items
}

/**
 * Revalidates all stock routes after a successful mutation.
 */
function revalidateStockRoutes() {
  revalidatePath('/dashboard/owner/stock')
  revalidatePath('/dashboard/owner/finances')
  revalidatePath('/dashboard/admin/stock')
  revalidatePath('/dashboard/employee')
  revalidatePath('/dashboard/employee/transactions/new')
}

/**
 * Records a supplier delivery through a transactional RPC.
 */
export async function recordSupplierDelivery(_prevState: FormState, formData: FormData): Promise<FormState> {
  const profile = await requireRole([GlobalRole.Owner, GlobalRole.Admin])
  const branchId = getString(formData, 'branchId')

  if (!z.string().uuid().safeParse(branchId).success) {
    return { success: false, error: 'Select a valid branch' }
  }

  const effectiveRole = await assertBranchAccess(profile.id, branchId, 'admin', 'record_supplier_delivery')

  const validation = recordDeliverySchema.safeParse({
    branchId,
    supplierId: getString(formData, 'supplierId'),
    supplierName: getString(formData, 'supplierName'),
    supplierPhone: getString(formData, 'supplierPhone'),
    supplierEmail: getString(formData, 'supplierEmail'),
    supplierContactPerson: getString(formData, 'supplierContactPerson'),
    supplierNotes: getString(formData, 'supplierNotes'),
    referenceCode: getString(formData, 'referenceCode'),
    priceRating: getString(formData, 'priceRating') ? Number(getString(formData, 'priceRating')) : undefined,
    stockQualityRating: getString(formData, 'stockQualityRating') ? Number(getString(formData, 'stockQualityRating')) : undefined,
    availabilityRating: getString(formData, 'availabilityRating') ? Number(getString(formData, 'availabilityRating')) : undefined,
    ratingNote: getString(formData, 'ratingNote'),
    items: parseDeliveryItems(formData),
  })

  if (!validation.success) {
    return { success: false, error: validation.error.errors[0]?.message ?? 'Invalid delivery data' }
  }

  const businessId = profile.business_id

  if (!businessId) {
    logger.error('recordSupplierDelivery: missing business id', { userId: profile.id })
    return { success: false, error: 'Business context missing' }
  }

  try {
    const supabase = await createClient()
    const { error } = await supabase.rpc('dashboard_record_supplier_delivery', {
      p_branch_id: validation.data.branchId,
      p_supplier_name: validation.data.supplierName,
      p_reference_code: validation.data.referenceCode,
      p_items: validation.data.items,
      p_supplier_id: validation.data.supplierId || null,
      p_supplier_phone: validation.data.supplierPhone || null,
      p_supplier_email: validation.data.supplierEmail || null,
      p_supplier_contact_person: validation.data.supplierContactPerson || null,
      p_supplier_notes: validation.data.supplierNotes || null,
      p_price_rating: validation.data.priceRating ?? null,
      p_stock_quality_rating: validation.data.stockQualityRating ?? null,
      p_availability_rating: validation.data.availabilityRating ?? null,
      p_rating_note: validation.data.ratingNote || null,
    })

    if (error) {
      logger.error('recordSupplierDelivery: RPC failed', {
        businessId,
        branchId: validation.data.branchId,
        error,
      })
      return { success: false, error: error.message ?? 'Unable to record delivery' }
    }

    revalidateStockRoutes()
    logger.info('Supplier delivery recorded', {
      businessId,
      branchId: validation.data.branchId,
      actor: profile.id,
      effectiveRole,
    })
    return { success: true, error: null }
  } catch (error: unknown) {
    logger.error('recordSupplierDelivery: unexpected error', { businessId, error })
    return { success: false, error: error instanceof Error ? error.message : 'Server error' }
  }
}

/**
 * Updates a low-stock threshold for a branch stock row.
 */
export async function updateLowStockThreshold(_prevState: FormState, formData: FormData): Promise<FormState> {
  const profile = await requireRole([GlobalRole.Owner, GlobalRole.Admin])
  const branchId = getString(formData, 'branchId')

  if (!z.string().uuid().safeParse(branchId).success) {
    return { success: false, error: 'Select a valid branch' }
  }

  const effectiveRole = await assertBranchAccess(profile.id, branchId, 'admin', 'update_low_stock_threshold')

  const validation = updateThresholdSchema.safeParse({
    stockId: getString(formData, 'stockId'),
    branchId,
    threshold: Number(getString(formData, 'threshold')),
  })

  if (!validation.success) {
    return { success: false, error: validation.error.errors[0]?.message ?? 'Invalid threshold data' }
  }

  const businessId = profile.business_id

  if (!businessId) {
    logger.error('updateLowStockThreshold: missing business id', { userId: profile.id })
    return { success: false, error: 'Business context missing' }
  }

  try {
    const supabase = await createClient()
    const { error } = await supabase.rpc('dashboard_update_low_stock_threshold', {
      p_stock_id: validation.data.stockId,
      p_branch_id: validation.data.branchId,
      p_threshold: validation.data.threshold,
    })

    if (error) {
      logger.error('updateLowStockThreshold: RPC failed', {
        businessId,
        stockId: validation.data.stockId,
        branchId: validation.data.branchId,
        error,
      })
      return { success: false, error: error.message ?? 'Unable to update threshold' }
    }

    revalidateStockRoutes()
    logger.info('Low stock threshold updated', {
      businessId,
      stockId: validation.data.stockId,
      branchId: validation.data.branchId,
      actor: profile.id,
      effectiveRole,
    })
    return { success: true, error: null }
  } catch (error: unknown) {
    logger.error('updateLowStockThreshold: unexpected error', { businessId, error })
    return { success: false, error: error instanceof Error ? error.message : 'Server error' }
  }
}

/**
 * Edits a supplier delivery immediately for owners; admins create an owner approval request.
 */
export async function requestSupplierDeliveryEdit(_prevState: FormState, formData: FormData): Promise<FormState> {
  const profile = await requireRole([GlobalRole.Owner, GlobalRole.Admin])
  const branchId = getString(formData, 'branchId')

  if (!z.string().uuid().safeParse(branchId).success) {
    return { success: false, error: 'Select a valid branch' }
  }

  await assertBranchAccess(profile.id, branchId, 'admin', 'request_supplier_delivery_edit')

  const validation = editDeliverySchema.safeParse({
    deliveryId: getString(formData, 'deliveryId'),
    branchId,
    supplierName: getString(formData, 'supplierName'),
    referenceCode: getString(formData, 'referenceCode'),
    reason: getString(formData, 'reason'),
    items: parseDeliveryEditItems(formData),
  })

  if (!validation.success) {
    return { success: false, error: validation.error.errors[0]?.message ?? 'Invalid delivery edit' }
  }

  const businessId = profile.business_id

  if (!businessId) {
    logger.error('requestSupplierDeliveryEdit: missing business id', { userId: profile.id })
    return { success: false, error: 'Business context missing' }
  }

  try {
    const supabase = await createClient()
    const { error } = await supabase.rpc('dashboard_request_supplier_delivery_edit', {
      p_delivery_id: validation.data.deliveryId,
      p_supplier_name: validation.data.supplierName,
      p_reference_code: validation.data.referenceCode,
      p_items: validation.data.items,
      p_reason: validation.data.reason,
    })

    if (error) {
      logger.error('requestSupplierDeliveryEdit: RPC failed', { businessId, deliveryId: validation.data.deliveryId, error })
      return { success: false, error: error.message ?? 'Unable to edit delivery' }
    }

    revalidateStockRoutes()
    logger.info('Supplier delivery edit submitted', { businessId, deliveryId: validation.data.deliveryId, actor: profile.id })
    return { success: true, error: null }
  } catch (error: unknown) {
    logger.error('requestSupplierDeliveryEdit: unexpected error', { businessId, error })
    return { success: false, error: error instanceof Error ? error.message : 'Server error' }
  }
}

/**
 * Owner reviews an admin-submitted supplier delivery edit request.
 */
export async function reviewSupplierDeliveryEditRequest(_prevState: FormState, formData: FormData): Promise<FormState> {
  const profile = await requireRole([GlobalRole.Owner])
  const validation = deliveryEditReviewSchema.safeParse({
    requestId: getString(formData, 'requestId'),
    action: getString(formData, 'action'),
  })

  if (!validation.success) {
    return { success: false, error: validation.error.errors[0]?.message ?? 'Invalid delivery edit review' }
  }

  const businessId = profile.business_id

  if (!businessId) {
    logger.error('reviewSupplierDeliveryEditRequest: missing business id', { userId: profile.id })
    return { success: false, error: 'Business context missing' }
  }

  try {
    const supabase = await createClient()
    const { error } = await supabase.rpc('dashboard_review_supplier_delivery_edit_request', {
      p_request_id: validation.data.requestId,
      p_action: validation.data.action,
    })

    if (error) {
      logger.error('reviewSupplierDeliveryEditRequest: RPC failed', { businessId, requestId: validation.data.requestId, error })
      return { success: false, error: error.message ?? 'Unable to review delivery edit' }
    }

    revalidateStockRoutes()
    logger.info('Supplier delivery edit reviewed', { businessId, requestId: validation.data.requestId, action: validation.data.action, actor: profile.id })
    return { success: true, error: null }
  } catch (error: unknown) {
    logger.error('reviewSupplierDeliveryEditRequest: unexpected error', { businessId, error })
    return { success: false, error: error instanceof Error ? error.message : 'Server error' }
  }
}

/**
 * Approves an admin-requested supplier delivery.
 *
 * Owner approval does not increase stock yet; stock is applied only after the
 * destination branch acknowledges physical arrival.
 */
export async function approveSupplierDelivery(_prevState: FormState, formData: FormData): Promise<FormState> {
  const profile = await requireRole([GlobalRole.Owner])
  const validation = deliveryActionSchema.safeParse({
    deliveryId: getString(formData, 'deliveryId'),
  })

  if (!validation.success) {
    return { success: false, error: validation.error.errors[0]?.message ?? 'Invalid delivery' }
  }

  const businessId = profile.business_id

  if (!businessId) {
    logger.error('approveSupplierDelivery: missing business id', { userId: profile.id })
    return { success: false, error: 'Business context missing' }
  }

  try {
    const supabase = await createClient()
    const { error } = await supabase.rpc('dashboard_approve_supplier_delivery', {
      p_delivery_id: validation.data.deliveryId,
    })

    if (error) {
      logger.error('approveSupplierDelivery: RPC failed', { businessId, deliveryId: validation.data.deliveryId, error })
      return { success: false, error: error.message ?? 'Unable to approve delivery' }
    }

    revalidateStockRoutes()
    logger.info('Supplier delivery approved', { businessId, deliveryId: validation.data.deliveryId, actor: profile.id })
    return { success: true, error: null }
  } catch (error: unknown) {
    logger.error('approveSupplierDelivery: unexpected error', { businessId, error })
    return { success: false, error: error instanceof Error ? error.message : 'Server error' }
  }
}

/**
 * Acknowledges an approved supplier delivery and applies stock to the branch.
 */
export async function acknowledgeSupplierDelivery(_prevState: FormState, formData: FormData): Promise<FormState> {
  const profile = await requireRole([GlobalRole.Owner, GlobalRole.Admin])
  const validation = deliveryActionSchema.safeParse({
    deliveryId: getString(formData, 'deliveryId'),
  })

  if (!validation.success) {
    return { success: false, error: validation.error.errors[0]?.message ?? 'Invalid delivery' }
  }

  const businessId = profile.business_id

  if (!businessId) {
    logger.error('acknowledgeSupplierDelivery: missing business id', { userId: profile.id })
    return { success: false, error: 'Business context missing' }
  }

  try {
    const supabase = await createClient()
    const { error } = await supabase.rpc('dashboard_acknowledge_supplier_delivery', {
      p_delivery_id: validation.data.deliveryId,
    })

    if (error) {
      logger.error('acknowledgeSupplierDelivery: RPC failed', { businessId, deliveryId: validation.data.deliveryId, error })
      return { success: false, error: error.message ?? 'Unable to acknowledge delivery' }
    }

    revalidateStockRoutes()
    logger.info('Supplier delivery acknowledged', { businessId, deliveryId: validation.data.deliveryId, actor: profile.id })
    return { success: true, error: null }
  } catch (error: unknown) {
    logger.error('acknowledgeSupplierDelivery: unexpected error', { businessId, error })
    return { success: false, error: error instanceof Error ? error.message : 'Server error' }
  }
}

/**
 * Manual stock adjustment is retained only as an owner-level emergency action.
 */
export async function adjustStock(_prevState: FormState, formData: FormData): Promise<FormState> {
  const profile = await requireRole([GlobalRole.Owner])
  const branchId = getString(formData, 'branchId')

  if (!z.string().uuid().safeParse(branchId).success) {
    return { success: false, error: 'Select a valid branch' }
  }

  await assertBranchAccess(profile.id, branchId, 'owner', 'manual_stock_adjustment')

  const validation = manualAdjustmentSchema.safeParse({
    stockId: getString(formData, 'stockId'),
    branchId,
    quantity: Number(getString(formData, 'quantity')),
    operation: getString(formData, 'operation'),
    reason: getString(formData, 'reason'),
  })

  if (!validation.success) {
    return { success: false, error: validation.error.errors[0]?.message ?? 'Invalid stock adjustment' }
  }

  return {
    success: false,
    error: 'Manual stock adjustment is disabled in this workflow. Record a supplier delivery or transfer instead.',
  }
}
