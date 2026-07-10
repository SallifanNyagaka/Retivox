/**
 * Shared stock dashboard data access for Retivox.
 *
 * Owner and admin routes call these helpers instead of duplicating branch
 * scoping logic. All branch visibility is resolved through contextual branch
 * roles, not through a user's global role.
 *
 * Throughput note: at very high sustained traffic, this dashboard layer will
 * need infrastructure decisions outside application code: Supavisor/PgBouncer
 * connection pooling, read replicas for list-heavy views, and possibly queued
 * writes for bursty stock mutations. Those are intentionally not implemented
 * here because they are deployment/runtime concerns.
 *
 * Required indexes:
 * - idx_branch_stock_business_branch_product for scoped current stock rows
 * - idx_branches_business_active_id for branch filters
 * - idx_supplier_deliveries_branch_recorded_at for delivery movement history
 * - idx_stock_transfers_from_branch_status and idx_stock_transfers_to_branch_status for transfer history
 * - idx_transactions_branch_recorded_at for sale deduction history
 */

import { getAccessibleBranchIds } from '../auth/branchAccess'
import logger from '../logger'
import { runSoftDeleteAwareQuery } from '../supabase/softDelete'
import { createClient } from '../supabase/server'
import type {
  BranchStockBranch,
  BranchStockProduct,
  BranchStockRow,
  BranchSummary,
  StockMetrics,
  StockDeliveryRow,
  StockDeliveryEditRequestRow,
  StockDeliveryItemCostRow,
  StockDeliveryItemRow,
  StockMovementRow,
  StockProductOption,
  StockUOMOption,
} from '../../app/dashboard/owner/stock/types'

/**
 * Payload returned to stock dashboard routes.
 */
export type StockDashboardData = {
  rows: BranchStockRow[]
  metrics: StockMetrics
  branches: BranchSummary[]
  products: StockProductOption[]
  movements: StockMovementRow[]
  deliveries: StockDeliveryRow[]
  deliveryEditRequests: StockDeliveryEditRequestRow[]
}

/**
 * Database row returned by the stock metrics RPC.
 */
type StockMetricsRpcRow = {
  total_skus: number
  low_stock_count: number
  out_of_stock_count: number
  branches_with_alerts: number
}

/**
 * Raw stock row returned by Supabase before join normalization.
 */
type RawBranchStockRow = Omit<BranchStockRow, 'products' | 'branches' | 'uom_options'> & {
  products: BranchStockProduct | BranchStockProduct[] | null
  branches: BranchStockBranch | BranchStockBranch[] | null
}

/**
 * Raw UOM join row returned by Supabase.
 */
type RawStockUOMJoin = {
  id: string
  name: string
  abbreviation: string
  conversion_factor: string | number
  is_base_unit: boolean
}

/**
 * Raw product/UOM link row used to hydrate stock display options.
 */
type RawProductUOMLinkRow = {
  product_id: string
  is_base_uom: boolean
  is_purchase_uom: boolean
  is_sale_uom: boolean
  is_default_sale_uom: boolean
  is_default_purchase_uom: boolean
  units_of_measure: RawStockUOMJoin | RawStockUOMJoin[] | null
}

/**
 * Raw product option row returned before UOM hydration.
 */
type RawStockProductOption = Omit<StockProductOption, 'uom_options'>

type RawSupplierDeliveryItemCost = {
  id: string
  description: string
  amount: string | number
}

type SupplierDeliveryItemSummary = {
  id: string
  product_id: string
  uom_id: string | null
  quantity_expected: number | null
  quantity_received: number | null
  quantity_in_uom: string | number | null
  base_quantity_expected: string | number | null
  base_quantity_received: string | number | null
  unit_cost: string | number | null
  total_cost: string | number | null
  notes: string | null
  products: BranchStockProduct | BranchStockProduct[] | null
  units_of_measure: { id: string; name: string; abbreviation: string } | Array<{ id: string; name: string; abbreviation: string }> | null
  supplier_delivery_item_costs: RawSupplierDeliveryItemCost[] | null
}

