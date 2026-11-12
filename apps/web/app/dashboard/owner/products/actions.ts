'use server'
/**
 * Server Actions for the owner products page.
 *
 * Handles product creation, updates, and status toggles.
 * All validation is performed using Zod and all writes are audited.
 */

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '../../../../lib/supabase/server'
import { requireRole } from '../../../../lib/auth/helpers'
import { createProductSchema, GlobalRole, setPricingSchema } from '@smartretail/shared'
import logger from '../../../../lib/logger'
import { getSpreadsheetValue, parseSpreadsheetFile } from '../../../../lib/spreadsheets/workbooks'

export type FormState = {
  error: string | null
  success: boolean
  message?: string
}

const getString = (formData: FormData, key: string): string => {
  const value = formData.get(key)
  return typeof value === 'string' ? value.trim() : ''
}

const getNumber = (formData: FormData, key: string): number | null => {
  const value = formData.get(key)
  if (typeof value !== 'string') {
    return null
  }
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * Reads repeated string values from FormData.
 */
const getStrings = (formData: FormData, key: string): string[] => {
  return formData.getAll(key).filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
}

function parseBarcodeCodes(value: string): { codes?: string[]; error?: string } {
  const codes = [...new Set(value.split(/[\r\n,]+/).map((code) => code.trim()).filter(Boolean))]
  if (codes.length > 25) return { error: 'Add no more than 25 barcode values at once' }
  if (codes.some((code) => code.length > 128)) return { error: 'Each barcode must be 128 characters or fewer' }
  return { codes }
}

async function saveProductBarcodeCodes(
  supabase: Awaited<ReturnType<typeof createClient>>,
  businessId: string,
  productId: string,
  codes: string[]
): Promise<string | null> {
  if (codes.length === 0) return null
  const existingResponse = await supabase
    .from('product_barcodes')
    .select('code, product_id')
    .eq('business_id', businessId)
  if (existingResponse.error) return existingResponse.error.message

  const existingByCode = new Map(
    (existingResponse.data ?? []).map((row) => [row.code.trim().toUpperCase(), row.product_id])
  )
  const conflict = codes.find((code) => {
    const existingProductId = existingByCode.get(code.toUpperCase())
    return existingProductId && existingProductId !== productId
  })
  if (conflict) return `Barcode ${conflict} is already assigned to another product`

  const newCodes = codes.filter((code) => !existingByCode.has(code.toUpperCase()))
  if (newCodes.length === 0) return null
  const insertResponse = await supabase.from('product_barcodes').insert(
    newCodes.map((code) => ({ business_id: businessId, product_id: productId, code, source: 'manufacturer' }))
  )
  return insertResponse.error?.message ?? null
}

/**
 * Revalidates every dashboard surface affected by product pricing or UOM edits.
 */
function revalidateProductRoutes() {
  revalidatePath('/dashboard/owner/products')
  revalidatePath('/dashboard/admin/products')
  revalidatePath('/dashboard/owner/stock')
  revalidatePath('/dashboard/admin/stock')
  revalidatePath('/dashboard/owner/finances')
  revalidatePath('/dashboard/admin/damaged-stock')
  revalidatePath('/dashboard/employee')
  revalidatePath('/dashboard/employee/damaged-stock')
  revalidatePath('/dashboard/employee/transactions')
  revalidatePath('/dashboard/employee/transactions/new')
}

/**
 * Validates product/UOM assignment fields submitted with product creation.
 */
const productUOMAssignmentSchema = z.object({
  baseUomId: z.string().uuid('Select a base unit'),
  purchaseUomIds: z.array(z.string().uuid()).min(1, 'Select at least one purchase unit'),
  saleUomIds: z.array(z.string().uuid()).min(1, 'Select at least one sale unit'),
  defaultPurchaseUomId: z.string().uuid('Select a default purchase unit'),
  defaultSaleUomId: z.string().uuid('Select a default sale unit'),
})

/**
 * Product/UOM link payload inserted after product creation.
 */
type ProductUOMInsertRow = {
  product_id: string
  uom_id: string
  business_id: string
  is_purchase_uom: boolean
  is_sale_uom: boolean
  is_base_uom: boolean
  is_default_purchase_uom: boolean
  is_default_sale_uom: boolean
}

/**
 * Validates extra classification fields for the richer product setup flow.
 */
const productClassificationSchema = z.object({
  productKind: z.enum(['fixed_package', 'measured_counted']),
  subcategory: z.string().trim().max(120).optional(),
  brandFamily: z.string().trim().max(120).optional(),
})

/**
 * Validates product pricing model setup fields.
 */
const pricingModelSchema = z.object({
  pricingMethod: z.enum(['fixed_price', 'assisted_pack', 'manual_quantity']),
  roundingRule: z.enum(['none', 'nearest_5', 'up_5', 'down_5', 'nearest_10']),
  branchScope: z.enum(['all', 'branch']),
  branchIds: z.array(z.string().uuid()),
  points: z.array(
    z.object({
      uomId: z.string().uuid('Select a unit for each price point'),
      quantity: z.number().positive('Price point quantity must be greater than zero'),
      price: z.number().nonnegative('Price point price cannot be negative'),
      maxDiscountAmount: z.number().nonnegative('Maximum discount cannot be negative'),
    })
  ),
})

/**
 * Pricing model row inserted after core product creation.
 */
type ProductPricingModelInsertRow = {
  business_id: string
  product_id: string
  branch_id: string | null
  pricing_method: 'fixed_price' | 'assisted_pack' | 'manual_quantity'
  rounding_rule: 'none' | 'nearest_5' | 'up_5' | 'down_5' | 'nearest_10'
  calculation_strategy: 'nearest_lower_pack_rate'
  status: 'approved'
  created_by: string
  approved_by: string
  approved_at: string
}

/**
 * Price point row inserted for assisted/manual pricing.
 */
type ProductPricePointInsertRow = {
  business_id: string
  pricing_model_id: string
  product_id: string
  branch_id: string | null
  uom_id: string
  quantity_in_uom: number
  base_quantity: number
  price: number
  max_discount_amount: number
  source: 'manual' | 'assisted_anchor'
}

/**
 * Minimal Supabase/PostgREST error shape for additive-schema fallbacks.
 */
type QueryErrorLike = {
  code?: string
  message?: string
}

/**
 * Detects missing-column/table errors while additive migrations roll out.
 */
function isSchemaRolloutError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false
  }

  const queryError = error as QueryErrorLike
  const message = queryError.message ?? ''

  return (
    queryError.code === '42P01' ||
    queryError.code === '42703' ||
    queryError.code === 'PGRST200' ||
    queryError.code === 'PGRST204' ||
    message.includes('does not exist') ||
    message.includes('Could not find')
  )
}

/**
 * Parses pricing points from a dynamic form payload.
 */
function parsePricePoints(formData: FormData): Array<{ uomId: string; quantity: number; price: number; maxDiscountAmount: number }> {
  const count = Number(getString(formData, 'pricePointCount'))
  const safeCount = Number.isFinite(count) && count > 0 ? count : 0
  const points: Array<{ uomId: string; quantity: number; price: number; maxDiscountAmount: number }> = []

  for (let index = 0; index < safeCount; index += 1) {
    const uomId = getString(formData, `pricePointUomId_${index}`)
    const quantity = Number(getString(formData, `pricePointQuantity_${index}`))
    const price = Number(getString(formData, `pricePointPrice_${index}`))
    const maxDiscountAmount = Number(getString(formData, `pricePointMaxDiscount_${index}`) || '0')

    if (uomId && Number.isFinite(quantity) && Number.isFinite(price) && Number.isFinite(maxDiscountAmount)) {
      points.push({ uomId, quantity, price, maxDiscountAmount })
    }
  }

  return points
}

