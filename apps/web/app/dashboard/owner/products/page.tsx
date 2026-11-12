/**
 * Owner products page for Retivox.
 *
 * Fetches product catalog, pricing bounds, and business currency on the server,
 * then renders the client-side products management interface.
 */

import { requireRole } from '../../../../lib/auth/helpers'
import { GlobalRole } from '@smartretail/shared'
import { createClient } from '../../../../lib/supabase/server'
import { runSoftDeleteAwareQuery } from '../../../../lib/supabase/softDelete'
import { getAllUOMsForBusiness, getUOMsForBusiness } from '../../../../lib/uom/server'
import logger from '../../../../lib/logger'
import ProductsPageClient from './ProductsPageClient'

type ProductPricingRow = {
  base_price: string
  min_price: string
  max_price: string
}

type ProductPricePointRow = {
  quantity_in_uom: string | number
  base_quantity?: string | number
  uom_id?: string | null
  max_discount_amount?: string | number
  price: string | number
}

type ProductPricingModelRow = {
  id: string
  branch_id: string | null
  pricing_method: 'fixed_price' | 'assisted_pack' | 'manual_quantity'
  rounding_rule: 'none' | 'nearest_5' | 'up_5' | 'down_5' | 'nearest_10'
  status: string
  product_price_points?: ProductPricePointRow[] | null
}

type ProductUOMLinkRow = {
  id: string
  uom_id: string
  is_purchase_uom: boolean
  is_sale_uom: boolean
  is_base_uom: boolean
  is_default_purchase_uom: boolean
  is_default_sale_uom: boolean
}

type ProductRow = {
  id: string
  name: string
  sku: string
  category: string
  subcategory: string | null
  brand_family: string | null
  product_kind: 'fixed_package' | 'measured_counted'
  unit: string
  description: string | null
  tracks_expiry: boolean
  barcodes?: string[]
  is_active: boolean
  created_at: string
  product_pricing?: ProductPricingRow[] | null
  product_pricing_models?: ProductPricingModelRow[] | null
  product_uom_links?: ProductUOMLinkRow[] | null
}

type LegacyProductRow = {
  id: string
  name: string
  sku: string
  category: string
  unit: string
  description: string | null
  tracks_expiry?: boolean
  is_active: boolean
  created_at: string
  product_pricing?: ProductPricingRow[] | null
  product_pricing_models?: ProductPricingModelRow[] | null
  product_uom_links?: ProductUOMLinkRow[] | null
}

type BranchOption = {
  id: string
  name: string
}

type QueryErrorLike = {
  code?: string
  message?: string
  details?: string | null
  hint?: string | null
}

const PRODUCT_SELECT_WITH_CLASSIFICATION =
  'id, name, sku, category, subcategory, brand_family, product_kind, unit, description, tracks_expiry, is_active, created_at, product_pricing(base_price, min_price, max_price), product_uom_links(id, uom_id, is_purchase_uom, is_sale_uom, is_base_uom, is_default_purchase_uom, is_default_sale_uom), product_pricing_models(id, branch_id, pricing_method, rounding_rule, status, product_price_points(quantity_in_uom, base_quantity, uom_id, price, max_discount_amount))'

const PRODUCT_SELECT_LEGACY =
  'id, name, sku, category, unit, description, is_active, created_at, product_pricing(base_price, min_price, max_price)'

/**
 * Detects schema rollout errors for the additive product/UOM migrations.
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
 * Adapts legacy product rows to the richer product shape used by the UI.
 */
function normalizeLegacyProduct(row: LegacyProductRow): ProductRow {
  return {
    ...row,
    subcategory: null,
    brand_family: null,
    product_kind: 'fixed_package',
    tracks_expiry: row.tracks_expiry ?? false,
  }
}

