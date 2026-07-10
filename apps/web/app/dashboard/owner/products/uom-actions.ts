'use server'
/**
 * Server Actions for product Unit of Measure management.
 *
 * These actions validate form data, authorize owner/admin users, delegate
 * tenant-safe writes to UOM server helpers, and return useActionState-friendly
 * success/error payloads for product dashboard forms.
 */

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { GlobalRole } from '@smartretail/shared'
import { requireRole } from '../../../../lib/auth/helpers'
import logger from '../../../../lib/logger'
import { createClient } from '../../../../lib/supabase/server'
import { createUOM, linkUOMToProduct } from '../../../../lib/uom/server'

/**
 * Form state returned by UOM server actions.
 */
export type FormState = {
  success: boolean
  error: string | null
  data?: unknown
}

/**
 * Validates new UOM creation requests.
 */
const addUOMSchema = z.object({
  name: z.string().trim().min(2, 'Unit name must be at least 2 characters').max(120, 'Unit name is too long'),
  abbreviation: z.string().trim().min(1, 'Abbreviation is required').max(32, 'Abbreviation is too long'),
  conversionFactor: z.number().positive('Conversion factor must be greater than zero'),
  isBaseUnit: z.boolean(),
})

/**
 * Validates UOM edit requests.
 */
const updateUOMSchema = addUOMSchema.extend({
  uomId: z.string().uuid('Select a valid unit'),
})

/**
 * Validates product/UOM link requests.
 */
const linkUOMToProductSchema = z.object({
  productId: z.string().uuid('Select a valid product'),
  uomId: z.string().uuid('Select a valid unit'),
})

/**
 * Validates unused UOM deactivation requests.
 */
const deactivateUOMSchema = z.object({
  uomId: z.string().uuid('Select a valid unit'),
})

/**
 * Reads a trimmed string from FormData.
 */
function getString(formData: FormData, key: string): string {
  const value = formData.get(key)
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Reads a finite number from FormData.
 */
function getNumber(formData: FormData, key: string): number {
  const value = formData.get(key)
  const parsed = typeof value === 'string' ? Number(value) : Number.NaN
  return Number.isFinite(parsed) ? parsed : Number.NaN
}

/**
 * Reads a checkbox-style boolean from FormData.
 */
function getBoolean(formData: FormData, key: string): boolean {
  const value = formData.get(key)
  return value === 'on' || value === 'true' || value === '1'
}

/**
 * Revalidates product routes that depend on UOM state.
 */
function revalidateProductUOMRoutes(): void {
  revalidatePath('/dashboard/owner/products')
  revalidatePath('/dashboard/admin/products')
  revalidatePath('/dashboard/owner/stock')
  revalidatePath('/dashboard/admin/stock')
  revalidatePath('/dashboard/employee/transactions/new')
}

/**
 * Creates a Unit of Measure for the current user's business.
 */
export async function addUOMAction(_prevState: FormState, formData: FormData): Promise<FormState> {
  const profile = await requireRole([GlobalRole.Owner, GlobalRole.Admin])
  const businessId = profile.business_id

  if (!businessId) {
    logger.error('addUOMAction: missing business id', { userId: profile.id })
    return { success: false, error: 'Business context missing' }
  }

  const validation = addUOMSchema.safeParse({
    name: getString(formData, 'name'),
    abbreviation: getString(formData, 'abbreviation'),
    conversionFactor: getNumber(formData, 'conversionFactor'),
    isBaseUnit: getBoolean(formData, 'isBaseUnit'),
  })

  if (!validation.success) {
    return {
      success: false,
      error: validation.error.errors[0]?.message ?? 'Invalid unit of measure data',
    }
  }

  try {
    const uomId = await createUOM(
      {
        businessId,
        name: validation.data.name,
        abbreviation: validation.data.abbreviation,
        conversionFactor: validation.data.conversionFactor,
        isBaseUnit: validation.data.isBaseUnit,
      },
      profile.id
    )

    revalidateProductUOMRoutes()
    logger.info('UOM action created unit', { businessId, uomId, actor: profile.id })

    return {
      success: true,
      error: null,
      data: { uomId },
    }
  } catch (error: unknown) {
    logger.error('addUOMAction failed', { businessId, actor: profile.id, error })
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unable to create unit of measure',
    }
  }
}

/**
 * Updates a Unit of Measure label/conversion safely for the current business.
 */