/**
 * Parses direct prices for sale UOMs managed in the product UOM section.
 */
function parseUOMPrices(formData: FormData): Array<{ uomId: string; quantity: number; price: number; maxDiscountAmount: number }> {
  const count = Number(getString(formData, 'uomPriceCount'))
  const safeCount = Number.isFinite(count) && count > 0 ? count : 0
  const prices: Array<{ uomId: string; quantity: number; price: number; maxDiscountAmount: number }> = []

  for (let index = 0; index < safeCount; index += 1) {
    const uomId = getString(formData, `uomPriceUomId_${index}`)
    const price = Number(getString(formData, `uomPriceAmount_${index}`))
    const maxDiscountAmount = Number(getString(formData, `uomPriceMaxDiscount_${index}`) || '0')

    if (uomId && Number.isFinite(price) && price >= 0 && Number.isFinite(maxDiscountAmount)) {
      prices.push({ uomId, quantity: 1, price, maxDiscountAmount })
    }
  }

  return prices
}

/**
 * Combines quantity/pack rows with direct UOM prices without violating the
 * per-model UOM+quantity uniqueness rule.
 */
function mergePricePointRows(points: Array<{ uomId: string; quantity: number; price: number; maxDiscountAmount: number }>): Array<{ uomId: string; quantity: number; price: number; maxDiscountAmount: number }> {
  const byUomQuantity = new Map<string, { uomId: string; quantity: number; price: number; maxDiscountAmount: number }>()

  points.forEach((point) => {
    byUomQuantity.set(`${point.uomId}:${point.quantity}`, point)
  })

  return Array.from(byUomQuantity.values())
}

