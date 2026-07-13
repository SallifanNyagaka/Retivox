/**
 * Owner dashboard data fetching functions.
 *
 * All functions are server-side only — they use the Supabase server client
 * and are called from Server Components directly.
 * Each function fetches only the columns it needs — no SELECT *.
 * Performance: queries are scoped to business_id via RLS automatically.
 */

import { createClient } from '../supabase/server'
import { runSoftDeleteAwareQuery } from '../supabase/softDelete'
import logger from '../logger'

type StockAlertProduct = {
  id: string
  name: string
  sku?: string | null
}

type StockAlertRow = {
  id: string
  branch_id: string
  quantity_on_hand: number
  base_quantity_on_hand?: number | null
  low_stock_threshold: number
  products: StockAlertProduct | StockAlertProduct[] | null
  branches: { name: string } | Array<{ name: string }> | null
}

type ProductUOMAlertRow = {
  product_id: string
  is_base_uom: boolean
  is_purchase_uom: boolean
  is_default_purchase_uom: boolean
  units_of_measure: {
    id: string
    name: string
    conversion_factor: string | number
    is_base_unit: boolean
  } | Array<{
    id: string
    name: string
    conversion_factor: string | number
    is_base_unit: boolean
  }> | null
}

function normalizeJoin<Row>(value: Row | Row[] | null | undefined): Row[] {
  if (!value) {
    return []
  }

  return Array.isArray(value) ? value : [value]
}

function getAlertProductId(row: StockAlertRow): string {
  return normalizeJoin(row.products)[0]?.id ?? ''
}

async function getActiveBranchIds(businessId: string): Promise<string[]> {
  const supabase = await createClient()

  try {
    const { data } = await runSoftDeleteAwareQuery<{ id: string }>(
      () =>
        supabase
          .from('branches')
          .select('id')
          .eq('business_id', businessId)
          .eq('is_active', true)
          .is('deleted_at', null),
      () =>
        supabase
          .from('branches')
          .select('id')
          .eq('business_id', businessId)
          .eq('is_active', true),
      { table: 'branches', businessId, page: 'owner_active_branch_scope' }
    )

    return (data ?? []).map((branch) => branch.id)
  } catch (error) {
    logger.error('Failed to fetch active branch scope', { businessId, error })
    return []
  }
}

/**
 * Fetches summary metrics for the owner dashboard.
 * Returns total revenue, transaction count and pending approvals for today.
 */
export async function getOwnerMetrics(businessId: string) {
  const supabase = await createClient()

  // Get today's date range
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const todayStart = today.toISOString()

  try {
    // Total revenue today — sum of verified payments
    const activeBranchIds = await getActiveBranchIds(businessId)

    if (activeBranchIds.length === 0) {
      return { totalRevenue: 0, txCount: 0, pendingApprovals: 0 }
    }

    const { data: revenueData } = await supabase
      .from('payments')
      .select('amount, transactions!inner(branch_id)')
      .eq('business_id', businessId)
      .eq('status', 'verified')
      .in('transactions.branch_id', activeBranchIds)
      .gte('payment_at', todayStart)

    const totalRevenue = revenueData?.reduce((sum, p) => sum + Number(p.amount), 0) ?? 0

    // Transaction count today
    const { count: txCount } = await supabase
      .from('transactions')
      .select('id', { count: 'exact', head: true })
      .eq('business_id', businessId)
      .in('branch_id', activeBranchIds)
      .gte('recorded_at', todayStart)

    // Pending payments verification
    const { count: pendingPayments } = await supabase
      .from('payments')
      .select('id, transactions!inner(branch_id)', { count: 'exact', head: true })
      .eq('business_id', businessId)
      .eq('status', 'pending_verify')
      .in('transactions.branch_id', activeBranchIds)

    // Pending price change requests
    const { count: pendingPrices } = await supabase
      .from('price_change_requests')
      .select('id, branch_product_prices!inner(branch_id)', { count: 'exact', head: true })
      .eq('business_id', businessId)
      .eq('status', 'pending_approval')
      .in('branch_product_prices.branch_id', activeBranchIds)

    return {
      totalRevenue,
      txCount: txCount ?? 0,
      pendingApprovals: (pendingPayments ?? 0) + (pendingPrices ?? 0),
    }
  } catch (error) {
    logger.error('Failed to fetch owner metrics', { businessId, error })
    return { totalRevenue: 0, txCount: 0, pendingApprovals: 0 }
  }
}