export async function updateUOMAction(_prevState: FormState, formData: FormData): Promise<FormState> {
  const profile = await requireRole([GlobalRole.Owner, GlobalRole.Admin])
  const businessId = profile.business_id

  if (!businessId) {
    logger.error('updateUOMAction: missing business id', { userId: profile.id })
    return { success: false, error: 'Business context missing' }
  }

  const validation = updateUOMSchema.safeParse({
    uomId: getString(formData, 'uomId'),
    name: getString(formData, 'name'),
    abbreviation: getString(formData, 'abbreviation'),
    conversionFactor: getNumber(formData, 'conversionFactor'),
    isBaseUnit: getBoolean(formData, 'isBaseUnit'),
  })

  if (!validation.success) {
    return {
      success: false,
      error: validation.error.errors[0]?.message ?? 'Invalid unit of measure data',
    }
  }

  try {
    const supabase = await createClient()
    const { data: unitData, error: unitError } = await supabase
      .from('units_of_measure')
      .select('id, name, abbreviation, conversion_factor, is_base_unit, is_active')
      .eq('business_id', businessId)
      .eq('id', validation.data.uomId)
      .maybeSingle()

    if (unitError) {
      logger.error('updateUOMAction: UOM lookup failed', { businessId, uomId: validation.data.uomId, error: unitError })
      return { success: false, error: unitError.message ?? 'Unable to load unit' }
    }

    const unit = unitData as {
      id: string
      name: string
      abbreviation: string
      conversion_factor: string | number
      is_base_unit: boolean
      is_active: boolean
    } | null

    if (!unit) {
      return { success: false, error: 'Unit not found' }
    }

    const duplicateNameResponse = await supabase
      .from('units_of_measure')
      .select('id', { count: 'exact', head: true })
      .eq('business_id', businessId)
      .eq('name', validation.data.name)
      .neq('id', unit.id)

    if (duplicateNameResponse.error) {
      logger.error('updateUOMAction: duplicate lookup failed', { businessId, uomId: unit.id, error: duplicateNameResponse.error })
      return { success: false, error: 'Unable to verify the unit name' }
    }

    if ((duplicateNameResponse.count ?? 0) > 0) {
      return { success: false, error: 'A unit with this name already exists' }
    }

    if (validation.data.isBaseUnit) {
      const baseResponse = await supabase
        .from('units_of_measure')
        .select('id', { count: 'exact', head: true })
        .eq('business_id', businessId)
        .eq('is_base_unit', true)
        .eq('is_active', true)
        .neq('id', unit.id)

      if (baseResponse.error) {
        logger.error('updateUOMAction: base unit lookup failed', { businessId, uomId: unit.id, error: baseResponse.error })
        return { success: false, error: 'Unable to verify the base unit' }
      }

      if ((baseResponse.count ?? 0) > 0) {
        return { success: false, error: 'A base unit already exists for this business' }
      }
    }

    const previousConversionFactor = Number(unit.conversion_factor)
    const conversionChanged = Math.abs(previousConversionFactor - validation.data.conversionFactor) > 0.0001

    if (conversionChanged) {
      const [{ count: transactionCount, error: transactionError }, { count: deliveryCount, error: deliveryError }] = await Promise.all([
        supabase
          .from('transaction_items')
          .select('id', { count: 'exact', head: true })
          .eq('business_id', businessId)
          .eq('uom_id', unit.id),
        supabase
          .from('supplier_delivery_items')
          .select('id', { count: 'exact', head: true })
          .eq('business_id', businessId)
          .eq('uom_id', unit.id),
      ])

      if (transactionError || deliveryError) {
        logger.error('updateUOMAction: historical usage lookup failed', {
          businessId,
          uomId: unit.id,
          transactionError,
          deliveryError,
        })
        return { success: false, error: 'Unable to verify historical unit usage' }
      }

      if ((transactionCount ?? 0) > 0 || (deliveryCount ?? 0) > 0) {
        return {
          success: false,
          error: 'This unit already has sales or delivery history. Create a new unit instead of changing its conversion factor.',
        }
      }
    }

    const { error: updateError } = await supabase
      .from('units_of_measure')
      .update({
        name: validation.data.name,
        abbreviation: validation.data.abbreviation,
        conversion_factor: validation.data.conversionFactor,
        is_base_unit: validation.data.isBaseUnit,
      })
      .eq('business_id', businessId)
      .eq('id', unit.id)

    if (updateError) {
      logger.error('updateUOMAction: update failed', { businessId, uomId: unit.id, error: updateError })
      return { success: false, error: updateError.message ?? 'Unable to update unit' }
    }

    revalidateProductUOMRoutes()
    logger.info('UOM updated', { businessId, uomId: unit.id, actor: profile.id })

    return {
      success: true,
      error: null,
      data: { uomId: unit.id },
    }
  } catch (error: unknown) {
    logger.error('updateUOMAction failed', { businessId, actor: profile.id, error })
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unable to update unit',
    }
  }
}

