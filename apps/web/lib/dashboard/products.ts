/**
 * Product dashboard data access for Retivox.
 *
 * Admin product visibility follows the product-section security model:
 * - the product catalog is business-wide, but only visible to users with at
 *   least one branch role in that business
 * - stock breakdown rows are scoped to branches where the user has admin-level
 *   access
 * - product mutation remains owner-only through owner server actions/RPCs
 *
 * Required indexes:
 * - idx_user_branch_roles_user_business_branch_role for branch role resolution
 * - idx_branch_stock_business_branch_product for scoped stock breakdowns
 * - idx_branches_business_active_id for branch labels
 * - idx_products_business_active_created_at for catalog paging if added later
 */

import { getUserBranchRoles, hasMinimumBranchRole } from '../auth/branchAccess'
import logger from '../logger'
import { runSoftDeleteAwareQuery } from '../supabase/softDelete'
import { createClient } from '../supabase/server'

/**
 * Pricing row joined to a product.
 */
export type ProductPricingRow = {
  base_price: string
  min_price: string
  max_price: string
}

/**
 * Price point row joined through a product pricing model.
 */
export type ProductPricePointRow = {
  quantity_in_uom: string | number
  base_quantity?: string | number
  uom_id?: string | null
  max_discount_amount?: string | number
  price: string | number
}

/**
 * Product pricing model row displayed in catalog tables.
 */
export type ProductPricingModelRow = {
  id: string
  branch_id: string | null
  pricing_method: 'fixed_price' | 'assisted_pack' | 'manual_quantity'
  rounding_rule: 'none' | 'nearest_5' | 'up_5' | 'down_5' | 'nearest_10'
  status: string
  product_price_points?: ProductPricePointRow[] | null
}

/**
 * Product row displayed in owner/admin catalog tables.
 */
export type ProductCatalogRow = {
  id: string
  name: string
  sku: string
  category: string
  subcategory?: string | null
  brand_family?: string | null
  product_kind?: 'fixed_package' | 'measured_counted'
  unit: string
  description: string | null
  is_active: boolean
  created_at: string
  product_pricing?: ProductPricingRow[] | null
  product_pricing_models?: ProductPricingModelRow[] | null
}

/**
 * Branch join row returned by Supabase nested selects.
 */
type BranchJoinRow = {
  id: string
  name: string
}

/**
 * Raw branch stock row for product breakdowns.
 */
type ProductStockRow = {
  product_id: string
  branch_id: string
  quantity_on_hand: number
  quantity_reserved: number
  low_stock_threshold: number
  branches?: BranchJoinRow | BranchJoinRow[] | null
}

/**
 * UI-safe branch stock breakdown row.
 */
export type ProductStockBreakdown = {
  productId: string
  branchId: string
  branchName: string
  quantityOnHand: number
  quantityReserved: number
  lowStockThreshold: number
}

/**
 * Product dashboard metric values.
 */
export type ProductDashboardMetrics = {
  totalProducts: number
  activeProducts: number
  categoriesCount: number
  averageBasePrice: number
}

/**
 * Product dashboard payload for admin and owner pages.
 */
export type ProductDashboardData = {
  products: ProductCatalogRow[]
  currency: string
  productStocks: ProductStockBreakdown[]
  assignedBranchCount: number
  metrics: ProductDashboardMetrics
}

/**
 * Calculates catalog metrics without extra database round trips.
 */
function calculateProductMetrics(products: ProductCatalogRow[]): ProductDashboardMetrics {
  const totalProducts = products.length
  const activeProducts = products.filter((product) => product.is_active).length
  const categoriesCount = new Set(products.map((product) => product.category)).size
  const totalBase = products.reduce((sum, product) => {
    const baseValue = Number(product.product_pricing?.[0]?.base_price ?? 0)
    return sum + baseValue
  }, 0)

  return {
    totalProducts,
    activeProducts,
    categoriesCount,
    averageBasePrice: totalProducts > 0 ? totalBase / totalProducts : 0,
  }
}

/**
 * Resolves a many-to-one Supabase branch join regardless of array/object shape.
 */