/**
 * Fetches all branches for the business with their today's revenue.
 */
export async function getBranchSummaries(businessId: string) {
  const supabase = await createClient()

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const todayStart = today.toISOString()

  try {
    const activeBranchIds = await getActiveBranchIds(businessId)

    // Get all branches
    const { data: branches } = await runSoftDeleteAwareQuery<{
      id: string
      name: string
      location: string
      branch_type: string
      is_active: boolean
    }>(
      () =>
        supabase
          .from('branches')
          .select('id, name, location, branch_type, is_active')
          .eq('business_id', businessId)
          .is('deleted_at', null)
          .order('created_at', { ascending: true }),
      () =>
        supabase
          .from('branches')
          .select('id, name, location, branch_type, is_active')
          .eq('business_id', businessId)
          .order('created_at', { ascending: true }),
      { table: 'branches', businessId, page: 'owner_dashboard_summary' }
    )

    if (!branches) return []
    if (activeBranchIds.length === 0) return branches.map((branch) => ({ ...branch, todayRevenue: 0 }))

    // Get today's revenue per branch
    const { data: payments } = await supabase
      .from('payments')
      .select('amount, transaction_id, transactions!inner(branch_id)')
      .eq('business_id', businessId)
      .eq('status', 'verified')
      .in('transactions.branch_id', activeBranchIds)
      .gte('payment_at', todayStart)

    // Calculate revenue per branch
    const revenueByBranch: Record<string, number> = {}
    payments?.forEach((p) => {
      const tx = p.transactions as unknown as { branch_id: string }
      if (tx?.branch_id) {
        revenueByBranch[tx.branch_id] = (revenueByBranch[tx.branch_id] ?? 0) + Number(p.amount)
      }
    })

    return branches.map((branch) => ({
      ...branch,
      todayRevenue: revenueByBranch[branch.id] ?? 0,
    }))
  } catch (error) {
    logger.error('Failed to fetch branch summaries', { businessId, error })
    return []
  }
}

/**
 * Fetches stock alerts — products below low stock threshold.
 */
