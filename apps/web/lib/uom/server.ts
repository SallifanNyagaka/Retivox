/**
 * Server-side Unit of Measure data access for Retivox.
 *
 * These helpers are used by Server Components and Server Actions only. They
 * keep UOM reads and mutations tenant-scoped, audited, and typed without using
 * Supabase generics on `.from()` calls.
 */

import logger from '../logger'
import { createClient } from '../supabase/server'

/**
 * Unit of Measure row exposed to dashboard components.
 */
export type UnitOfMeasure = {
  id: string
  businessId: string
  name: string
  abbreviation: string
  conversionFactor: number
  isBaseUnit: boolean
  isActive: boolean
  createdBy: string
  createdAt: string
}

/**
 * Product UOM link exposed to dashboard components.
 */
export type ProductUOMLink = {
  id: string
  productId: string
  uomId: string
  businessId: string
  isPurchaseUom: boolean
  isSaleUom: boolean
  isBaseUom: boolean
  isDefaultPurchaseUom: boolean
  isDefaultSaleUom: boolean
  createdAt: string
  uom: UnitOfMeasure | null
}

/**
 * Input needed to create a business-scoped UOM.
 */
export type CreateUOMParams = {
  businessId: string
  name: string
  abbreviation: string
  conversionFactor: number
  isBaseUnit: boolean
}

/**
 * Raw units_of_measure row returned by Supabase.
 */
type RawUnitOfMeasure = {
  id: string
  business_id: string
  name: string
  abbreviation: string
  conversion_factor: string | number
  is_base_unit: boolean
  is_active: boolean
  created_by: string
  created_at: string
}

/**
 * Raw product_uom_links row returned by Supabase.
 */
type RawProductUOMLink = {
  id: string
  product_id: string
  uom_id: string
  business_id: string
  is_purchase_uom?: boolean
  is_sale_uom?: boolean
  is_base_uom: boolean
  is_default_purchase_uom: boolean
  is_default_sale_uom: boolean
  created_at: string
  units_of_measure?: RawUnitOfMeasure | RawUnitOfMeasure[] | null
}

/**
 * Minimal actor row used for authorization checks.
 */
type ActorRow = {
  id: string
  business_id: string | null
  global_role: string
  is_active: boolean
  deleted_at?: string | null
}

/**
 * Minimal entity row used for tenant ownership validation.
 */
type BusinessScopedRow = {
  id: string
  business_id: string
}

/**
 * Converts a database UOM row into a UI-safe shape.
 */
function mapUnitOfMeasure(row: RawUnitOfMeasure): UnitOfMeasure {
  return {
    id: row.id,
    businessId: row.business_id,
    name: row.name,
    abbreviation: row.abbreviation,
    conversionFactor: Number(row.conversion_factor),
    isBaseUnit: row.is_base_unit,
    isActive: row.is_active,
    createdBy: row.created_by,
    createdAt: row.created_at,
  }
}

/**
 * Normalizes Supabase nested join results to an array shape.
 */
function normalizeJoin<Row>(value: Row | Row[] | null | undefined): Row[] {
  if (!value) {
    return []
  }

  return Array.isArray(value) ? value : [value]
}

/**
 * Converts a database product/UOM link row into a UI-safe shape.
 */
function mapProductUOMLink(row: RawProductUOMLink): ProductUOMLink {
  const uom = normalizeJoin(row.units_of_measure)?.[0] ?? null

  return {
    id: row.id,
    productId: row.product_id,
    uomId: row.uom_id,
    businessId: row.business_id,
    isPurchaseUom: row.is_purchase_uom ?? true,
    isSaleUom: row.is_sale_uom ?? true,
    isBaseUom: row.is_base_uom,
    isDefaultPurchaseUom: row.is_default_purchase_uom,
    isDefaultSaleUom: row.is_default_sale_uom,
    createdAt: row.created_at,
    uom: uom ? mapUnitOfMeasure(uom) : null,
  }
}

/**
 * Ensures the actor is an active owner/admin inside the requested business.
 */
async function assertActorCanManageUOM(actorId: string, businessId: string): Promise<void> {
  const supabase = await createClient()
  const actorResponse = await supabase
    .from('users')
    .select('id, business_id, global_role, is_active, deleted_at')
    .eq('id', actorId)
    .eq('business_id', businessId)
    .eq('is_active', true)
    .is('deleted_at', null)
    .single()

  if (actorResponse.error) {
    logger.error('assertActorCanManageUOM: actor lookup failed', { actorId, businessId, error: actorResponse.error })
    throw actorResponse.error
  }

  const actor = actorResponse.data as ActorRow | null

  if (!actor || actor.business_id !== businessId || !['owner', 'admin'].includes(actor.global_role)) {
    logger.warn('assertActorCanManageUOM: unauthorized actor', { actorId, businessId, role: actor?.global_role })
    throw new Error('Unauthorized')
  }
}