export async function addProduct(prevState: FormState, formData: FormData): Promise<FormState> {
  const name = getString(formData, 'name')
  const sku = getString(formData, 'sku')
  const category = getString(formData, 'category')
  const unit = getString(formData, 'unit')
  const description = getString(formData, 'description')
  const basePrice = getNumber(formData, 'basePrice')
  const minPrice = getNumber(formData, 'minPrice')
  const maxPrice = getNumber(formData, 'maxPrice')
  const classificationValidation = productClassificationSchema.safeParse({
    productKind: getString(formData, 'productKind') || 'fixed_package',
    subcategory: getString(formData, 'subcategory') || undefined,
    brandFamily: getString(formData, 'brandFamily') || undefined,
  })
  const pricingModelValidation = pricingModelSchema.safeParse({
    pricingMethod: getString(formData, 'pricingMethod') || 'fixed_price',
    roundingRule: getString(formData, 'roundingRule') || 'nearest_5',
    branchScope: getString(formData, 'pricingBranchScope') || 'all',
    branchIds: Array.from(new Set(getStrings(formData, 'pricingBranchIds'))),
    points: parsePricePoints(formData),
  })
  const directUomPrices = parseUOMPrices(formData)
  const uomValidation = productUOMAssignmentSchema.safeParse({
    baseUomId: getString(formData, 'baseUomId'),
    purchaseUomIds: getStrings(formData, 'purchaseUomIds'),
    saleUomIds: getStrings(formData, 'saleUomIds'),
    defaultPurchaseUomId: getString(formData, 'defaultPurchaseUomId'),
    defaultSaleUomId: getString(formData, 'defaultSaleUomId'),
  })

  const validation = createProductSchema.safeParse({
    name,
    sku,
    category,
    unit,
    description,
  })

  if (!validation.success) {
    return {
      error: validation.error.errors[0]?.message ?? 'Invalid product data',
      success: false,
    }
  }

  const barcodeValidation = parseBarcodeCodes(getString(formData, 'barcodes'))
  if (barcodeValidation.error) return { error: barcodeValidation.error, success: false }

  if (!classificationValidation.success) {
    return {
      error: classificationValidation.error.errors[0]?.message ?? 'Invalid product classification',
      success: false,
    }
  }

  if (!pricingModelValidation.success) {
    return {
      error: pricingModelValidation.error.errors[0]?.message ?? 'Invalid pricing model',
      success: false,
    }
  }

  if (pricingModelValidation.data.branchScope === 'branch' && pricingModelValidation.data.branchIds.length === 0) {
    return { error: 'Select at least one branch this pricing model applies to', success: false }
  }

  if (
    pricingModelValidation.data.pricingMethod !== 'fixed_price' &&
    pricingModelValidation.data.points.length === 0 &&
    directUomPrices.length === 0
  ) {
    return { error: 'Add at least one price point for assisted or manual pricing', success: false }
  }

  if (!uomValidation.success) {
    return {
      error: uomValidation.error.errors[0]?.message ?? 'Invalid unit assignment',
      success: false,
    }
  }

  if (!uomValidation.data.purchaseUomIds.includes(uomValidation.data.defaultPurchaseUomId)) {
    return { error: 'Default purchase unit must be selected as an available purchase unit', success: false }
  }

  if (!uomValidation.data.saleUomIds.includes(uomValidation.data.defaultSaleUomId)) {
    return { error: 'Default sale unit must be selected as an available sale unit', success: false }
  }

  const pricingValidation = setPricingSchema.safeParse({
    basePrice,
    minPrice,
    maxPrice,
  })

  if (!pricingValidation.success) {
    return {
      error: pricingValidation.error.errors[0]?.message ?? 'Invalid pricing data',
      success: false,
    }
  }

  const profile = await requireRole([GlobalRole.Owner])
  const businessId = profile.business_id

  if (!businessId) {
    logger.error('addProduct: missing business id on owner profile', { userId: profile.id })
    return { error: 'Business context missing', success: false }
  }

  try {
    const supabase = await createClient()

    const { data: productId, error: createError } = await supabase.rpc('owner_create_product', {
      p_name: validation.data.name,
      p_sku: validation.data.sku,
      p_category: validation.data.category,
      p_unit: validation.data.unit,
      p_description: description || null,
      p_base_price: pricingValidation.data.basePrice,
      p_min_price: pricingValidation.data.minPrice,
      p_max_price: pricingValidation.data.maxPrice,
    })

    if (createError || !productId) {
      logger.error('addProduct: RPC failed', { businessId, error: createError })
      return { error: createError?.message ?? 'Unable to add product', success: false }
    }

    const { error: classificationError } = await supabase
      .from('products')
      .update({
        product_kind: classificationValidation.data.productKind,
        subcategory: classificationValidation.data.subcategory ?? null,
        brand_family: classificationValidation.data.brandFamily ?? null,
        tracks_expiry: getString(formData, 'tracksExpiry') === 'true',
      })
      .eq('business_id', businessId)
      .eq('id', String(productId))

    if (classificationError) {
      logger.error('addProduct: classification update failed', { businessId, productId, error: classificationError })
      return { error: classificationError.message ?? 'Product created, but classification failed', success: false }
    }

    const barcodeError = await saveProductBarcodeCodes(
      supabase, businessId, String(productId), barcodeValidation.codes ?? []
    )
    if (barcodeError) return { error: `Product created, but its barcodes were not saved: ${barcodeError}`, success: false }

    const selectedUomIds = Array.from(
      new Set([
        uomValidation.data.baseUomId,
        ...uomValidation.data.purchaseUomIds,
        ...uomValidation.data.saleUomIds,
        uomValidation.data.defaultPurchaseUomId,
        uomValidation.data.defaultSaleUomId,
      ])
    )

    const { data: uomRows, error: uomError } = await supabase
      .from('units_of_measure')
      .select('id, conversion_factor')
      .eq('business_id', businessId)
      .eq('is_active', true)
      .in('id', selectedUomIds)

    if (uomError) {
      logger.error('addProduct: UOM lookup failed', { businessId, productId, error: uomError })
      return { error: uomError.message ?? 'Unable to validate product units', success: false }
    }

    const validUomIds = new Set(((uomRows ?? []) as Array<{ id: string }>).map((row) => row.id))

    if (selectedUomIds.some((uomId) => !validUomIds.has(uomId))) {
      return { error: 'One or more selected units are invalid', success: false }
    }

    const uomFactorById = new Map(
      ((uomRows ?? []) as Array<{ id: string; conversion_factor?: string | number }>).map((row) => [row.id, Number(row.conversion_factor ?? 1)])
    )

    const defaultSalePoint = {
      uomId: uomValidation.data.defaultSaleUomId,
      quantity: 1,
      price: pricingValidation.data.basePrice,
      maxDiscountAmount: 0,
    }
    const mergedPricePoints = mergePricePointRows([
      ...(pricingModelValidation.data.pricingMethod === 'fixed_price' && directUomPrices.length === 0 ? [] : [defaultSalePoint]),
      ...pricingModelValidation.data.points,
      ...directUomPrices,
    ])
    const modelPricingMethod =
      pricingModelValidation.data.pricingMethod === 'fixed_price' && mergedPricePoints.length > 0
        ? 'assisted_pack'
        : pricingModelValidation.data.pricingMethod
    const modelRoundingRule =
      pricingModelValidation.data.pricingMethod === 'fixed_price' && mergedPricePoints.length > 0
        ? 'none'
        : pricingModelValidation.data.roundingRule

    if (mergedPricePoints.some((point) => !uomValidation.data.saleUomIds.includes(point.uomId))) {
      return { error: 'Every price point unit must be selected as an available sale unit', success: false }
    }

    const linkRows: ProductUOMInsertRow[] = selectedUomIds.map((uomId) => ({
      product_id: String(productId),
      uom_id: uomId,
      business_id: businessId,
      is_purchase_uom: uomValidation.data.purchaseUomIds.includes(uomId),
      is_sale_uom: uomValidation.data.saleUomIds.includes(uomId),
      is_base_uom: uomId === uomValidation.data.baseUomId,
      is_default_purchase_uom: uomId === uomValidation.data.defaultPurchaseUomId,
      is_default_sale_uom: uomId === uomValidation.data.defaultSaleUomId,
    }))

    const { error: linkError } = await supabase.from('product_uom_links').insert(linkRows)

    if (linkError) {
      logger.error('addProduct: UOM link insert failed', { businessId, productId, error: linkError })
      return { error: linkError.message ?? 'Product created, but unit assignments failed', success: false }
    }

    const pricingBranchIds = pricingModelValidation.data.branchScope === 'branch' ? pricingModelValidation.data.branchIds : []

    if (pricingBranchIds.length > 0) {
      const { data: branchRows, error: branchLookupError } = await supabase
        .from('branches')
        .select('id')
        .eq('business_id', businessId)
        .eq('is_active', true)
        .in('id', pricingBranchIds)

      if (branchLookupError) {
        logger.error('addProduct: pricing branch lookup failed', { businessId, productId, error: branchLookupError })
        return { error: branchLookupError.message ?? 'Unable to validate selected branches', success: false }
      }

      const validBranchIds = new Set(((branchRows ?? []) as Array<{ id: string }>).map((branch) => branch.id))

      if (pricingBranchIds.some((branchId) => !validBranchIds.has(branchId))) {
        return { error: 'One or more selected branches are invalid or inactive', success: false }
      }
    }

    const pricingScopes = pricingBranchIds.length > 0 ? pricingBranchIds.map((branchId) => ({ branchId })) : [{ branchId: null }]
    const nowIso = new Date().toISOString()
    const pricingModelRows: ProductPricingModelInsertRow[] = pricingScopes.map((scope) => ({
      business_id: businessId,
      product_id: String(productId),
      branch_id: scope.branchId,
      pricing_method: modelPricingMethod,
      rounding_rule: modelRoundingRule,
      calculation_strategy: 'nearest_lower_pack_rate',
      status: 'approved',
      created_by: profile.id,
      approved_by: profile.id,
      approved_at: nowIso,
    }))

    const { data: pricingModelData, error: pricingModelError } = await supabase
      .from('product_pricing_models')
      .insert(pricingModelRows)
      .select('id, branch_id')

    if (pricingModelError || !pricingModelData) {
      logger.error('addProduct: pricing model insert failed', { businessId, productId, error: pricingModelError })
      return { error: pricingModelError?.message ?? 'Product created, but pricing model failed', success: false }
    }

    const pricingModels = pricingModelData as Array<{ id: string; branch_id: string | null }>

    if (modelPricingMethod !== 'fixed_price') {
      const pointRows: ProductPricePointInsertRow[] = pricingModels.flatMap((pricingModel) =>
        mergedPricePoints.map((point) => ({
          business_id: businessId,
          pricing_model_id: pricingModel.id,
          product_id: String(productId),
          branch_id: pricingModel.branch_id,
          uom_id: point.uomId,
          quantity_in_uom: point.quantity,
          base_quantity: point.quantity * (uomFactorById.get(point.uomId) ?? 1),
          price: point.price,
          max_discount_amount: point.maxDiscountAmount,
          source: modelPricingMethod === 'assisted_pack' ? 'assisted_anchor' : 'manual',
        }))
      )

      const { error: pointsError } = await supabase.from('product_price_points').insert(pointRows)

      if (pointsError) {
        logger.error('addProduct: pricing points insert failed', { businessId, productId, error: pointsError })
        return { error: pointsError.message ?? 'Product created, but price points failed', success: false }
      }
    }

    revalidateProductRoutes()

    logger.info('Product created', { businessId, productId, actor: profile.id, uomCount: linkRows.length })
    return { error: null, success: true }
  } catch (error) {
    logger.error('addProduct: unexpected error', { error: String(error) })
    return { error: 'Server error', success: false }
  }
}