/**
 * Links an existing Unit of Measure to a product.
 */
export async function linkUOMToProductAction(_prevState: FormState, formData: FormData): Promise<FormState> {
  const profile = await requireRole([GlobalRole.Owner, GlobalRole.Admin])
  const businessId = profile.business_id

  if (!businessId) {
    logger.error('linkUOMToProductAction: missing business id', { userId: profile.id })
    return { success: false, error: 'Business context missing' }
  }

  const validation = linkUOMToProductSchema.safeParse({
    productId: getString(formData, 'productId'),
    uomId: getString(formData, 'uomId'),
  })

  if (!validation.success) {
    return {
      success: false,
      error: validation.error.errors[0]?.message ?? 'Invalid product unit data',
    }
  }

  try {
    const linkId = await linkUOMToProduct(
      validation.data.productId,
      validation.data.uomId,
      businessId,
      profile.id
    )

    revalidateProductUOMRoutes()
    logger.info('UOM action linked unit to product', {
      businessId,
      productId: validation.data.productId,
      uomId: validation.data.uomId,
      actor: profile.id,
    })

    return {
      success: true,
      error: null,
      data: { linkId },
    }
  } catch (error: unknown) {
    logger.error('linkUOMToProductAction failed', { businessId, actor: profile.id, error })
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unable to link unit to product',
    }
  }
}

/**
 * Deactivates an unused unit of measure. Linked or historically referenced
 * units are kept to protect product, stock, and transaction history.
 */
export async function deactivateUnusedUOMAction(_prevState: FormState, formData: FormData): Promise<FormState> {
  const profile = await requireRole([GlobalRole.Owner])
  const businessId = profile.business_id

  if (!businessId) {
    logger.error('deactivateUnusedUOMAction: missing business id', { userId: profile.id })
    return { success: false, error: 'Business context missing' }
  }

  const validation = deactivateUOMSchema.safeParse({
    uomId: getString(formData, 'uomId'),
  })

  if (!validation.success) {
    return {
      success: false,
      error: validation.error.errors[0]?.message ?? 'Invalid unit of measure',
    }
  }

  try {
    const supabase = await createClient()
    const { data: uomData, error: uomError } = await supabase
      .from('units_of_measure')
      .select('id, name, is_base_unit, is_active')
      .eq('business_id', businessId)
      .eq('id', validation.data.uomId)
      .maybeSingle()

    if (uomError) {
      logger.error('deactivateUnusedUOMAction: UOM lookup failed', { businessId, uomId: validation.data.uomId, error: uomError })
      return { success: false, error: uomError.message ?? 'Unable to load unit' }
    }

    const unit = uomData as { id: string; name: string; is_base_unit: boolean; is_active: boolean } | null

    if (!unit) {
      return { success: false, error: 'Unit not found' }
    }

    if (!unit.is_active) {
      return { success: false, error: `${unit.name} is already inactive` }
    }

    const [{ count: linkedProductCount, error: linkError }, { count: transactionCount, error: transactionError }, { count: deliveryCount, error: deliveryError }] = await Promise.all([
      supabase
        .from('product_uom_links')
        .select('id', { count: 'exact', head: true })
        .eq('business_id', businessId)
        .eq('uom_id', unit.id),
      supabase
        .from('transaction_items')
        .select('id', { count: 'exact', head: true })
        .eq('business_id', businessId)
        .eq('uom_id', unit.id),
      supabase
        .from('supplier_delivery_items')
        .select('id', { count: 'exact', head: true })
        .eq('business_id', businessId)
        .eq('uom_id', unit.id),
    ])

    if (linkError || transactionError || deliveryError) {
      logger.error('deactivateUnusedUOMAction: usage lookup failed', {
        businessId,
        uomId: unit.id,
        linkError,
        transactionError,
        deliveryError,
      })
      return { success: false, error: 'Unable to verify whether this unit is used' }
    }

    if ((linkedProductCount ?? 0) > 0 || (transactionCount ?? 0) > 0 || (deliveryCount ?? 0) > 0) {
      return {
        success: false,
        error: `${unit.name} is still linked or referenced. Remove it from products first; historical sale/delivery units are preserved.`,
      }
    }

    const { error: updateError } = await supabase
      .from('units_of_measure')
      .update({ is_active: false })
      .eq('business_id', businessId)
      .eq('id', unit.id)

    if (updateError) {
      logger.error('deactivateUnusedUOMAction: update failed', { businessId, uomId: unit.id, error: updateError })
      return { success: false, error: updateError.message ?? 'Unable to remove unit' }
    }

    revalidateProductUOMRoutes()
    logger.info('Unused UOM deactivated', { businessId, uomId: unit.id, actor: profile.id })
    return { success: true, error: null, data: { uomId: unit.id, name: unit.name } }
  } catch (error: unknown) {
    logger.error('deactivateUnusedUOMAction failed', { businessId, actor: profile.id, error })
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unable to remove unit',
    }
  }
}