export default async function ProductsPage() {
  const profile = await requireRole([GlobalRole.Owner])
  const profileBusinessId = profile.business_id

  if (!profileBusinessId) {
    throw new Error('Owner profile missing business ID')
  }

  const businessId = profileBusinessId
  const supabase = await createClient()

  /**
   * Fetches products using the new classification fields, then safely falls
   * back to the legacy select while migrations are being applied.
   */
  async function loadProducts(): Promise<ProductRow[]> {
    const productsResponse = await runSoftDeleteAwareQuery<ProductRow>(
      () =>
        supabase
          .from('products')
          .select(PRODUCT_SELECT_WITH_CLASSIFICATION)
          .eq('business_id', businessId)
          .is('deleted_at', null)
          .order('created_at', { ascending: false })
          .range(0, 49),
      () =>
        supabase
          .from('products')
          .select(PRODUCT_SELECT_WITH_CLASSIFICATION)
          .eq('business_id', businessId)
          .order('created_at', { ascending: false })
          .range(0, 49),
      { table: 'products', businessId, page: 'owner_products' }
    )

    if (!productsResponse.error) {
      const rows = (productsResponse.data ?? []) as ProductRow[]
      if (rows.length === 0) return rows
      try {
        const barcodeResponse = await supabase
          .from('product_barcodes')
          .select('product_id, code')
          .eq('business_id', businessId)
          .eq('is_active', true)
          .in('product_id', rows.map((product) => product.id))
        if (barcodeResponse.error) throw barcodeResponse.error
        const barcodesByProduct = new Map<string, string[]>()
        for (const barcode of barcodeResponse.data ?? []) {
          const codes = barcodesByProduct.get(barcode.product_id) ?? []
          codes.push(barcode.code)
          barcodesByProduct.set(barcode.product_id, codes)
        }
        return rows.map((product) => ({ ...product, barcodes: barcodesByProduct.get(product.id) ?? [] }))
      } catch (error) {
        logger.warn('Product barcodes could not be loaded', { businessId, error })
        return rows.map((product) => ({ ...product, barcodes: [] }))
      }
    }

    if (!isSchemaRolloutError(productsResponse.error)) {
      throw productsResponse.error
    }

    logger.warn('Product classification columns missing; retrying owner products with legacy select', {
      businessId,
      page: 'owner_products',
      error: productsResponse.error,
    })

    const legacyResponse = await runSoftDeleteAwareQuery<LegacyProductRow>(
      () =>
        supabase
          .from('products')
          .select(PRODUCT_SELECT_LEGACY)
          .eq('business_id', businessId)
          .is('deleted_at', null)
          .order('created_at', { ascending: false })
          .range(0, 49),
      () =>
        supabase
          .from('products')
          .select(PRODUCT_SELECT_LEGACY)
          .eq('business_id', businessId)
          .order('created_at', { ascending: false })
          .range(0, 49),
      { table: 'products', businessId, page: 'owner_products_legacy' }
    )

    if (legacyResponse.error) {
      throw legacyResponse.error
    }

    return ((legacyResponse.data ?? []) as LegacyProductRow[]).map((row) => ({ ...normalizeLegacyProduct(row), barcodes: [] }))
  }

  /**
   * Fetches UOM records without blocking the page when the additive migration
   * has not reached the current database yet.
   */
  async function loadUOMs() {
    try {
      return await getUOMsForBusiness(businessId)
    } catch (error: unknown) {
      if (!isSchemaRolloutError(error)) {
        throw error
      }

      logger.warn('UOM tables missing; rendering owner products without UOM choices', {
        businessId,
        page: 'owner_products',
        error,
      })

      return []
    }
  }

  const [products, businessResponse, uoms, branchesResponse] = await Promise.all([
    loadProducts(),
    supabase.from('businesses').select('currency').eq('id', businessId).single(),
    loadUOMs(),
    runSoftDeleteAwareQuery<BranchOption>(
      () =>
        supabase
          .from('branches')
          .select('id, name')
          .eq('business_id', businessId)
          .eq('is_active', true)
          .is('deleted_at', null)
          .order('name', { ascending: true }),
      () =>
        supabase
          .from('branches')
          .select('id, name')
          .eq('business_id', businessId)
          .eq('is_active', true)
          .order('name', { ascending: true }),
      { table: 'branches', businessId, page: 'owner_products_pricing_setup' }
    ),
  ])

  const allUoms = await (async () => {
    try {
      return await getAllUOMsForBusiness(businessId)
    } catch (error: unknown) {
      if (!isSchemaRolloutError(error)) {
        throw error
      }

      logger.warn('UOM tables missing; rendering owner products without full UOM library', {
        businessId,
        page: 'owner_products_units_library',
        error,
      })

      return uoms
    }
  })()

  if (businessResponse.error) {
    throw businessResponse.error
  }

  if (branchesResponse.error) {
    throw branchesResponse.error
  }

  const branches = (branchesResponse.data ?? []) as BranchOption[]
  const business = businessResponse.data as { currency?: string } | null

  if (!business?.currency) {
    throw new Error('Business currency missing')
  }

  const currency = business.currency

  const totalProducts = products.length
  const activeProducts = products.filter((product) => product.is_active).length
  const categoriesCount = new Set(products.map((product) => product.category)).size

  const totalBase = products.reduce((sum, product) => {
    const baseValue = Number(product.product_pricing?.[0]?.base_price ?? 0)
    return sum + baseValue
  }, 0)
  const averageBasePrice = totalProducts > 0 ? totalBase / totalProducts : 0

  return (
    <ProductsPageClient
      products={products}
      currency={currency}
      uoms={uoms}
      allUoms={allUoms}
      branches={branches}
      metrics={{
        totalProducts,
        activeProducts,
        categoriesCount,
        averageBasePrice,
      }}
    />
  )
}