export async function updateProduct(prevState: FormState, formData: FormData): Promise<FormState> {
  const productId = getString(formData, 'productId')
  const productKind = getString(formData, 'productKind') || 'fixed_package'
  const name = getString(formData, 'name')
  const sku = getString(formData, 'sku')
  const category = getString(formData, 'category')
  const subcategory = getString(formData, 'subcategory')
  const brandFamily = getString(formData, 'brandFamily')
  const unit = getString(formData, 'unit')
  const description = getString(formData, 'description')
  const basePrice = getNumber(formData, 'basePrice')
  const minPrice = getNumber(formData, 'minPrice')
  const maxPrice = getNumber(formData, 'maxPrice')
  const baseUomId = getString(formData, 'baseUomId')
  const uomValidation = productUOMAssignmentSchema.safeParse({
    baseUomId,
    purchaseUomIds: getStrings(formData, 'purchaseUomIds'),
    saleUomIds: getStrings(formData, 'saleUomIds'),
    defaultPurchaseUomId: getString(formData, 'defaultPurchaseUomId'),
    defaultSaleUomId: getString(formData, 'defaultSaleUomId'),
  })
  const pricingModelValidation = pricingModelSchema.safeParse({
    pricingMethod: getString(formData, 'pricingMethod') || 'fixed_price',
    roundingRule: getString(formData, 'roundingRule') || 'nearest_5',
    branchScope: getString(formData, 'pricingBranchScope') || 'all',
    branchIds: Array.from(new Set(getStrings(formData, 'pricingBranchIds'))),
    points: parsePricePoints(formData),
  })
  const directUomPrices = parseUOMPrices(formData)
  const classificationValidation = productClassificationSchema.safeParse({
    productKind,
    subcategory: subcategory || undefined,
    brandFamily: brandFamily || undefined,
  })

  if (!productId) {
    return { error: 'Missing product id', success: false }
  }

  const validation = createProductSchema.safeParse({
    name,
    sku,
    category,
    unit,
    description,
  })

  if (!validation.success) {
    return {
      error: validation.error.errors[0]?.message ?? 'Invalid product data',
      success: false,
    }
  }

  const barcodeValidation = parseBarcodeCodes(getString(formData, 'barcodes'))
  if (barcodeValidation.error) return { error: barcodeValidation.error, success: false }

  if (!classificationValidation.success) {
    return {
      error: classificationValidation.error.errors[0]?.message ?? 'Invalid product classification',
      success: false,
    }
  }

  if (!pricingModelValidation.success) {
    return {
      error: pricingModelValidation.error.errors[0]?.message ?? 'Invalid pricing model',
      success: false,
    }
  }

  if (pricingModelValidation.data.branchScope === 'branch' && pricingModelValidation.data.branchIds.length === 0) {
    return { error: 'Select at least one branch this pricing model applies to', success: false }
  }

  if (pricingModelValidation.data.pricingMethod !== 'fixed_price' && pricingModelValidation.data.points.length === 0 && directUomPrices.length === 0) {
    return { error: 'Add at least one price point for assisted or manual pricing', success: false }
  }

  if (pricingModelValidation.data.pricingMethod !== 'fixed_price' && !baseUomId) {
    return { error: 'Select a base unit before saving pack or manual quantity prices', success: false }
  }

  if (!uomValidation.success) {
    return {
      error: uomValidation.error.errors[0]?.message ?? 'Invalid unit assignment',
      success: false,
    }
  }

  if (!uomValidation.data.purchaseUomIds.includes(uomValidation.data.defaultPurchaseUomId)) {
    return { error: 'Default purchase unit must be selected as an available purchase unit', success: false }
  }

  if (!uomValidation.data.saleUomIds.includes(uomValidation.data.defaultSaleUomId)) {
    return { error: 'Default sale unit must be selected as an available sale unit', success: false }
  }

  const pricingValidation = setPricingSchema.safeParse({
    basePrice,
    minPrice,
    maxPrice,
  })

  if (!pricingValidation.success) {
    return {
      error: pricingValidation.error.errors[0]?.message ?? 'Invalid pricing data',
      success: false,
    }
  }

  const profile = await requireRole([GlobalRole.Owner])
  const businessId = profile.business_id

  if (!businessId) {
    logger.error('updateProduct: missing business id on owner profile', { userId: profile.id })
    return { error: 'Business context missing', success: false }
  }

  try {
    const supabase = await createClient()

    const { error } = await supabase.rpc('owner_update_product', {
      p_product_id: productId,
      p_name: validation.data.name,
      p_sku: validation.data.sku,
      p_category: validation.data.category,
      p_unit: validation.data.unit,
      p_description: description || null,
      p_base_price: pricingValidation.data.basePrice,
      p_min_price: pricingValidation.data.minPrice,
      p_max_price: pricingValidation.data.maxPrice,
    })

    if (error) {
      logger.error('updateProduct: RPC failed', { businessId, productId, error })
      return { error: error.message ?? 'Unable to update product', success: false }
    }

    const classificationResponse = await supabase
      .from('products')
      .update({
        product_kind: classificationValidation.data.productKind,
        subcategory: classificationValidation.data.subcategory ?? null,
        brand_family: classificationValidation.data.brandFamily ?? null,
        tracks_expiry: getString(formData, 'tracksExpiry') === 'true',
      })
      .eq('business_id', businessId)
      .eq('id', productId)

    if (classificationResponse.error) {
      if (isSchemaRolloutError(classificationResponse.error)) {
        logger.warn('updateProduct: classification columns missing; skipped advanced classification update', {
          businessId,
          productId,
          error: classificationResponse.error,
        })
      } else {
        logger.error('updateProduct: classification update failed', { businessId, productId, error: classificationResponse.error })
        return { error: classificationResponse.error.message ?? 'Product updated, but classification failed', success: false }
      }
    }

    const barcodeError = await saveProductBarcodeCodes(
      supabase, businessId, productId, barcodeValidation.codes ?? []
    )
    if (barcodeError) return { error: `Product updated, but its barcodes were not saved: ${barcodeError}`, success: false }

    const selectedUomIds = Array.from(
      new Set([
        uomValidation.data.baseUomId,
        ...uomValidation.data.purchaseUomIds,
        ...uomValidation.data.saleUomIds,
        uomValidation.data.defaultPurchaseUomId,
        uomValidation.data.defaultSaleUomId,
      ])
    )
    let uomFactorById = new Map<string, number>()
    let mergedPricePoints: Array<{ uomId: string; quantity: number; price: number; maxDiscountAmount: number }> = []
    let modelPricingMethod: ProductPricingModelInsertRow['pricing_method'] = pricingModelValidation.data.pricingMethod
    let modelRoundingRule: ProductPricingModelInsertRow['rounding_rule'] = pricingModelValidation.data.roundingRule

    const { data: uomRows, error: uomLookupError } = await supabase
      .from('units_of_measure')
      .select('id, conversion_factor')
      .eq('business_id', businessId)
      .eq('is_active', true)
      .in('id', selectedUomIds)

    if (uomLookupError) {
      if (isSchemaRolloutError(uomLookupError)) {
        logger.warn('updateProduct: UOM tables missing; skipped UOM link update', { businessId, productId, error: uomLookupError })
      } else {
        logger.error('updateProduct: UOM lookup failed', { businessId, productId, error: uomLookupError })
        return { error: uomLookupError.message ?? 'Unable to validate product units', success: false }
      }
    } else {
      const validUomIds = new Set(((uomRows ?? []) as Array<{ id: string }>).map((row) => row.id))

      if (selectedUomIds.some((uomId) => !validUomIds.has(uomId))) {
        return { error: 'One or more selected units are invalid', success: false }
      }

      uomFactorById = new Map(
        ((uomRows ?? []) as Array<{ id: string; conversion_factor?: string | number }>).map((row) => [row.id, Number(row.conversion_factor ?? 1)])
      )

      const defaultSalePoint = {
        uomId: uomValidation.data.defaultSaleUomId,
        quantity: 1,
        price: pricingValidation.data.basePrice,
        maxDiscountAmount: 0,
      }
      mergedPricePoints = mergePricePointRows([
        ...(pricingModelValidation.data.pricingMethod === 'fixed_price' && directUomPrices.length === 0 ? [] : [defaultSalePoint]),
        ...pricingModelValidation.data.points,
        ...directUomPrices,
      ])
      modelPricingMethod =
        pricingModelValidation.data.pricingMethod === 'fixed_price' && mergedPricePoints.length > 0
          ? 'assisted_pack'
          : pricingModelValidation.data.pricingMethod
      modelRoundingRule =
        pricingModelValidation.data.pricingMethod === 'fixed_price' && mergedPricePoints.length > 0
          ? 'none'
          : pricingModelValidation.data.roundingRule

      if (mergedPricePoints.some((point) => !uomValidation.data.saleUomIds.includes(point.uomId))) {
        return { error: 'Every price point unit must be selected as an available sale unit', success: false }
      }

      const { error: deleteLinksError } = await supabase
        .from('product_uom_links')
        .delete()
        .eq('business_id', businessId)
        .eq('product_id', productId)

      if (deleteLinksError && !isSchemaRolloutError(deleteLinksError)) {
        logger.error('updateProduct: product UOM link cleanup failed', { businessId, productId, error: deleteLinksError })
        return { error: deleteLinksError.message ?? 'Product updated, but old unit links could not be cleaned up', success: false }
      }

      const linkRows: ProductUOMInsertRow[] = selectedUomIds.map((uomId) => ({
        product_id: productId,
        uom_id: uomId,
        business_id: businessId,
        is_purchase_uom: uomValidation.data.purchaseUomIds.includes(uomId),
        is_sale_uom: uomValidation.data.saleUomIds.includes(uomId),
        is_base_uom: uomId === uomValidation.data.baseUomId,
        is_default_purchase_uom: uomId === uomValidation.data.defaultPurchaseUomId,
        is_default_sale_uom: uomId === uomValidation.data.defaultSaleUomId,
      }))

      const { error: linkInsertError } = await supabase.from('product_uom_links').insert(linkRows)

      if (linkInsertError && !isSchemaRolloutError(linkInsertError)) {
        logger.error('updateProduct: product UOM link insert failed', { businessId, productId, error: linkInsertError })
        return { error: linkInsertError.message ?? 'Product updated, but unit links failed', success: false }
      }
    }

    const pricingBranchIds = pricingModelValidation.data.branchScope === 'branch' ? pricingModelValidation.data.branchIds : []

    if (pricingBranchIds.length > 0) {
      const { data: branchRows, error: branchLookupError } = await supabase
        .from('branches')
        .select('id')
        .eq('business_id', businessId)
        .eq('is_active', true)
        .in('id', pricingBranchIds)

      if (branchLookupError) {
        logger.error('updateProduct: pricing branch lookup failed', { businessId, productId, error: branchLookupError })
        return { error: branchLookupError.message ?? 'Unable to validate selected branches', success: false }
      }

      const validBranchIds = new Set(((branchRows ?? []) as Array<{ id: string }>).map((branch) => branch.id))

      if (pricingBranchIds.some((branchId) => !validBranchIds.has(branchId))) {
        return { error: 'One or more selected branches are invalid or inactive', success: false }
      }
    }

    const pricingScopes = pricingBranchIds.length > 0 ? pricingBranchIds.map((branchId) => ({ branchId })) : [{ branchId: null }]
    const nowIso = new Date().toISOString()
    const activeModelResponse = await supabase
      .from('product_pricing_models')
      .select('id')
      .eq('business_id', businessId)
      .eq('product_id', productId)
      .in('status', ['draft', 'pending_approval', 'approved'])

    if (activeModelResponse.error) {
      if (isSchemaRolloutError(activeModelResponse.error)) {
        logger.warn('updateProduct: pricing model tables missing; skipped advanced pricing model update', {
          businessId,
          productId,
          error: activeModelResponse.error,
        })
      } else {
        logger.error('updateProduct: pricing model lookup failed', { businessId, productId, error: activeModelResponse.error })
        return { error: activeModelResponse.error.message ?? 'Product updated, but pricing model lookup failed', success: false }
      }
    } else {
      const activeModelIds = ((activeModelResponse.data ?? []) as Array<{ id: string }>).map((model) => model.id)

      if (activeModelIds.length > 0) {
        const { error: inactiveError } = await supabase
          .from('product_pricing_models')
          .update({ status: 'inactive' })
          .eq('business_id', businessId)
          .in('id', activeModelIds)

        if (inactiveError) {
          logger.error('updateProduct: old pricing model inactivation failed', { businessId, productId, error: inactiveError })
          return { error: inactiveError.message ?? 'Product updated, but old pricing model could not be retired', success: false }
        }
      }

      const pricingModelRows: ProductPricingModelInsertRow[] = pricingScopes.map((scope) => ({
        business_id: businessId,
        product_id: productId,
        branch_id: scope.branchId,
        pricing_method: modelPricingMethod,
        rounding_rule: modelRoundingRule,
        calculation_strategy: 'nearest_lower_pack_rate',
        status: 'approved',
        created_by: profile.id,
        approved_by: profile.id,
        approved_at: nowIso,
      }))

      const { data: pricingModelData, error: pricingModelError } = await supabase
        .from('product_pricing_models')
        .insert(pricingModelRows)
        .select('id, branch_id')

      if (pricingModelError || !pricingModelData) {
        logger.error('updateProduct: pricing model insert failed', { businessId, productId, error: pricingModelError })
        return { error: pricingModelError?.message ?? 'Product updated, but pricing model failed', success: false }
      }

      const pricingModels = pricingModelData as Array<{ id: string; branch_id: string | null }>

      if (modelPricingMethod !== 'fixed_price') {
        const pointRows: ProductPricePointInsertRow[] = pricingModels.flatMap((pricingModel) =>
          mergedPricePoints.map((point) => ({
            business_id: businessId,
            pricing_model_id: pricingModel.id,
            product_id: productId,
            branch_id: pricingModel.branch_id,
            uom_id: point.uomId,
            quantity_in_uom: point.quantity,
            base_quantity: point.quantity * (uomFactorById.get(point.uomId) ?? 1),
            price: point.price,
            max_discount_amount: point.maxDiscountAmount,
            source: modelPricingMethod === 'assisted_pack' ? 'assisted_anchor' : 'manual',
          }))
        )

        const { error: pointsError } = await supabase.from('product_price_points').insert(pointRows)

        if (pointsError) {
          logger.error('updateProduct: pricing points insert failed', { businessId, productId, error: pointsError })
          return { error: pointsError.message ?? 'Product updated, but price points failed', success: false }
        }
      }
    }

    revalidateProductRoutes()

    logger.info('Product updated', { businessId, productId, actor: profile.id })
    return { error: null, success: true }
  } catch (error) {
    logger.error('updateProduct: unexpected error', { error: String(error) })
    return { error: 'Server error', success: false }
  }
}