/**
 * Permanently deletes an unused UOM. Any product link or historical usage
 * blocks deletion so transaction and stock records remain auditable.
 */
export async function deleteUnusedUOMAction(_prevState: FormState, formData: FormData): Promise<FormState> {
  const profile = await requireRole([GlobalRole.Owner])
  const businessId = profile.business_id

  if (!businessId) {
    logger.error('deleteUnusedUOMAction: missing business id', { userId: profile.id })
    return { success: false, error: 'Business context missing' }
  }

  const validation = deactivateUOMSchema.safeParse({
    uomId: getString(formData, 'uomId'),
  })

  if (!validation.success) {
    return {
      success: false,
      error: validation.error.errors[0]?.message ?? 'Invalid unit of measure',
    }
  }

  try {
    const supabase = await createClient()
    const { data: uomData, error: uomError } = await supabase
      .from('units_of_measure')
      .select('id, name, abbreviation, conversion_factor, is_base_unit, is_active')
      .eq('business_id', businessId)
      .eq('id', validation.data.uomId)
      .maybeSingle()

    if (uomError) {
      logger.error('deleteUnusedUOMAction: UOM lookup failed', { businessId, uomId: validation.data.uomId, error: uomError })
      return { success: false, error: uomError.message ?? 'Unable to load unit' }
    }

    const unit = uomData as {
      id: string
      name: string
      abbreviation: string
      conversion_factor: string | number
      is_base_unit: boolean
      is_active: boolean
    } | null

    if (!unit) {
      return { success: false, error: 'Unit not found' }
    }

    const [{ count: linkedProductCount, error: linkError }, { count: transactionCount, error: transactionError }, { count: deliveryCount, error: deliveryError }] = await Promise.all([
      supabase
        .from('product_uom_links')
        .select('id', { count: 'exact', head: true })
        .eq('business_id', businessId)
        .eq('uom_id', unit.id),
      supabase
        .from('transaction_items')
        .select('id', { count: 'exact', head: true })
        .eq('business_id', businessId)
        .eq('uom_id', unit.id),
      supabase
        .from('supplier_delivery_items')
        .select('id', { count: 'exact', head: true })
        .eq('business_id', businessId)
        .eq('uom_id', unit.id),
    ])

    if (linkError || transactionError || deliveryError) {
      logger.error('deleteUnusedUOMAction: usage lookup failed', {
        businessId,
        uomId: unit.id,
        linkError,
        transactionError,
        deliveryError,
      })
      return { success: false, error: 'Unable to verify whether this unit is used' }
    }

    if ((linkedProductCount ?? 0) > 0 || (transactionCount ?? 0) > 0 || (deliveryCount ?? 0) > 0) {
      return {
        success: false,
        error: `${unit.name} cannot be permanently deleted because it is linked or referenced in history.`,
      }
    }

    const { error: auditError } = await supabase.from('audit_logs').insert({
      business_id: businessId,
      actor_id: profile.id,
      entity_type: 'units_of_measure',
      entity_id: unit.id,
      action: 'permanently_deleted',
      old_value: {
        name: unit.name,
        abbreviation: unit.abbreviation,
        conversion_factor: unit.conversion_factor,
        is_base_unit: unit.is_base_unit,
        is_active: unit.is_active,
      },
      new_value: null,
    })

    if (auditError) {
      logger.error('deleteUnusedUOMAction: audit insert failed', { businessId, uomId: unit.id, error: auditError })
      return { success: false, error: auditError.message ?? 'Unable to audit unit deletion' }
    }

    const { error: deleteError } = await supabase
      .from('units_of_measure')
      .delete()
      .eq('business_id', businessId)
      .eq('id', unit.id)

    if (deleteError) {
      logger.error('deleteUnusedUOMAction: delete failed', { businessId, uomId: unit.id, error: deleteError })
      return { success: false, error: deleteError.message ?? 'Unable to permanently delete unit' }
    }

    revalidateProductUOMRoutes()
    logger.info('Unused UOM permanently deleted', { businessId, uomId: unit.id, actor: profile.id })
    return { success: true, error: null, data: { uomId: unit.id, name: unit.name } }
  } catch (error: unknown) {
    logger.error('deleteUnusedUOMAction failed', { businessId, actor: profile.id, error })
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unable to permanently delete unit',
    }
  }
}