function getJoinedBranchName(branches: BranchJoinRow | BranchJoinRow[] | null | undefined): string {
  if (!branches) {
    return 'Unknown branch'
  }

  return Array.isArray(branches) ? branches[0]?.name ?? 'Unknown branch' : branches.name
}

/**
 * Maps raw branch stock rows into stable client props.
 */
function mapProductStocks(rows: ProductStockRow[]): ProductStockBreakdown[] {
  return rows.map((row) => ({
    productId: row.product_id,
    branchId: row.branch_id,
    branchName: getJoinedBranchName(row.branches),
    quantityOnHand: Number(row.quantity_on_hand),
    quantityReserved: Number(row.quantity_reserved),
    lowStockThreshold: Number(row.low_stock_threshold),
  }))
}

/**
 * Loads the admin product catalog and assigned-branch stock breakdown.
 */
export async function getAdminProductDashboardData(userId: string, businessId: string): Promise<ProductDashboardData> {
  const supabase = await createClient()

  try {
    const roles = await getUserBranchRoles(userId)
    const catalogBranchIds = roles
      .filter((role) => hasMinimumBranchRole(role.role, 'employee'))
      .map((role) => role.branch_id)
    const adminBranchIds = roles.filter((role) => hasMinimumBranchRole(role.role, 'admin')).map((role) => role.branch_id)

    const businessResponse = await supabase.from('businesses').select('currency').eq('id', businessId).single()

    if (businessResponse.error) {
      throw businessResponse.error
    }

    const business = businessResponse.data as { currency?: string } | null

    if (!business?.currency) {
      throw new Error('Business currency missing')
    }

    if (catalogBranchIds.length === 0) {
      return {
        products: [],
        currency: business.currency,
        productStocks: [],
        assignedBranchCount: 0,
        metrics: calculateProductMetrics([]),
      }
    }

    const productsResponse = await runSoftDeleteAwareQuery<ProductCatalogRow>(
      () =>
        supabase
          .from('products')
          .select(
            'id, name, sku, category, subcategory, brand_family, product_kind, unit, description, is_active, created_at, product_pricing(base_price, min_price, max_price), product_pricing_models(id, branch_id, pricing_method, rounding_rule, status, product_price_points(quantity_in_uom, base_quantity, uom_id, price, max_discount_amount))'
          )
          .eq('business_id', businessId)
          .is('deleted_at', null)
          .order('created_at', { ascending: false })
          .range(0, 49),
      () =>
        supabase
          .from('products')
          .select(
            'id, name, sku, category, subcategory, brand_family, product_kind, unit, description, is_active, created_at, product_pricing(base_price, min_price, max_price), product_pricing_models(id, branch_id, pricing_method, rounding_rule, status, product_price_points(quantity_in_uom, base_quantity, uom_id, price, max_discount_amount))'
          )
          .eq('business_id', businessId)
          .order('created_at', { ascending: false })
          .range(0, 49),
      { table: 'products', businessId, page: 'admin_products' }
    )

    if (productsResponse.error) {
      throw productsResponse.error
    }

    const products = (productsResponse.data ?? []) as ProductCatalogRow[]
    const productIds = products.map((product) => product.id)

    if (adminBranchIds.length === 0 || productIds.length === 0) {
      return {
        products,
        currency: business.currency,
        productStocks: [],
        assignedBranchCount: adminBranchIds.length,
        metrics: calculateProductMetrics(products),
      }
    }

    const stockResponse = await supabase
      .from('branch_stock')
      .select('product_id, branch_id, quantity_on_hand, quantity_reserved, low_stock_threshold, branches!inner(id, name)')
      .eq('business_id', businessId)
      .in('branch_id', adminBranchIds)
      .in('product_id', productIds)
      .order('branch_id', { ascending: true })
      .range(0, 499)

    if (stockResponse.error) {
      throw stockResponse.error
    }

    return {
      products,
      currency: business.currency,
      productStocks: mapProductStocks((stockResponse.data ?? []) as ProductStockRow[]),
      assignedBranchCount: adminBranchIds.length,
      metrics: calculateProductMetrics(products),
    }
  } catch (error: unknown) {
    logger.error('getAdminProductDashboardData failed', { userId, businessId, error })
    throw error
  }
}