export async function toggleProductStatus(prevState: FormState, formData: FormData): Promise<FormState> {
  const productId = getString(formData, 'productId')
  const isActiveRaw = formData.get('isActive')
  const isActive = isActiveRaw === 'true'

  if (!productId) {
    return { error: 'Missing product id', success: false }
  }

  const profile = await requireRole([GlobalRole.Owner])
  const businessId = profile.business_id

  if (!businessId) {
    logger.error('toggleProductStatus: missing business id on owner profile', { userId: profile.id })
    return { error: 'Business context missing', success: false }
  }

  try {
    const supabase = await createClient()

    const { data: currentData, error: currentError } = await supabase
      .from('products')
      .select('id, name, is_active, deleted_at')
      .eq('business_id', businessId)
      .eq('id', productId)
      .maybeSingle()

    if (currentError) {
      logger.error('toggleProductStatus: product lookup failed', { businessId, productId, error: currentError })
      return { error: currentError.message ?? 'Unable to load product', success: false }
    }

    const currentProduct = currentData as { id: string; name: string; is_active: boolean; deleted_at: string | null } | null

    if (!currentProduct) {
      return { error: 'Product not found', success: false }
    }

    if (currentProduct.deleted_at) {
      return { error: `${currentProduct.name} has been deleted`, success: false }
    }

    if (currentProduct.is_active === isActive) {
      return {
        error: `${currentProduct.name} is already ${isActive ? 'active' : 'inactive'}`,
        success: false,
      }
    }

    const { error } = await supabase.rpc('owner_toggle_product_status', {
      p_product_id: productId,
      p_is_active: isActive,
    })

    if (error) {
      logger.error('toggleProductStatus: RPC failed', { businessId, productId, error })
      return { error: error.message ?? 'Unable to update product', success: false }
    }

    revalidateProductRoutes()

    logger.info('Product status toggled', { businessId, productId, isActive, actor: profile.id })
    return { error: null, success: true }
  } catch (error) {
    logger.error('toggleProductStatus: unexpected error', { error: String(error) })
    return { error: 'Server error', success: false }
  }
}

