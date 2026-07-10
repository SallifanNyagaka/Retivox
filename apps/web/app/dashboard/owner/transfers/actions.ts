/**
 * Server actions for the owner transfers page.
 *
 * These actions handle transfer creation, approval, and receipt workflows.
 * All writes are validated, audited, and scoped to the current owner's business.
 */

'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { GlobalRole } from '@smartretail/shared'
import { requireRole } from '../../../../lib/auth/helpers'
import { assertBranchAccess, getEffectiveRole, hasMinimumBranchRole } from '../../../../lib/auth/branchAccess'
import { createClient } from '../../../../lib/supabase/server'
import logger from '../../../../lib/logger'
import type { FormState } from './types'
export type { FormState } from './types'

/**
 * Parsed transfer item input from the modal form.
 */
type TransferDraftItem = {
  productId: string
  uomId: string
  quantity: number
}

/**
 * Form schema for initiating a transfer.
 */
const initiateTransferSchema = z
  .object({
    fromBranchId: z.string().min(1, 'Select a source branch'),
    toBranchId: z.string().min(1, 'Select a destination branch'),
    notes: z.string().max(1000).optional().default(''),
    items: z.array(
      z.object({
        productId: z.string().min(1, 'Select a product'),
        uomId: z.string().uuid('Select a unit'),
        quantity: z.number().positive('Quantity must be greater than zero'),
      })
    ),
  })
  .refine(
    (value: {
      fromBranchId: string
      toBranchId: string
      notes: string
      items: Array<{ productId: string; uomId: string; quantity: number }>
    }) => value.fromBranchId !== value.toBranchId,
    {
      message: 'Source and destination branches must be different',
      path: ['toBranchId'],
    }
  )
  .refine(
    (value: {
      fromBranchId: string
      toBranchId: string
      notes: string
      items: Array<{ productId: string; uomId: string; quantity: number }>
    }) => value.items.length > 0,
    {
      message: 'Add at least one product',
      path: ['items'],
    }
  )

/**
 * Safely reads a string field from FormData.
 */