type RawSupplierDeliveryRow = {
  id: string
  to_branch_id: string
  supplier_name: string
  reference_code: string | null
  status: StockDeliveryRow['status']
  recorded_at: string
  branches: BranchStockBranch | BranchStockBranch[] | null
  supplier_delivery_items: SupplierDeliveryItemSummary[] | null
}

type RawDeliveryEditRequestRow = Omit<
  StockDeliveryEditRequestRow,
  'branch_name' | 'requested_by_name' | 'supplier_name' | 'reference_code'
> & {
  branches: BranchStockBranch | BranchStockBranch[] | null
  users: { name: string } | Array<{ name: string }> | null
  supplier_deliveries: { supplier_name: string; reference_code: string | null } | Array<{ supplier_name: string; reference_code: string | null }> | null
}

/**
 * Empty metrics used when a user has no branch access.
 */
const EMPTY_STOCK_METRICS: StockMetrics = {
  totalSkus: 0,
  lowStockCount: 0,
  outOfStockCount: 0,
  branchesWithAlerts: 0,
}

/**
 * Converts SQL snake_case metric output into the UI metric shape.
 */
function mapStockMetrics(row: StockMetricsRpcRow | null): StockMetrics {
  if (!row) {
    return EMPTY_STOCK_METRICS
  }

  return {
    totalSkus: row.total_skus,
    lowStockCount: row.low_stock_count,
    outOfStockCount: row.out_of_stock_count,
    branchesWithAlerts: row.branches_with_alerts,
  }
}

/**
 * Finds the default receiving unit used to interpret stock thresholds.
 */
function getDefaultReceivingUOM(row: BranchStockRow): StockUOMOption | null {
  const purchaseUoms = row.uom_options.filter((uom) => uom.is_purchase_uom)

  return purchaseUoms.find((uom) => uom.is_default_purchase_uom) ??
    [...purchaseUoms].sort((first, second) => second.conversion_factor - first.conversion_factor)[0] ??
    row.uom_options.find((uom) => uom.is_base_uom || uom.is_base_unit || uom.conversion_factor === 1) ??
    row.uom_options[0] ??
    null
}

/**
 * Converts the stored threshold value from receiving UOM into base units.
 */
function getBaseThreshold(row: BranchStockRow): number {
  return Number(row.low_stock_threshold ?? 0) * (getDefaultReceivingUOM(row)?.conversion_factor ?? 1)
}

/**
 * Calculates stock metrics after UOM hydration so thresholds use receiving UOMs.
 */
function calculateStockMetrics(rows: BranchStockRow[]): StockMetrics {
  return {
    totalSkus: rows.length,
    lowStockCount: rows.filter((row) => {
      const baseOnHand = Number(row.base_quantity_on_hand ?? row.quantity_on_hand)
      return baseOnHand > 0 && baseOnHand <= getBaseThreshold(row)
    }).length,
    outOfStockCount: rows.filter((row) => Number(row.base_quantity_on_hand ?? row.quantity_on_hand) === 0).length,
    branchesWithAlerts: new Set(
      rows
        .filter((row) => Number(row.base_quantity_on_hand ?? row.quantity_on_hand) <= getBaseThreshold(row))
        .map((row) => row.branch_id)
    ).size,
  }
}

/**
 * Converts a Supabase joined object or array into the array shape the UI expects.
 */
function normalizeJoin<Row>(value: Row | Row[] | null | undefined): Row[] | null {
  if (!value) {
    return null
  }

  return Array.isArray(value) ? value : [value]
}

/**
 * Normalizes product and branch joins for current stock rows.
 */