const deleteProductSchema = z.object({
  productId: z.string().uuid(),
  reason: z.string().trim().max(240).optional(),
})

type ParsedImportedProduct = {
  product: {
    name: string
    sku: string
    category: string
    unit: string
    description?: string
  }
  classification: {
    productKind: 'fixed_package' | 'measured_counted'
    subcategory?: string
    brandFamily?: string
  }
  pricing: {
    basePrice: number
    minPrice: number
    maxPrice: number
  }
  unit: {
    name: string
    abbreviation: string
    conversionFactor: number
  }
  pricingModel: {
    pricingMethod: 'fixed_price' | 'assisted_pack' | 'manual_quantity'
    roundingRule: 'none' | 'nearest_5' | 'up_5' | 'down_5' | 'nearest_10'
    branchNames: string[]
    points: Array<{ quantity: number; price: number; maxDiscountAmount: number }>
  }
}

type ImportedUnitRow = {
  id: string
  name: string
  conversion_factor: string | number
}

/**
 * Normalizes spreadsheet enum values into the pricing method stored in DB.
 */
function normalizePricingMethod(value: string): 'fixed_price' | 'assisted_pack' | 'manual_quantity' {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_')

  if (normalized === 'system_assisted' || normalized === 'assisted' || normalized === 'assisted_pack') {
    return 'assisted_pack'
  }

  if (normalized === 'manual' || normalized === 'manual_quantity' || normalized === 'manual_quantity_prices') {
    return 'manual_quantity'
  }

  return 'fixed_price'
}

/**
 * Normalizes spreadsheet enum values into product kind.
 */
function normalizeProductKind(value: string): 'fixed_package' | 'measured_counted' {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_')
  return normalized === 'measured_counted' || normalized === 'counted' || normalized === 'measured' ? 'measured_counted' : 'fixed_package'
}

/**
 * Normalizes spreadsheet enum values into a supported rounding rule.
 */
function normalizeRoundingRule(value: string): 'none' | 'nearest_5' | 'up_5' | 'down_5' | 'nearest_10' {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_')

  if (normalized === 'none') return 'none'
  if (normalized === 'up_5' || normalized === 'ceil_5') return 'up_5'
  if (normalized === 'down_5' || normalized === 'floor_5') return 'down_5'
  if (normalized === 'nearest_10') return 'nearest_10'
  return 'nearest_5'
}

/**
 * Parses comma-separated branch names from an import row.
 */
function parseBranchNames(value: string): string[] {
  return value
    .split(',')
    .map((branchName) => branchName.trim())
    .filter((branchName) => branchName.length > 0)
}

/**
 * Parses compact price points such as `1@20; 6@100; 10@170`.
 */
function parseSpreadsheetDiscounts(value: string, rowNumber: number): Map<number, number> {
  const discounts = new Map<number, number>()

  if (!value.trim()) {
    return discounts
  }

  value
    .split(';')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .forEach((entry) => {
      const match = entry.match(/^(\d+(?:\.\d+)?)\s*(?:<=|@|:|=)\s*(\d+(?:\.\d+)?)$/)

      if (!match) {
        throw new Error(`Row ${rowNumber}: Max discounts must look like 6<=5; 30<=20`)
      }

      discounts.set(Number(match[1]), Number(match[2]))
    })

  return discounts
}

function parseSpreadsheetPricePoints(value: string, rowNumber: number, discounts = new Map<number, number>()): Array<{ quantity: number; price: number; maxDiscountAmount: number }> {
  if (!value.trim()) {
    return []
  }

  return value
    .split(';')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => {
      const match = entry.match(/^(\d+(?:\.\d+)?)\s*(?:@|:|=)\s*(\d+(?:\.\d+)?)$/)

      if (!match) {
        throw new Error(`Row ${rowNumber}: Price points must look like 1@20; 6@100`)
      }

      return {
        quantity: Number(match[1]),
        price: Number(match[2]),
        maxDiscountAmount: discounts.get(Number(match[1])) ?? 0,
      }
    })
}

/**
 * Splits large insert payloads into smaller batches for steadier uploads.
 */
function chunkRows<Row>(rows: Row[], size = 250): Row[][] {
  const chunks: Row[][] = []

  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size))
  }

  return chunks
}

/**
 * Imports multiple products from an XLSX or CSV spreadsheet.
 */