function getString(formData: FormData, key: string): string {
  const value = formData.get(key)
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Parses dynamic item rows from FormData.
 */
function parseDraftItems(formData: FormData): TransferDraftItem[] {
  const count = Number(formData.get('itemsCount') ?? 0)
  const safeCount = Number.isFinite(count) && count > 0 ? count : 0
  const items: TransferDraftItem[] = []

  for (let index = 0; index < safeCount; index += 1) {
    const productId = getString(formData, `productId_${index}`)
    const uomId = getString(formData, `uomId_${index}`)
    const quantityValue = getString(formData, `quantity_${index}`)
    const quantity = Number(quantityValue)

    if (!productId && !quantityValue) {
      continue
    }

    items.push({
      productId,
      uomId,
      quantity,
    })
  }

  return items
}

/**
 * Initiates a new stock transfer and reserves source inventory.
 */
export async function initiateTransfer(_prevState: FormState, formData: FormData): Promise<FormState> {
  const profile = await requireRole([GlobalRole.Owner, GlobalRole.Admin])
  const businessId = profile.business_id

  if (!businessId) {
    return { success: false, error: 'Business context missing' }
  }

  const fromBranchId = getString(formData, 'fromBranchId')
  const toBranchId = getString(formData, 'toBranchId')
  const notes = getString(formData, 'notes')
  const items = parseDraftItems(formData)

  const parsedItems = items.map((item) => ({
    productId: item.productId,
    uomId: item.uomId,
    quantity: Number(item.quantity),
  }))

  const validation = initiateTransferSchema.safeParse({
    fromBranchId,
    toBranchId,
    notes,
    items: parsedItems,
  })

  if (!validation.success) {
    return {
      success: false,
      error: validation.error.errors[0]?.message ?? 'Invalid transfer data',
    }
  }

  const supabase = await createClient()
  try {
    const sourceRole = await getEffectiveRole(profile.id, validation.data.fromBranchId)
    const destinationRole = await getEffectiveRole(profile.id, validation.data.toBranchId)

    if (!hasMinimumBranchRole(sourceRole, 'admin') && !hasMinimumBranchRole(destinationRole, 'admin')) {
      await assertBranchAccess(profile.id, validation.data.fromBranchId, 'admin', 'initiate_stock_transfer')
    }

    const { data: transferId, error } = await supabase.rpc('dashboard_initiate_stock_transfer', {
      p_from_branch_id: validation.data.fromBranchId,
      p_to_branch_id: validation.data.toBranchId,
      p_items: validation.data.items,
      p_notes: validation.data.notes,
    })

    if (error || !transferId) {
      logger.error('initiateTransfer: RPC failed', { businessId, error })
      return { success: false, error: error?.message ?? 'Unable to create transfer' }
    }

    revalidatePath('/dashboard/owner/transfers')
    revalidatePath('/dashboard/admin/transfers')
    revalidatePath('/dashboard/owner/stock')
    revalidatePath('/dashboard/admin/stock')
    logger.info('Stock transfer initiated', { businessId, transferId, actor: profile.id })
    return { success: true, error: null }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    logger.error('initiateTransfer: unexpected error', { businessId, error: message })
    return { success: false, error: message }
  }
}

/**
 * Approves a previously initiated transfer and moves it to in_transit.
 */
export async function approveTransfer(transferId: string): Promise<FormState> {
  const profile = await requireRole([GlobalRole.Owner])
  const businessId = profile.business_id

  if (!businessId) {
    return { success: false, error: 'Business context missing' }
  }

  const validation = z.string().uuid().safeParse(transferId)
  if (!validation.success) {
    return { success: false, error: 'Invalid transfer id' }
  }

  const supabase = await createClient()

  try {
    const { data: transferRow, error: transferError } = await supabase
      .from('stock_transfers')
      .select('id, from_branch_id, to_branch_id')
      .eq('business_id', businessId)
      .eq('id', validation.data)
      .maybeSingle()

    if (transferError) {
      logger.error('approveTransfer: transfer lookup failed', { businessId, transferId: validation.data, error: transferError })
      return { success: false, error: transferError.message ?? 'Unable to load transfer' }
    }

    const transfer = transferRow as { id: string; from_branch_id: string; to_branch_id: string } | null

    if (!transfer) {
      return { success: false, error: 'Transfer not found' }
    }

    await assertBranchAccess(profile.id, transfer.from_branch_id, 'owner', 'approve_stock_transfer')
    await assertBranchAccess(profile.id, transfer.to_branch_id, 'owner', 'approve_stock_transfer')

    const { error } = await supabase.rpc('dashboard_approve_stock_transfer', {
      p_transfer_id: validation.data,
    })

    if (error) {
      logger.error('approveTransfer: RPC failed', { businessId, transferId: validation.data, error })
      return { success: false, error: error.message ?? 'Unable to approve transfer' }
    }

    revalidatePath('/dashboard/owner/transfers')
    revalidatePath('/dashboard/admin/transfers')
    revalidatePath('/dashboard/owner/stock')
    revalidatePath('/dashboard/admin/stock')
    return { success: true, error: null }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    logger.error('approveTransfer: unexpected error', { businessId, transferId, error: message })
    return { success: false, error: message }
  }
}

/**
 * Server action wrapper for approving a transfer from a form submit.
 */
export async function approveTransferAction(_prevState: FormState, formData: FormData): Promise<FormState> {
  await requireRole([GlobalRole.Owner])
  const transferId = getString(formData, 'transferId')
  if (!transferId) {
    return { success: false, error: 'Missing transfer id' }
  }

  return approveTransfer(transferId)
}

/**
 * Marks a transfer as received and finalizes inventory movement.
 */
export async function markTransferReceived(transferId: string): Promise<FormState> {
  const profile = await requireRole([GlobalRole.Owner, GlobalRole.Admin])
  const businessId = profile.business_id

  if (!businessId) {
    return { success: false, error: 'Business context missing' }
  }

  const validation = z.string().uuid().safeParse(transferId)
  if (!validation.success) {
    return { success: false, error: 'Invalid transfer id' }
  }

  const supabase = await createClient()

  try {
    const { data: transferRow, error: transferError } = await supabase
      .from('stock_transfers')
      .select('id, to_branch_id')
      .eq('business_id', businessId)
      .eq('id', validation.data)
      .maybeSingle()

    if (transferError) {
      logger.error('markTransferReceived: transfer lookup failed', { businessId, transferId: validation.data, error: transferError })
      return { success: false, error: transferError.message ?? 'Unable to load transfer' }
    }

    const transfer = transferRow as { id: string; to_branch_id: string } | null

    if (!transfer) {
      return { success: false, error: 'Transfer not found' }
    }

    await assertBranchAccess(profile.id, transfer.to_branch_id, 'admin', 'receive_stock_transfer')

    const { error } = await supabase.rpc('dashboard_mark_stock_transfer_received', {
      p_transfer_id: validation.data,
    })

    if (error) {
      logger.error('markTransferReceived: RPC failed', { businessId, transferId: validation.data, error })
      return { success: false, error: error.message ?? 'Unable to mark transfer as received' }
    }

    revalidatePath('/dashboard/owner/transfers')
    revalidatePath('/dashboard/admin/transfers')
    revalidatePath('/dashboard/owner/stock')
    revalidatePath('/dashboard/admin/stock')
    return { success: true, error: null }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    logger.error('markTransferReceived: unexpected error', { businessId, transferId, error: message })
    return { success: false, error: message }
  }
}

/**
 * Server action wrapper for receiving a transfer from a form submit.
 */
export async function markTransferReceivedAction(_prevState: FormState, formData: FormData): Promise<FormState> {
  await requireRole([GlobalRole.Owner, GlobalRole.Admin])
  const transferId = getString(formData, 'transferId')
  if (!transferId) {
    return { success: false, error: 'Missing transfer id' }
  }

  return markTransferReceived(transferId)
}