function normalizeStockRows(rows: RawBranchStockRow[], uomsByProduct: Map<string, StockUOMOption[]>): BranchStockRow[] {
  const groupedRows = new Map<string, BranchStockRow>()

  rows.forEach((row) => {
    const products = normalizeJoin(row.products)
    const branches = normalizeJoin(row.branches)
    const productId = products?.[0]?.id ?? ''
    const groupKey = `${row.branch_id}:${productId || row.id}`
    const quantityOnHand = Number(row.quantity_on_hand ?? 0)
    const quantityReserved = Number(row.quantity_reserved ?? 0)
    const baseQuantityOnHand = Number(row.base_quantity_on_hand ?? row.quantity_on_hand ?? 0)
    const baseQuantityReserved = Number(row.base_quantity_reserved ?? row.quantity_reserved ?? 0)
    const averageBaseUnitCost = Number(row.average_base_unit_cost ?? 0)
    const existingRow = groupedRows.get(groupKey)

    if (existingRow) {
      groupedRows.set(groupKey, {
        ...existingRow,
        quantity_on_hand: existingRow.quantity_on_hand + quantityOnHand,
        quantity_reserved: Number(existingRow.quantity_reserved ?? 0) + quantityReserved,
        base_quantity_on_hand: existingRow.base_quantity_on_hand + baseQuantityOnHand,
        base_quantity_reserved: Number(existingRow.base_quantity_reserved ?? 0) + baseQuantityReserved,
        low_stock_threshold: Math.max(existingRow.low_stock_threshold, Number(row.low_stock_threshold ?? 0)),
      })
      return
    }

    groupedRows.set(groupKey, {
      ...row,
      quantity_on_hand: quantityOnHand,
      quantity_reserved: quantityReserved,
      base_quantity_on_hand: baseQuantityOnHand,
      base_quantity_reserved: baseQuantityReserved,
      average_base_unit_cost: averageBaseUnitCost,
      products,
      branches,
      uom_options: uomsByProduct.get(productId) ?? [],
    })
  })

  return Array.from(groupedRows.values())
}

/**
 * Groups product/UOM links by product id for stock display conversion.
 */
function groupUOMLinksByProduct(rows: RawProductUOMLinkRow[]): Map<string, StockUOMOption[]> {
  const grouped = new Map<string, StockUOMOption[]>()

  rows.forEach((row) => {
    const uom = normalizeJoin(row.units_of_measure)?.[0]

    if (!uom) {
      return
    }

    const current = grouped.get(row.product_id) ?? []
    grouped.set(row.product_id, [
      ...current,
      {
        id: uom.id,
        name: uom.name,
        abbreviation: uom.abbreviation,
        conversion_factor: Number(uom.conversion_factor),
        is_base_unit: uom.is_base_unit,
        is_base_uom: row.is_base_uom,
        is_purchase_uom: row.is_purchase_uom,
        is_sale_uom: row.is_sale_uom,
        is_default_sale_uom: row.is_default_sale_uom,
        is_default_purchase_uom: row.is_default_purchase_uom,
      },
    ])
  })

  grouped.forEach((options, productId) => {
    grouped.set(
      productId,
      [...options].sort((first, second) =>
        Number(second.is_default_purchase_uom) - Number(first.is_default_purchase_uom) ||
        Number(second.is_default_sale_uom) - Number(first.is_default_sale_uom) ||
        Number(second.is_base_uom) - Number(first.is_base_uom) ||
        first.conversion_factor - second.conversion_factor
      )
    )
  })

  return grouped
}

/**
 * Attaches unit options to product dropdown rows.
 */
function mapProductOptions(rows: RawStockProductOption[], uomsByProduct: Map<string, StockUOMOption[]>): StockProductOption[] {
  return rows.map((row) => ({
    ...row,
    uom_options: uomsByProduct.get(row.id) ?? [],
  }))
}