export async function getStockAlerts(businessId: string, branchIds?: string[], limit = 5) {
  const supabase = await createClient()

  try {
    const activeBranchIds = branchIds && branchIds.length > 0 ? branchIds : await getActiveBranchIds(businessId)

    if (activeBranchIds.length === 0) {
      return []
    }

    let stockQuery = supabase
      .from('branch_stock')
      .select(`
        id,
        branch_id,
        quantity_on_hand,
        base_quantity_on_hand,
        low_stock_threshold,
        products!inner(id, name, sku),
        branches!inner(name)
      `)
      .eq('business_id', businessId)
      .in('branch_id', activeBranchIds)
      .is('branches.deleted_at', null)

    const { data, error } = await stockQuery.order('quantity_on_hand', { ascending: true }).limit(100)

    if (error) {
      throw error
    }

    const stockRows = (data ?? []) as StockAlertRow[]
    const productIds = Array.from(new Set(stockRows.map(getAlertProductId).filter(Boolean)))
    const conversionByProduct = new Map<string, { receivingName: string; baseName: string; factor: number }>()

    if (productIds.length > 0) {
      const { data: uomRows, error: uomError } = await supabase
        .from('product_uom_links')
        .select(`
          product_id,
          is_base_uom,
          is_purchase_uom,
          is_default_purchase_uom,
          units_of_measure!inner(id, name, conversion_factor, is_base_unit)
        `)
        .eq('business_id', businessId)
        .in('product_id', productIds)

      if (uomError) {
        throw uomError
      }

      const grouped = new Map<string, ProductUOMAlertRow[]>()
      ;((uomRows ?? []) as ProductUOMAlertRow[]).forEach((row) => {
        grouped.set(row.product_id, [...(grouped.get(row.product_id) ?? []), row])
      })

      grouped.forEach((rows, productId) => {
        const baseRow = rows.find((row) => {
          const unit = normalizeJoin(row.units_of_measure)[0]
          return row.is_base_uom || unit?.is_base_unit || Number(unit?.conversion_factor ?? 0) === 1
        })
        const receivingRow =
          rows.find((row) => row.is_purchase_uom && row.is_default_purchase_uom) ??
          rows
            .filter((row) => row.is_purchase_uom)
            .sort((first, second) => {
              const firstUnit = normalizeJoin(first.units_of_measure)[0]
              const secondUnit = normalizeJoin(second.units_of_measure)[0]
              return Number(secondUnit?.conversion_factor ?? 1) - Number(firstUnit?.conversion_factor ?? 1)
            })[0] ??
          baseRow ??
          rows[0]
        const receivingUnit = normalizeJoin(receivingRow?.units_of_measure)[0]
        const baseUnit = normalizeJoin(baseRow?.units_of_measure)[0] ?? receivingUnit

        if (receivingUnit) {
          conversionByProduct.set(productId, {
            receivingName: receivingUnit.name,
            baseName: baseUnit?.name ?? 'base units',
            factor: Number(receivingUnit.conversion_factor ?? 1),
          })
        }
      })
    }

    return stockRows
      .map((row) => {
        const productId = getAlertProductId(row)
        const conversion = conversionByProduct.get(productId) ?? { receivingName: 'units', baseName: 'base units', factor: 1 }
        const baseQuantityOnHand = Number(row.base_quantity_on_hand ?? row.quantity_on_hand)
        const baseLowStockThreshold = Number(row.low_stock_threshold ?? 0) * conversion.factor

        return {
          ...row,
          products: normalizeJoin(row.products),
          branches: normalizeJoin(row.branches),
          base_quantity_on_hand: baseQuantityOnHand,
          base_low_stock_threshold: baseLowStockThreshold,
          threshold_uom_name: conversion.receivingName,
          base_uom_name: conversion.baseName,
          threshold_conversion_factor: conversion.factor,
        }
      })
      .filter((row) => Number(row.base_quantity_on_hand) <= Number(row.base_low_stock_threshold))
      .sort((first, second) => Number(first.base_quantity_on_hand) - Number(second.base_quantity_on_hand))
      .slice(0, limit)
  } catch (error) {
    logger.error('Failed to fetch stock alerts', { businessId, error })
    return []
  }
}

/**
 * Fetches pending approvals for the owner — payments and price changes.
 */
export async function getPendingApprovals(businessId: string) {
  const supabase = await createClient()

  try {
    const activeBranchIds = await getActiveBranchIds(businessId)

    if (activeBranchIds.length === 0) {
      return { payments: [], prices: [] }
    }

    // Pending payment verifications
    const { data: pendingPayments } = await supabase
      .from('payments')
      .select(`
        id,
        amount,
        payment_method,
        cash_deposit_code,
        mpesa_ref_code,
        payment_at,
        transactions!inner(branch_id, employee_id, branches!inner(name), users!inner(name))
      `)
      .eq('business_id', businessId)
      .eq('status', 'pending_verify')
      .in('transactions.branch_id', activeBranchIds)
      .order('payment_at', { ascending: false })
      .limit(5)

    // Pending price change requests
    const { data: pendingPrices } = await supabase
      .from('price_change_requests')
      .select(`
        id,
        old_price,
        new_price,
        requested_at,
        branch_product_prices!inner(
          products!inner(name),
          branches!inner(name)
        ),
        users!inner(name)
      `)
      .eq('business_id', businessId)
      .eq('status', 'pending_approval')
      .in('branch_product_prices.branch_id', activeBranchIds)
      .order('requested_at', { ascending: false })
      .limit(5)

    return {
      payments: pendingPayments ?? [],
      prices: pendingPrices ?? [],
    }
  } catch (error) {
    logger.error('Failed to fetch pending approvals', { businessId, error })
    return { payments: [], prices: [] }
  }
}