/**
 * Writes an explicit audit entry for a UOM-related mutation.
 */
async function writeUOMAuditLog(params: {
  businessId: string
  actorId: string
  entityType: 'units_of_measure' | 'product_uom_links'
  entityId: string
  action: string
  oldValue: Record<string, unknown> | null
  newValue: Record<string, unknown> | null
}): Promise<void> {
  const supabase = await createClient()
  const auditResponse = await supabase.from('audit_logs').insert({
    business_id: params.businessId,
    actor_id: params.actorId,
    entity_type: params.entityType,
    entity_id: params.entityId,
    action: params.action,
    old_value: params.oldValue,
    new_value: params.newValue,
  })

  if (auditResponse.error) {
    logger.error('writeUOMAuditLog failed', { businessId: params.businessId, entityId: params.entityId, error: auditResponse.error })
    throw auditResponse.error
  }
}

/**
 * Fetches all active UOMs for one business, ordered from base/smallest upward.
 */
export async function getUOMsForBusiness(businessId: string): Promise<UnitOfMeasure[]> {
  const supabase = await createClient()

  try {
    const response = await supabase
      .from('units_of_measure')
      .select('id, business_id, name, abbreviation, conversion_factor, is_base_unit, is_active, created_by, created_at')
      .eq('business_id', businessId)
      .eq('is_active', true)
      .order('conversion_factor', { ascending: true })
      .order('name', { ascending: true })

    if (response.error) {
      throw response.error
    }

    return ((response.data ?? []) as RawUnitOfMeasure[]).map(mapUnitOfMeasure)
  } catch (error: unknown) {
    logger.error('getUOMsForBusiness failed', { businessId, error })
    throw error
  }
}

/**
 * Fetches every UOM for one business, including inactive rows for owner library
 * management screens.
 */
export async function getAllUOMsForBusiness(businessId: string): Promise<UnitOfMeasure[]> {
  const supabase = await createClient()

  try {
    const response = await supabase
      .from('units_of_measure')
      .select('id, business_id, name, abbreviation, conversion_factor, is_base_unit, is_active, created_by, created_at')
      .eq('business_id', businessId)
      .order('is_active', { ascending: false })
      .order('conversion_factor', { ascending: true })
      .order('name', { ascending: true })

    if (response.error) {
      throw response.error
    }

    return ((response.data ?? []) as RawUnitOfMeasure[]).map(mapUnitOfMeasure)
  } catch (error: unknown) {
    logger.error('getAllUOMsForBusiness failed', { businessId, error })
    throw error
  }
}

/**
 * Fetches active UOM links for one product inside a business.
 */
export async function getUOMsForProduct(productId: string, businessId: string): Promise<ProductUOMLink[]> {
  const supabase = await createClient()

  try {
    const response = await supabase
      .from('product_uom_links')
      .select(
        `
        id,
        product_id,
        uom_id,
        business_id,
        is_purchase_uom,
        is_sale_uom,
        is_base_uom,
        is_default_purchase_uom,
        is_default_sale_uom,
        created_at,
        units_of_measure!inner(
          id,
          business_id,
          name,
          abbreviation,
          conversion_factor,
          is_base_unit,
          is_active,
          created_by,
          created_at
        )
      `
      )
      .eq('business_id', businessId)
      .eq('product_id', productId)
      .eq('units_of_measure.is_active', true)
      .order('is_base_uom', { ascending: false })
      .order('created_at', { ascending: true })

    if (response.error) {
      throw response.error
    }

    return ((response.data ?? []) as RawProductUOMLink[]).map(mapProductUOMLink)
  } catch (error: unknown) {
    logger.error('getUOMsForProduct failed', { productId, businessId, error })
    throw error
  }
}

/**
 * Creates a business-scoped UOM and writes an audit log.
 */