function normalizeDeliveryRows(rows: RawSupplierDeliveryRow[]): StockDeliveryRow[] {
  return rows.map((row) => {
    const branch = normalizeJoin(row.branches)?.[0]
    const items = row.supplier_delivery_items ?? []
    const normalizedItems: StockDeliveryItemRow[] = items.map((item) => {
      const product = normalizeJoin(item.products)?.[0]
      const uom = normalizeJoin(item.units_of_measure)?.[0]
      const costs: StockDeliveryItemCostRow[] = (item.supplier_delivery_item_costs ?? []).map((cost) => ({
        id: cost.id,
        description: cost.description,
        amount: Number(cost.amount ?? 0),
      }))

      return {
        id: item.id,
        product_id: item.product_id,
        product_name: product?.name ?? 'Unknown product',
        uom_id: item.uom_id,
        uom_name: uom?.name ?? null,
        quantity_in_uom: item.quantity_in_uom === null ? null : Number(item.quantity_in_uom),
        base_quantity_expected: Number(item.base_quantity_expected ?? item.quantity_expected ?? 0),
        base_quantity_received: Number(item.base_quantity_received ?? item.quantity_received ?? 0),
        unit_cost: item.unit_cost === null ? null : Number(item.unit_cost),
        total_cost: item.total_cost === null ? null : Number(item.total_cost),
        notes: item.notes,
        costs,
      }
    })

    return {
      id: row.id,
      branch_id: row.to_branch_id,
      branch_name: branch?.name ?? 'Unknown branch',
      supplier_name: row.supplier_name,
      reference_code: row.reference_code,
      status: row.status,
      recorded_at: row.recorded_at,
      item_count: items.length,
      total_expected: items.reduce(
        (sum, item) => sum + Number(item.base_quantity_received ?? item.base_quantity_expected ?? item.quantity_expected ?? item.quantity_received ?? 0),
        0
      ),
      items: normalizedItems,
    }
  })
}

function normalizeDeliveryEditRequestRows(rows: RawDeliveryEditRequestRow[]): StockDeliveryEditRequestRow[] {
  return rows.map((row) => {
    const branch = normalizeJoin(row.branches)?.[0]
    const requester = normalizeJoin(row.users)?.[0]
    const delivery = normalizeJoin(row.supplier_deliveries)?.[0]

    return {
      ...row,
      branch_name: branch?.name ?? 'Unknown branch',
      requested_by_name: requester?.name ?? 'Unknown user',
      supplier_name: delivery?.supplier_name ?? 'Unknown supplier',
      reference_code: delivery?.reference_code ?? null,
    }
  })
}

/**
 * Loads stock rows, metrics, and branch filter options for a user.
 */