/**
 * Fetches recent transactions across all branches.
 */
export async function getRecentTransactions(businessId: string) {
  const supabase = await createClient()

  try {
    const activeBranchIds = await getActiveBranchIds(businessId)

    if (activeBranchIds.length === 0) {
      return []
    }

    const { data } = await supabase
      .from('transactions')
      .select(`
        id,
        total_amount,
        status,
        recorded_at,
        branches!inner(name),
        users!inner(name)
      `)
      .eq('business_id', businessId)
      .in('branch_id', activeBranchIds)
      .is('branches.deleted_at', null)
      .order('recorded_at', { ascending: false })
      .limit(10)

    return data ?? []
  } catch (error) {
    logger.error('Failed to fetch recent transactions', { businessId, error })
    return []
  }
}

/**
 * Fetches current stock for all branches and products in the business.
 */
export async function getBranchStock(businessId: string) {
  const supabase = await createClient()

  try {
    const activeBranchIds = await getActiveBranchIds(businessId)

    if (activeBranchIds.length === 0) {
      return []
    }

    const { data } = await supabase
      .from('branch_stock')
      .select(`
        id,
        branch_id,
        product_id,
        quantity_on_hand,
        quantity_reserved,
        base_quantity_on_hand,
        base_quantity_reserved,
        low_stock_threshold,
        products!inner(id, name, sku),
        branches!inner(id, name)
      `)
      .eq('business_id', businessId)
      .in('branch_id', activeBranchIds)
      .is('branches.deleted_at', null)
      .order('branch_id', { ascending: true })

    return data ?? []
  } catch (error) {
    logger.error('Failed to fetch branch stock', { businessId, error })
    return []
  }
}

/**
 * Calculates stock metrics: total SKUs, low stock count, out of stock count, branches with alerts.
 */
export async function getStockMetrics(businessId: string) {
  const supabase = await createClient()

  try {
    const activeBranchIds = await getActiveBranchIds(businessId)

    if (activeBranchIds.length === 0) {
      return {
        totalSkus: 0,
        lowStockCount: 0,
        outOfStockCount: 0,
        branchesWithAlerts: 0,
      }
    }

    const { data: stockData } = await supabase
      .from('branch_stock')
      .select('quantity_on_hand, low_stock_threshold, branch_id')
      .eq('business_id', businessId)
      .in('branch_id', activeBranchIds)

    if (!stockData) {
      return {
        totalSkus: 0,
        lowStockCount: 0,
        outOfStockCount: 0,
        branchesWithAlerts: 0,
      }
    }

    const totalSkus = stockData.length
    const lowStockCount = stockData.filter(
      (s) => s.quantity_on_hand > 0 && s.quantity_on_hand <= s.low_stock_threshold
    ).length
    const outOfStockCount = stockData.filter((s) => s.quantity_on_hand === 0).length
    const branchesWithAlerts = new Set(
      stockData
        .filter((s) => s.quantity_on_hand <= s.low_stock_threshold)
        .map((s) => s.branch_id)
    ).size

    return {
      totalSkus,
      lowStockCount,
      outOfStockCount,
      branchesWithAlerts,
    }
  } catch (error) {
    logger.error('Failed to fetch stock metrics', { businessId, error })
    return {
      totalSkus: 0,
      lowStockCount: 0,
      outOfStockCount: 0,
      branchesWithAlerts: 0,
    }
  }
}

/**
 * Fetches all branches for the business for filtering purposes.
 */
export async function getAllBranches(businessId: string) {
  const supabase = await createClient()

  try {
    const { data } = await runSoftDeleteAwareQuery<{ id: string; name: string }>(
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
      { table: 'branches', businessId, page: 'owner_branch_filter' }
    )

    return data ?? []
  } catch (error) {
    logger.error('Failed to fetch branches', { businessId, error })
    return []
  }
}