export async function createUOM(params: CreateUOMParams, actorId: string): Promise<string> {
  const supabase = await createClient()
  const name = params.name.trim()
  const abbreviation = params.abbreviation.trim()

  try {
    await assertActorCanManageUOM(actorId, params.businessId)

    if (params.conversionFactor <= 0) {
      throw new Error('Conversion factor must be greater than zero')
    }

    const duplicateResponse = await supabase
      .from('units_of_measure')
      .select('id, name, abbreviation, conversion_factor, is_base_unit, is_active')
      .eq('business_id', params.businessId)
      .eq('name', name)
      .limit(1)

    if (duplicateResponse.error) {
      throw duplicateResponse.error
    }

    const duplicate = ((duplicateResponse.data ?? []) as Array<{
      id: string
      name: string
      abbreviation: string
      conversion_factor: string | number
      is_base_unit: boolean
      is_active: boolean
    }>)[0] ?? null

    if (params.isBaseUnit) {
      const baseResponse = await supabase
        .from('units_of_measure')
        .select('id')
        .eq('business_id', params.businessId)
        .eq('is_base_unit', true)
        .eq('is_active', true)
        .neq('id', duplicate?.id ?? '00000000-0000-0000-0000-000000000000')
        .limit(1)

      if (baseResponse.error) {
        throw baseResponse.error
      }

      if (((baseResponse.data ?? []) as Array<{ id: string }>).length > 0) {
        throw new Error('A base unit already exists for this business')
      }
    }

    if (duplicate?.is_active) {
      throw new Error('A unit with this name already exists')
    }

    if (duplicate) {
      const updateResponse = await supabase
        .from('units_of_measure')
        .update({
          abbreviation,
          conversion_factor: params.conversionFactor,
          is_base_unit: params.isBaseUnit,
          is_active: true,
        })
        .eq('business_id', params.businessId)
        .eq('id', duplicate.id)
        .select('id')
        .single()

      if (updateResponse.error) {
        throw updateResponse.error
      }

      await writeUOMAuditLog({
        businessId: params.businessId,
        actorId,
        entityType: 'units_of_measure',
        entityId: duplicate.id,
        action: 'reactivated',
        oldValue: {
          name: duplicate.name,
          abbreviation: duplicate.abbreviation,
          conversion_factor: duplicate.conversion_factor,
          is_base_unit: duplicate.is_base_unit,
          is_active: duplicate.is_active,
        },
        newValue: {
          name,
          abbreviation,
          conversion_factor: params.conversionFactor,
          is_base_unit: params.isBaseUnit,
          is_active: true,
        },
      })

      logger.info('UOM reactivated', { businessId: params.businessId, uomId: duplicate.id, actorId })
      return duplicate.id
    }

    const insertResponse = await supabase
      .from('units_of_measure')
      .insert({
        business_id: params.businessId,
        name,
        abbreviation,
        conversion_factor: params.conversionFactor,
        is_base_unit: params.isBaseUnit,
        is_active: true,
        created_by: actorId,
      })
      .select('id')
      .single()

    if (insertResponse.error) {
      throw insertResponse.error
    }

    const inserted = insertResponse.data as { id: string } | null

    if (!inserted) {
      throw new Error('Unable to create unit of measure')
    }

    await writeUOMAuditLog({
      businessId: params.businessId,
      actorId,
      entityType: 'units_of_measure',
      entityId: inserted.id,
      action: 'created',
      oldValue: null,
      newValue: {
        name,
        abbreviation,
        conversion_factor: params.conversionFactor,
        is_base_unit: params.isBaseUnit,
      },
    })

    logger.info('UOM created', { businessId: params.businessId, uomId: inserted.id, actorId })
    return inserted.id
  } catch (error: unknown) {
    logger.error('createUOM failed', { businessId: params.businessId, actorId, error })
    throw error
  }
}

/**
 * Links an existing UOM to a product after validating tenant ownership.
 */
export async function linkUOMToProduct(productId: string, uomId: string, businessId: string, actorId: string): Promise<string> {
  const supabase = await createClient()

  try {
    await assertActorCanManageUOM(actorId, businessId)

    const [productResponse, uomResponse] = await Promise.all([
      supabase
        .from('products')
        .select('id, business_id')
        .eq('id', productId)
        .eq('business_id', businessId)
        .limit(1),
      supabase
        .from('units_of_measure')
        .select('id, business_id')
        .eq('id', uomId)
        .eq('business_id', businessId)
        .eq('is_active', true)
        .limit(1),
    ])

    if (productResponse.error) {
      throw productResponse.error
    }

    if (uomResponse.error) {
      throw uomResponse.error
    }

    const product = ((productResponse.data ?? []) as BusinessScopedRow[])[0]
    const uom = ((uomResponse.data ?? []) as BusinessScopedRow[])[0]

    if (!product) {
      throw new Error('Product not found')
    }

    if (!uom) {
      throw new Error('Unit of measure not found')
    }

    const insertResponse = await supabase
      .from('product_uom_links')
      .insert({
        product_id: productId,
        uom_id: uomId,
        business_id: businessId,
      })
      .select('id')
      .single()

    if (insertResponse.error) {
      throw insertResponse.error
    }

    const inserted = insertResponse.data as { id: string } | null

    if (!inserted) {
      throw new Error('Unable to link unit to product')
    }

    await writeUOMAuditLog({
      businessId,
      actorId,
      entityType: 'product_uom_links',
      entityId: inserted.id,
      action: 'linked',
      oldValue: null,
      newValue: {
        product_id: productId,
        uom_id: uomId,
      },
    })

    logger.info('UOM linked to product', { businessId, productId, uomId, actorId })
    return inserted.id
  } catch (error: unknown) {
    logger.error('linkUOMToProduct failed', { businessId, productId, uomId, actorId, error })
    throw error
  }
}