export async function getStockDashboardData(userId: string, businessId: string): Promise<StockDashboardData> {
  const supabase = await createClient()

  try {
    const branchIds = await getAccessibleBranchIds(userId, 'admin')

    if (branchIds.length === 0) {
      return {
        rows: [],
        metrics: EMPTY_STOCK_METRICS,
        branches: [],
        products: [],
        movements: [],
        deliveries: [],
        deliveryEditRequests: [],
      }
    }

    const [stockResponse, metricsResponse, branchesResponse, productsResponse, movementsResponse, deliveriesResponse, deliveryEditRequestsResponse] = await Promise.all([
      supabase
        .from('branch_stock')
        .select(
          `
          id,
          branch_id,
          quantity_on_hand,
          quantity_reserved,
          base_quantity_on_hand,
          base_quantity_reserved,
          low_stock_threshold,
          average_base_unit_cost,
          products!inner(id, name, sku),
          branches!inner(id, name)
        `
        )
        .eq('business_id', businessId)
        .in('branch_id', branchIds)
        .order('branch_id', { ascending: true })
        .range(0, 49),
      supabase.rpc('dashboard_stock_metrics', {
        p_branch_ids: branchIds,
      }),
      runSoftDeleteAwareQuery<BranchSummary>(
        () =>
          supabase
            .from('branches')
            .select('id, name')
            .eq('business_id', businessId)
            .eq('is_active', true)
            .in('id', branchIds)
            .is('deleted_at', null)
            .order('name', { ascending: true }),
        () =>
          supabase
            .from('branches')
            .select('id, name')
            .eq('business_id', businessId)
            .eq('is_active', true)
            .in('id', branchIds)
            .order('name', { ascending: true }),
        { table: 'branches', businessId, page: 'stock_dashboard' }
      ),
      runSoftDeleteAwareQuery<RawStockProductOption>(
        () =>
          supabase
            .from('products')
            .select('id, name, sku')
            .eq('business_id', businessId)
            .eq('is_active', true)
            .is('deleted_at', null)
            .order('name', { ascending: true })
            .range(0, 99),
        () =>
          supabase
            .from('products')
            .select('id, name, sku')
            .eq('business_id', businessId)
            .eq('is_active', true)
            .order('name', { ascending: true })
            .range(0, 99),
        { table: 'products', businessId, page: 'stock_dashboard' }
      ),
      supabase.rpc('dashboard_stock_movement_history', {
        p_branch_ids: branchIds,
        p_limit: 25,
        p_offset: 0,
      }),
      supabase
        .from('supplier_deliveries')
        .select(
          `
          id,
          to_branch_id,
          supplier_name,
          reference_code,
          status,
          recorded_at,
          branches!inner(id, name),
          supplier_delivery_items(
            id,
            product_id,
            uom_id,
            quantity_expected,
            quantity_received,
            quantity_in_uom,
            base_quantity_expected,
            base_quantity_received,
            unit_cost,
            total_cost,
            notes,
            products(id, name, sku),
            units_of_measure(id, name, abbreviation),
            supplier_delivery_item_costs(id, description, amount)
          )
        `
        )
        .eq('business_id', businessId)
        .in('to_branch_id', branchIds)
        .order('recorded_at', { ascending: false })
        .range(0, 49),
      supabase
        .from('supplier_delivery_edit_requests')
        .select(
          `
          id,
          delivery_id,
          branch_id,
          old_value,
          new_value,
          reason,
          requested_at,
          status,
          branches!inner(id, name),
          users!supplier_delivery_edit_requests_requested_by_fkey(name),
          supplier_deliveries!inner(supplier_name, reference_code)
        `
        )
        .eq('business_id', businessId)
        .in('branch_id', branchIds)
        .eq('status', 'pending_approval')
        .order('requested_at', { ascending: false })
        .range(0, 49),
    ])

    if (stockResponse.error) {
      throw stockResponse.error
    }

    if (metricsResponse.error) {
      throw metricsResponse.error
    }

    if (branchesResponse.error) {
      throw branchesResponse.error
    }

    if (productsResponse.error) {
      throw productsResponse.error
    }

    if (movementsResponse.error) {
      throw movementsResponse.error
    }

    if (deliveriesResponse.error) {
      throw deliveriesResponse.error
    }

    if (deliveryEditRequestsResponse.error) {
      throw deliveryEditRequestsResponse.error
    }

    const metricsRows = (metricsResponse.data ?? []) as StockMetricsRpcRow[]
    const stockRows = (stockResponse.data ?? []) as RawBranchStockRow[]
    const productOptionRows = (productsResponse.data ?? []) as RawStockProductOption[]
    const productIds = Array.from(
      new Set([
        ...stockRows.map((row) => normalizeJoin(row.products)?.[0]?.id).filter((productId): productId is string => Boolean(productId)),
        ...productOptionRows.map((product) => product.id),
      ])
    )
    let uomsByProduct = new Map<string, StockUOMOption[]>()

    if (productIds.length > 0) {
      const uomResponse = await supabase
        .from('product_uom_links')
        .select(
          `
          product_id,
          is_base_uom,
          is_purchase_uom,
          is_sale_uom,
          is_default_sale_uom,
          is_default_purchase_uom,
          units_of_measure!inner(id, name, abbreviation, conversion_factor, is_base_unit)
        `
        )
        .eq('business_id', businessId)
        .in('product_id', productIds)
        .order('is_default_purchase_uom', { ascending: false })

      if (uomResponse.error) {
        throw uomResponse.error
      }

      uomsByProduct = groupUOMLinksByProduct((uomResponse.data ?? []) as RawProductUOMLinkRow[])
    }

    const normalizedRows = normalizeStockRows(stockRows, uomsByProduct)

    return {
      rows: normalizedRows,
      metrics: normalizedRows.length > 0 ? calculateStockMetrics(normalizedRows) : mapStockMetrics(metricsRows[0] ?? null),
      branches: (branchesResponse.data ?? []) as BranchSummary[],
      products: mapProductOptions(productOptionRows, uomsByProduct),
      movements: (movementsResponse.data ?? []) as StockMovementRow[],
      deliveries: normalizeDeliveryRows((deliveriesResponse.data ?? []) as RawSupplierDeliveryRow[]),
      deliveryEditRequests: normalizeDeliveryEditRequestRows((deliveryEditRequestsResponse.data ?? []) as RawDeliveryEditRequestRow[]),
    }
  } catch (error: unknown) {
    logger.error('getStockDashboardData failed', { userId, businessId, error })
    throw error
  }
}