export async function importProducts(_prevState: FormState, formData: FormData): Promise<FormState> {
  const file = formData.get('file')

  if (!(file instanceof File) || file.size === 0) {
    return { error: 'Please upload a spreadsheet file', success: false }
  }

  const profile = await requireRole([GlobalRole.Owner])
  const businessId = profile.business_id

  if (!businessId) {
    logger.error('importProducts: missing business id on owner profile', { userId: profile.id })
    return { error: 'Business context missing', success: false }
  }

  try {
    const rows = await parseSpreadsheetFile(file)

    if (rows.length === 0) {
      return { error: 'The spreadsheet has no product rows', success: false }
    }

    if (rows.length > 500) {
      return { error: 'Import up to 500 products at a time', success: false }
    }

    const parsedProducts: ParsedImportedProduct[] = rows.map((row, index) => {
      const rowNumber = index + 2
      const baseUnitName = getSpreadsheetValue(row, ['base unit', 'unit', 'unit name']) || 'Single'
      const unitAbbreviation = getSpreadsheetValue(row, ['unit abbreviation', 'abbreviation']) || baseUnitName.slice(0, 12).toLowerCase()
      const unitConversionFactor = Number(getSpreadsheetValue(row, ['unit conversion factor', 'conversion factor']) || 1)
      const pricingMethod = normalizePricingMethod(getSpreadsheetValue(row, ['pricing method']))
      const discounts = parseSpreadsheetDiscounts(getSpreadsheetValue(row, ['max discounts', 'maximum discounts', 'price point discounts']), rowNumber)
      const pricePoints = parseSpreadsheetPricePoints(getSpreadsheetValue(row, ['price points', 'pack prices', 'quantity prices']), rowNumber, discounts)
      const branchNames = parseBranchNames(getSpreadsheetValue(row, ['branch names', 'branches']))
      const productValidation = createProductSchema.safeParse({
        name: getSpreadsheetValue(row, ['name', 'product name']),
        sku: getSpreadsheetValue(row, ['sku']),
        category: getSpreadsheetValue(row, ['category']),
        unit: baseUnitName,
        description: getSpreadsheetValue(row, ['description']),
      })

      if (!productValidation.success) {
        throw new Error(`Row ${rowNumber}: ${productValidation.error.errors[0]?.message ?? 'Invalid product data'}`)
      }

      const pricingValidation = setPricingSchema.safeParse({
        basePrice: Number(getSpreadsheetValue(row, ['base price', 'base_price'])),
        minPrice: Number(getSpreadsheetValue(row, ['min price', 'min_price'])),
        maxPrice: Number(getSpreadsheetValue(row, ['max price', 'max_price'])),
      })

      if (!pricingValidation.success) {
        throw new Error(`Row ${rowNumber}: ${pricingValidation.error.errors[0]?.message ?? 'Invalid pricing data'}`)
      }

      if (!Number.isFinite(unitConversionFactor) || unitConversionFactor <= 0) {
        throw new Error(`Row ${rowNumber}: Unit conversion factor must be greater than zero`)
      }

      if (pricingMethod !== 'fixed_price' && pricePoints.length === 0) {
        throw new Error(`Row ${rowNumber}: Add price points for assisted or manual quantity pricing`)
      }

      return {
        product: productValidation.data,
        classification: {
          productKind: normalizeProductKind(getSpreadsheetValue(row, ['product kind', 'kind'])),
          subcategory: getSpreadsheetValue(row, ['subcategory', 'sub category']) || undefined,
          brandFamily: getSpreadsheetValue(row, ['brand family', 'brand', 'family']) || undefined,
        },
        pricing: pricingValidation.data,
        unit: {
          name: baseUnitName,
          abbreviation: unitAbbreviation,
          conversionFactor: unitConversionFactor,
        },
        pricingModel: {
          pricingMethod,
          roundingRule: normalizeRoundingRule(getSpreadsheetValue(row, ['rounding rule', 'rounding'])),
          branchNames,
          points: pricePoints,
        },
      }
    })

    const uploadedSkus = parsedProducts.map((row) => row.product.sku)
    const duplicateSku = uploadedSkus.find((sku, index) => uploadedSkus.indexOf(sku) !== index)

    if (duplicateSku) {
      return { error: `Duplicate SKU in spreadsheet: ${duplicateSku}`, success: false }
    }

    const supabase = await createClient()
    const requestedBranchNames = Array.from(
      new Set(parsedProducts.flatMap((row) => row.pricingModel.branchNames).map((branchName) => branchName.trim().toLowerCase()))
    )
    const [existingUnitsResponse, existingProductsResponse, branchRowsResponse] = await Promise.all([
      supabase
        .from('units_of_measure')
        .select('id, name, conversion_factor')
        .eq('business_id', businessId)
        .eq('is_active', true),
      supabase
        .from('products')
        .select('sku')
        .eq('business_id', businessId)
        .in('sku', uploadedSkus),
      requestedBranchNames.length > 0
        ? supabase
            .from('branches')
            .select('id, name')
            .eq('business_id', businessId)
            .eq('is_active', true)
        : Promise.resolve({ data: [], error: null }),
    ])

    if (existingUnitsResponse.error) {
      logger.error('importProducts: UOM lookup failed', { businessId, error: existingUnitsResponse.error })
      return { error: existingUnitsResponse.error.message ?? 'Unable to load units of measure', success: false }
    }

    if (existingProductsResponse.error) {
      logger.error('importProducts: duplicate lookup failed', { businessId, error: existingProductsResponse.error })
      return { error: existingProductsResponse.error.message ?? 'Unable to check existing products', success: false }
    }

    if (branchRowsResponse.error) {
      logger.error('importProducts: branch lookup failed', { businessId, error: branchRowsResponse.error })
      return { error: branchRowsResponse.error.message ?? 'Unable to validate branches', success: false }
    }

    const unitByName = new Map(
      ((existingUnitsResponse.data ?? []) as ImportedUnitRow[]).map((unitRow) => [unitRow.name.trim().toLowerCase(), unitRow])
    )
    const missingUnitRows = parsedProducts
      .filter((row) => !unitByName.has(row.unit.name.trim().toLowerCase()))
      .filter((row, index, self) => self.findIndex((item) => item.unit.name.trim().toLowerCase() === row.unit.name.trim().toLowerCase()) === index)

    if (missingUnitRows.length > 0) {
      const { data: createdUnits, error: createUnitsError } = await supabase
        .from('units_of_measure')
        .insert(
          missingUnitRows.map((row) => ({
            business_id: businessId,
            name: row.unit.name,
            abbreviation: row.unit.abbreviation,
            conversion_factor: row.unit.conversionFactor,
            is_base_unit: false,
            is_active: true,
            created_by: profile.id,
          }))
        )
        .select('id, name, conversion_factor')

      if (createUnitsError || !createdUnits) {
        logger.error('importProducts: UOM auto-create failed', { businessId, error: createUnitsError })
        return { error: createUnitsError?.message ?? 'Unable to create one or more units of measure', success: false }
      }

      ;((createdUnits ?? []) as ImportedUnitRow[]).forEach((unitRow) => {
        unitByName.set(unitRow.name.trim().toLowerCase(), unitRow)
      })
    }

    const branchByName = new Map<string, { id: string; name: string }>()

    if (requestedBranchNames.length > 0) {
      ;((branchRowsResponse.data ?? []) as Array<{ id: string; name: string }>).forEach((branch) => {
        branchByName.set(branch.name.trim().toLowerCase(), branch)
      })

      const missingBranch = requestedBranchNames.find((branchName) => !branchByName.has(branchName))

      if (missingBranch) {
        return { error: `Branch not found or inactive in spreadsheet: ${missingBranch}`, success: false }
      }
    }

    const existingSku = ((existingProductsResponse.data ?? []) as Array<{ sku: string }>)[0]?.sku
    if (existingSku) {
      return { error: `A product with SKU ${existingSku} already exists`, success: false }
    }

    const { data: insertedProducts, error: insertError } = await supabase
      .from('products')
      .insert(
        parsedProducts.map((row) => ({
          business_id: businessId,
          name: row.product.name,
          sku: row.product.sku,
          category: row.product.category,
          product_kind: row.classification.productKind,
          subcategory: row.classification.subcategory ?? null,
          brand_family: row.classification.brandFamily ?? null,
          unit: row.product.unit,
          description: row.product.description || null,
          is_active: true,
        }))
      )
      .select('id, name, sku, category, unit, description')

    if (insertError || !insertedProducts) {
      logger.error('importProducts: product batch insert failed', { businessId, error: insertError })
      return { error: insertError?.message ?? 'Unable to import products', success: false }
    }

    const productBySku = new Map(
      ((insertedProducts ?? []) as Array<{ id: string; name: string; sku: string; category: string; unit: string; description: string | null }>).map(
        (product) => [product.sku, product]
      )
    )

    const { error: pricingError } = await supabase.from('product_pricing').insert(
      parsedProducts.map((row) => {
        const product = productBySku.get(row.product.sku)

        if (!product) {
          throw new Error(`Inserted product missing for SKU ${row.product.sku}`)
        }

        return {
          business_id: businessId,
          product_id: product.id,
          base_price: row.pricing.basePrice,
          min_price: row.pricing.minPrice,
          max_price: row.pricing.maxPrice,
          set_by: profile.id,
        }
      })
    )

    if (pricingError) {
      logger.error('importProducts: pricing batch insert failed', { businessId, error: pricingError })
      await supabase.from('products').delete().eq('business_id', businessId).in('id', Array.from(productBySku.values()).map((product) => product.id))
      return { error: pricingError.message ?? 'Unable to save product pricing', success: false }
    }

    const productUomRows: ProductUOMInsertRow[] = parsedProducts.map((row) => {
      const product = productBySku.get(row.product.sku)
      const uom = unitByName.get(row.unit.name.trim().toLowerCase())

      if (!product) {
        throw new Error(`Inserted product missing for SKU ${row.product.sku}`)
      }

      if (!uom) {
        throw new Error(`Unit missing for product ${row.product.sku}`)
      }

      return {
        product_id: product.id,
        uom_id: uom.id,
        business_id: businessId,
        is_purchase_uom: true,
        is_sale_uom: true,
        is_base_uom: true,
        is_default_purchase_uom: true,
        is_default_sale_uom: true,
      }
    })

    const { error: uomLinkError } = await supabase.from('product_uom_links').insert(productUomRows)

    if (uomLinkError) {
      logger.error('importProducts: UOM link insert failed', { businessId, error: uomLinkError })
      return { error: uomLinkError.message ?? 'Unable to save product unit links', success: false }
    }

    const pricingModelRows: ProductPricingModelInsertRow[] = parsedProducts.flatMap((row) => {
      const product = productBySku.get(row.product.sku)

      if (!product) {
        throw new Error(`Inserted product missing for SKU ${row.product.sku}`)
      }

      const branchScopes = row.pricingModel.branchNames.length > 0
        ? row.pricingModel.branchNames.map((branchName) => ({ branchId: branchByName.get(branchName.trim().toLowerCase())?.id ?? null }))
        : [{ branchId: null }]

      return branchScopes.map((scope) => ({
        business_id: businessId,
        product_id: product.id,
        branch_id: scope.branchId,
        pricing_method: row.pricingModel.pricingMethod,
        rounding_rule: row.pricingModel.roundingRule,
        calculation_strategy: 'nearest_lower_pack_rate',
        status: 'approved',
        created_by: profile.id,
        approved_by: profile.id,
        approved_at: new Date().toISOString(),
      }))
    })

    const { data: insertedModels, error: pricingModelError } = await supabase
      .from('product_pricing_models')
      .insert(pricingModelRows)
      .select('id, product_id, branch_id')

    if (pricingModelError || !insertedModels) {
      logger.error('importProducts: pricing model insert failed', { businessId, error: pricingModelError })
      return { error: pricingModelError?.message ?? 'Unable to save product pricing models', success: false }
    }

    const modelRows = (insertedModels ?? []) as Array<{ id: string; product_id: string; branch_id: string | null }>
    const pricePointRows: ProductPricePointInsertRow[] = []

    parsedProducts.forEach((row) => {
      if (row.pricingModel.pricingMethod === 'fixed_price') {
        return
      }

      const product = productBySku.get(row.product.sku)
      const uom = unitByName.get(row.unit.name.trim().toLowerCase())

      if (!product || !uom) {
        return
      }

      const productModels = modelRows.filter((model) => model.product_id === product.id)

      productModels.forEach((model) => {
        row.pricingModel.points.forEach((point) => {
          pricePointRows.push({
            business_id: businessId,
            pricing_model_id: model.id,
            product_id: product.id,
            branch_id: model.branch_id,
            uom_id: uom.id,
            quantity_in_uom: point.quantity,
            base_quantity: point.quantity * Number(uom.conversion_factor ?? 1),
            price: point.price,
            max_discount_amount: 0,
            source: row.pricingModel.pricingMethod === 'assisted_pack' ? 'assisted_anchor' : 'manual',
          })
        })
      })
    })

    if (pricePointRows.length > 0) {
      for (const pricePointChunk of chunkRows(pricePointRows)) {
        const { error: pricePointError } = await supabase.from('product_price_points').insert(pricePointChunk)

        if (pricePointError) {
          logger.error('importProducts: price point insert failed', { businessId, error: pricePointError })
          return { error: pricePointError.message ?? 'Unable to save product price points', success: false }
        }
      }
    }

    const auditRows = Array.from(productBySku.values()).map((product) => ({
      business_id: businessId,
      actor_id: profile.id,
      entity_type: 'product',
      entity_id: product.id,
      action: 'created',
      old_value: null,
      new_value: {
        name: product.name,
        sku: product.sku,
        category: product.category,
        unit: product.unit,
        description: product.description,
        source: 'spreadsheet_import',
        imported_columns: 'advanced_product_pricing',
      },
    }))

    for (const auditChunk of chunkRows(auditRows)) {
      const { error: auditError } = await supabase.from('audit_logs').insert(auditChunk)

      if (auditError) {
        logger.error('importProducts: audit batch insert failed', { businessId, error: auditError })
        return { error: auditError.message ?? 'Unable to write audit logs', success: false }
      }
    }

    revalidateProductRoutes()
    logger.info('Products imported', { businessId, count: productBySku.size, actor: profile.id })

    return {
      error: null,
      success: true,
      message: `Imported ${productBySku.size} products successfully.`,
    }
  } catch (error: unknown) {
    logger.error('importProducts: unexpected error', { businessId, error })
    return { error: error instanceof Error ? error.message : 'Server error', success: false }
  }
}

/**
 * Soft-deletes a product while preserving historical transaction references.
 */
export async function deleteProduct(_prevState: FormState, formData: FormData): Promise<FormState> {
  const validation = deleteProductSchema.safeParse({
    productId: getString(formData, 'productId'),
    reason: getString(formData, 'reason') || undefined,
  })

  if (!validation.success) {
    return { error: validation.error.errors[0]?.message ?? 'Invalid product delete request', success: false }
  }

  const profile = await requireRole([GlobalRole.Owner])
  const businessId = profile.business_id

  if (!businessId) {
    logger.error('deleteProduct: missing business id on owner profile', { userId: profile.id })
    return { error: 'Business context missing', success: false }
  }

  try {
    const supabase = await createClient()

    const { data: productData, error: productError } = await supabase
      .from('products')
      .select('id, name, sku, is_active, deleted_at')
      .eq('business_id', businessId)
      .eq('id', validation.data.productId)
      .maybeSingle()

    if (productError) {
      logger.error('deleteProduct: lookup failed', { businessId, productId: validation.data.productId, error: productError })
      return { error: productError.message ?? 'Unable to load product', success: false }
    }

    const product = productData as { id: string; name: string; sku: string; is_active: boolean; deleted_at: string | null } | null

    if (!product) {
      return { error: 'Product not found', success: false }
    }

    if (product.deleted_at) {
      return { error: `${product.name} is already deleted`, success: false }
    }

    const { error: updateError } = await supabase
      .from('products')
      .update({
        is_active: false,
        deleted_at: new Date().toISOString(),
        deleted_by: profile.id,
        delete_reason: validation.data.reason ?? null,
      })
      .eq('business_id', businessId)
      .eq('id', product.id)

    if (updateError) {
      logger.error('deleteProduct: update failed', { businessId, productId: product.id, error: updateError })
      return { error: updateError.message ?? 'Unable to delete product', success: false }
    }

    const { error: auditError } = await supabase.from('audit_logs').insert({
      business_id: businessId,
      actor_id: profile.id,
      entity_type: 'product',
      entity_id: product.id,
      action: 'deleted',
      old_value: { name: product.name, sku: product.sku, is_active: product.is_active },
      new_value: { deleted_at: true, reason: validation.data.reason ?? null },
    })

    if (auditError) {
      logger.error('deleteProduct: audit insert failed', { businessId, productId: product.id, error: auditError })
      return { error: auditError.message ?? 'Product deleted, but audit log failed', success: false }
    }

    revalidateProductRoutes()
    logger.info('Product soft-deleted', { businessId, productId: product.id, actor: profile.id })
    return { error: null, success: true, message: 'Product deleted successfully.' }
  } catch (error: unknown) {
    logger.error('deleteProduct: unexpected error', { businessId, error })
    return { error: error instanceof Error ? error.message : 'Server error', success: false }
  }
}
