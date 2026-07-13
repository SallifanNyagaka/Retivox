/**
 * Owner finances page.
 *
 * Profit is owner-only because it exposes cost basis and margins. The page
 * reads stamped transaction-line costs instead of recalculating from current
 * inventory, so historic sales remain auditable.
 */

import { GlobalRole, formatCurrency } from '@smartretail/shared'
import { Card, CardHeader } from '../../../../components/ui/Card'
import { MetricCard } from '../../../../components/dashboard/MetricCard'
import { requireRole } from '../../../../lib/auth/helpers'
import logger from '../../../../lib/logger'
import { createClient } from '../../../../lib/supabase/server'
import FinanceControls, { type LossProductOption } from './FinanceControls'
import FinanceFilters from './FinanceFilters'
import PendingEmployeeDamageReportsTable, { type PendingEmployeeDamageReportRow } from './PendingEmployeeDamageReportsTable'
import RecurringExpensePanel, {
  type RecurringExpenseInstance,
  type RecurringExpenseTemplate,
} from './RecurringExpensePanel'

type JoinedOne<T> = T | T[] | null

type FinanceTransactionItemRow = {
  product_id: string | null
  line_total: number | string
  line_discount_amount: number | string | null
  net_line_total: number | string | null
  line_cost: number | string | null
  gross_profit: number | string | null
  base_quantity: number | string | null
  products: JoinedOne<{
    name: string
    sku: string | null
  }>
}

type FinanceTransactionRow = {
  id: string
  total_amount: number | string
  discount_amount: number | string
  recorded_at: string
  branch_id: string | null
  branches: JoinedOne<{
    name: string
  }>
  transaction_items: FinanceTransactionItemRow[] | null
}

type FinanceGroup = {
  id: string
  label: string
  secondary?: string | null
  quantity: number
  revenue: number
  cost: number
  profit: number
}

type FinanceSummary = {
  revenue: number
  cost: number
  grossProfit: number
  operatingExpenses: number
  stockIntakeCosts: number
  inventoryLosses: number
  netProfit: number
  margin: number
  netMargin: number
  transactionCount: number
  bestStore: FinanceGroup | null
  byBranch: FinanceGroup[]
  byProduct: FinanceGroup[]
  expenseGroups: FinanceGroup[]
  stockCostGroups: FinanceGroup[]
  lossGroups: FinanceGroup[]
  recentExpenses: FinanceExpenseRow[]
  recentStockCosts: FinanceStockCostRow[]
  recentLosses: FinanceLossRow[]
}

type FinanceExpenseRow = {
  id: string
  branch_id: string | null
  category: string
  description: string
  amount: number | string
  incurred_on: string
  branches: JoinedOne<{ name: string }>
}

type FinanceLossRow = {
  id: string
  branch_id: string
  product_id: string
  loss_type: string
  reason: string
  quantity_in_uom: number | string
  base_quantity: number | string
  gross_cost: number | string
  recoverable_amount: number | string
  net_loss: number | string
  created_at: string
  branches: JoinedOne<{ name: string }>
  products: JoinedOne<{ name: string; sku: string | null }>
  units_of_measure: JoinedOne<{ name: string }>
}

type FinanceStockCostRow = {
  id: string
  delivery_item_id: string
  description: string
  amount: number | string
  created_at: string
  supplier_delivery_items: JoinedOne<{
    product_id: string
    products: JoinedOne<{ name: string; sku: string | null }>
    supplier_deliveries: JoinedOne<{
      supplier_name: string | null
      to_branch_id: string | null
      branches: JoinedOne<{ name: string }>
    }>
  }>
}

type BranchOption = {
  id: string
  name: string
}

type RawFinanceStockRow = {
  branch_id: string
  product_id: string
  base_quantity_on_hand: number | string
  base_quantity_reserved: number | string | null
  average_base_unit_cost: number | string | null
  branches: JoinedOne<{ name: string }>
  products: JoinedOne<{ id: string; name: string; sku: string | null }>
}

type RawFinanceUomLinkRow = {
  product_id: string
  is_base_uom: boolean
  units_of_measure: JoinedOne<{
    id: string
    name: string
    abbreviation: string | null
    conversion_factor: number | string
    is_base_unit: boolean
  }>
}

type RawFinanceDeliveryItemCostRow = {
  amount: number | string
}

type RawFinanceDeliveryItemRow = {
  product_id: string
  total_cost: number | string | null
  base_unit_cost: number | string | null
  base_quantity_received: number | string | null
  base_quantity_expected: number | string | null
  quantity_received: number | string | null
  quantity_expected: number | string | null
  supplier_delivery_item_costs: RawFinanceDeliveryItemCostRow[] | null
}

type RawFinanceDeliveryRow = {
  to_branch_id: string
  delivered_at: string | null
  approved_at: string | null
  recorded_at: string
  supplier_delivery_items: RawFinanceDeliveryItemRow[] | null
}

type LatestStockCost = {
  costPerBaseUnit: number
  totalCost: number
  baseQuantity: number
  timestamp: number
}

type FinancePeriod = 'today' | 'week' | 'month'

type FinancePageFilters = {
  period: FinancePeriod
  branchId: string
  startDate: Date
  endDate: Date
  startDateOnly: string
  endDateOnly: string
}

function normalizeJoinedOne<T>(value: JoinedOne<T>): T | null {
  if (!value) {
    return null
  }

  return Array.isArray(value) ? value[0] ?? null : value
}

function toMoneyNumber(value: number | string | null | undefined): number {
  const numericValue = Number(value ?? 0)
  return Number.isFinite(numericValue) ? numericValue : 0
}

function calculateLossNetLoss(loss: Pick<FinanceLossRow, 'gross_cost' | 'recoverable_amount' | 'net_loss'>): number {
  const grossCost = toMoneyNumber(loss.gross_cost)
  const recoverableAmount = toMoneyNumber(loss.recoverable_amount)
  const calculatedNetLoss = Math.max(grossCost - recoverableAmount, 0)

  return Number.isFinite(calculatedNetLoss) ? calculatedNetLoss : toMoneyNumber(loss.net_loss)
}

async function getActiveFinanceBranchIds(businessId: string): Promise<string[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('branches')
    .select('id')
    .eq('business_id', businessId)
    .eq('is_active', true)
    .is('deleted_at', null)

  if (error) {
    logger.error('Owner finances active branch scope fetch failed', { businessId, error })
    return []
  }

  return (data ?? []).map((branch) => branch.id)
}


function emptySummary(): FinanceSummary {
  return {
    revenue: 0,
    cost: 0,
    grossProfit: 0,
    operatingExpenses: 0,
    stockIntakeCosts: 0,
    inventoryLosses: 0,
    netProfit: 0,
    margin: 0,
    netMargin: 0,
    transactionCount: 0,
    bestStore: null,
    byBranch: [],
    byProduct: [],
    expenseGroups: [],
    stockCostGroups: [],
    lossGroups: [],
    recentExpenses: [],
    recentStockCosts: [],
    recentLosses: [],
  }
}

function toDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10)
}

function getPeriodRange(period: FinancePeriod): Omit<FinancePageFilters, 'period' | 'branchId'> {
  const now = new Date()
  const startDate = new Date(now)
  const endDate = new Date(now)

  if (period === 'today') {
    startDate.setHours(0, 0, 0, 0)
    endDate.setHours(23, 59, 59, 999)
  } else if (period === 'week') {
    const day = startDate.getDay()
    const daysSinceMonday = day === 0 ? 6 : day - 1
    startDate.setDate(startDate.getDate() - daysSinceMonday)
    startDate.setHours(0, 0, 0, 0)
    endDate.setHours(23, 59, 59, 999)
  } else {
    startDate.setDate(1)
    startDate.setHours(0, 0, 0, 0)
    endDate.setMonth(startDate.getMonth() + 1, 0)
    endDate.setHours(23, 59, 59, 999)
  }

  return {
    startDate,
    endDate,
    startDateOnly: toDateOnly(startDate),
    endDateOnly: toDateOnly(endDate),
  }
}

async function parseFinanceFilters(
  searchParams: Promise<{ period?: string; branch?: string }>
): Promise<FinancePageFilters> {
  const params = await searchParams
  const period = params.period === 'week' || params.period === 'month' ? params.period : 'today'
  const branchId = typeof params.branch === 'string' ? params.branch : ''
  const range = getPeriodRange(period)

  return {
    period,
    branchId,
    ...range,
  }
}

function upsertGroup(groups: Map<string, FinanceGroup>, patch: FinanceGroup) {
  const current = groups.get(patch.id)

  if (!current) {
    groups.set(patch.id, patch)
    return
  }

  groups.set(patch.id, {
    ...current,
    quantity: current.quantity + patch.quantity,
    revenue: current.revenue + patch.revenue,
    cost: current.cost + patch.cost,
    profit: current.profit + patch.profit,
  })
}

function buildSummary(
  rows: FinanceTransactionRow[],
  expenses: FinanceExpenseRow[],
  stockCosts: FinanceStockCostRow[],
  losses: FinanceLossRow[]
): FinanceSummary {
  const byBranch = new Map<string, FinanceGroup>()
  const byProduct = new Map<string, FinanceGroup>()
  const expenseGroups = new Map<string, FinanceGroup>()
  const stockCostGroups = new Map<string, FinanceGroup>()
  const lossGroups = new Map<string, FinanceGroup>()
  let revenue = 0
  let cost = 0
  let grossProfit = 0

  rows.forEach((transaction) => {
    const branch = normalizeJoinedOne(transaction.branches)
    const branchId = transaction.branch_id ?? 'unknown-branch'
    const branchLabel = branch?.name ?? 'Unknown branch'

    ;(transaction.transaction_items ?? []).forEach((item) => {
      const product = normalizeJoinedOne(item.products)
      const lineRevenue = toMoneyNumber(item.net_line_total ?? toMoneyNumber(item.line_total) - toMoneyNumber(item.line_discount_amount))
      const lineCost = toMoneyNumber(item.line_cost)
      const lineProfit = toMoneyNumber(item.gross_profit ?? lineRevenue - lineCost)
      const quantity = toMoneyNumber(item.base_quantity)

      revenue += lineRevenue
      cost += lineCost
      grossProfit += lineProfit

      upsertGroup(byBranch, {
        id: branchId,
        label: branchLabel,
        quantity,
        revenue: lineRevenue,
        cost: lineCost,
        profit: lineProfit,
      })

      upsertGroup(byProduct, {
        id: item.product_id ?? 'unknown-product',
        label: product?.name ?? 'Unknown product',
        secondary: product?.sku ?? null,
        quantity,
        revenue: lineRevenue,
        cost: lineCost,
        profit: lineProfit,
      })
    })
  })

  const operatingExpenses = expenses.reduce((sum, expense) => {
    const amount = toMoneyNumber(expense.amount)
    const branch = normalizeJoinedOne(expense.branches)

    upsertGroup(expenseGroups, {
      id: expense.category,
      label: expense.category,
      secondary: branch?.name ?? 'Business-wide',
      quantity: 0,
      revenue: 0,
      cost: amount,
      profit: -amount,
    })

    return sum + amount
  }, 0)

  const stockIntakeCosts = stockCosts.reduce((sum, costRow) => {
    const amount = toMoneyNumber(costRow.amount)
    const deliveryItem = normalizeJoinedOne(costRow.supplier_delivery_items)
    const product = normalizeJoinedOne(deliveryItem?.products ?? null)
    const delivery = normalizeJoinedOne(deliveryItem?.supplier_deliveries ?? null)
    const branch = normalizeJoinedOne(delivery?.branches ?? null)

    upsertGroup(stockCostGroups, {
      id: costRow.description,
      label: costRow.description,
      secondary: `${product?.name ?? 'Unknown product'}${branch?.name ? ` at ${branch.name}` : ''}`,
      quantity: 0,
      revenue: 0,
      cost: amount,
      profit: 0,
    })

    return sum + amount
  }, 0)

  const inventoryLosses = losses.reduce((sum, loss) => {
    const netLoss = calculateLossNetLoss(loss)
    const product = normalizeJoinedOne(loss.products)

    upsertGroup(lossGroups, {
      id: loss.loss_type,
      label: loss.loss_type.replace(/_/g, ' '),
      secondary: product?.name ?? 'Unknown product',
      quantity: toMoneyNumber(loss.base_quantity),
      revenue: toMoneyNumber(loss.recoverable_amount),
      cost: toMoneyNumber(loss.gross_cost),
      profit: -netLoss,
    })

    return sum + netLoss
  }, 0)

  const netProfit = grossProfit - operatingExpenses - inventoryLosses

  return {
    revenue,
    cost,
    grossProfit,
    operatingExpenses,
    stockIntakeCosts,
    inventoryLosses,
    netProfit,
    margin: revenue > 0 ? (grossProfit / revenue) * 100 : 0,
    netMargin: revenue > 0 ? (netProfit / revenue) * 100 : 0,
    transactionCount: rows.length,
    bestStore: Array.from(byBranch.values()).sort((first, second) => second.profit - first.profit)[0] ?? null,
    byBranch: Array.from(byBranch.values()).sort((first, second) => second.profit - first.profit).slice(0, 10),
    byProduct: Array.from(byProduct.values()).sort((first, second) => second.profit - first.profit).slice(0, 10),
    expenseGroups: Array.from(expenseGroups.values()).sort((first, second) => second.cost - first.cost).slice(0, 10),
    stockCostGroups: Array.from(stockCostGroups.values()).sort((first, second) => second.cost - first.cost).slice(0, 10),
    lossGroups: Array.from(lossGroups.values()).sort((first, second) => second.cost - first.cost).slice(0, 10),
    recentExpenses: expenses.slice(0, 8),
    recentStockCosts: stockCosts.slice(0, 8),
    recentLosses: losses.slice(0, 8),
  }
}

async function getFinanceSummary(businessId: string, filters: FinancePageFilters): Promise<FinanceSummary> {
  const supabase = await createClient()
  const activeBranchIds = await getActiveFinanceBranchIds(businessId)

  if (filters.branchId && !activeBranchIds.includes(filters.branchId)) {
    return emptySummary()
  }

  if (activeBranchIds.length === 0) {
    return emptySummary()
  }

  let transactionsQuery = supabase
      .from('transactions')
      .select(
        `
        id,
        total_amount,
        discount_amount,
        recorded_at,
        branch_id,
        branches(name),
        transaction_items(
          product_id,
          line_total,
          line_discount_amount,
          net_line_total,
          line_cost,
          gross_profit,
          base_quantity,
          products(name, sku)
        )
      `
      )
      .eq('business_id', businessId)
      .eq('status', 'verified')
      .in('branch_id', activeBranchIds)
      .gte('recorded_at', filters.startDate.toISOString())
      .lte('recorded_at', filters.endDate.toISOString())
      .order('recorded_at', { ascending: false })
      .range(0, 499)

  let expensesQuery = supabase
      .from('finance_expenses')
      .select('id, branch_id, category, description, amount, incurred_on, branches(name)')
      .eq('business_id', businessId)
      .or(`branch_id.in.(${activeBranchIds.join(',')}),branch_id.is.null`)
      .gte('incurred_on', filters.startDateOnly)
      .lte('incurred_on', filters.endDateOnly)
      .order('incurred_on', { ascending: false })
      .range(0, 199)

  let lossesQuery = supabase
      .from('inventory_loss_events')
      .select(
        `
        id,
        branch_id,
        product_id,
        loss_type,
        reason,
        quantity_in_uom,
        base_quantity,
        gross_cost,
        recoverable_amount,
        net_loss,
        created_at,
        branches(name),
        products(name, sku),
        units_of_measure(name)
      `
      )
      .eq('business_id', businessId)
      .in('branch_id', activeBranchIds)
      .gte('created_at', filters.startDate.toISOString())
      .lte('created_at', filters.endDate.toISOString())
      .order('created_at', { ascending: false })
      .range(0, 199)

  if (filters.branchId) {
    transactionsQuery = transactionsQuery.eq('branch_id', filters.branchId)
    expensesQuery = expensesQuery.eq('branch_id', filters.branchId)
    lossesQuery = lossesQuery.eq('branch_id', filters.branchId)
  }

  const [transactionsResponse, expensesResponse, stockCostsResponse, lossesResponse] = await Promise.all([
    transactionsQuery,
    expensesQuery,
    supabase
      .from('supplier_delivery_item_costs')
      .select(
        `
        id,
        delivery_item_id,
        description,
        amount,
        created_at,
        supplier_delivery_items(
          product_id,
          products(name, sku),
          supplier_deliveries(
            supplier_name,
            to_branch_id,
            branches(name)
          )
        )
      `
      )
      .eq('business_id', businessId)
      .gte('created_at', filters.startDate.toISOString())
      .lte('created_at', filters.endDate.toISOString())
      .order('created_at', { ascending: false })
      .range(0, 199),
    lossesQuery,
  ])

  if (transactionsResponse.error || expensesResponse.error || stockCostsResponse.error || lossesResponse.error) {
    logger.error('Owner finances fetch failed', {
      businessId,
      error: transactionsResponse.error ?? expensesResponse.error ?? stockCostsResponse.error ?? lossesResponse.error,
    })
    return emptySummary()
  }

  const stockCosts = ((stockCostsResponse.data ?? []) as FinanceStockCostRow[]).filter((row) => {
    const deliveryItem = normalizeJoinedOne(row.supplier_delivery_items)
    const delivery = normalizeJoinedOne(deliveryItem?.supplier_deliveries ?? null)

    if (!delivery?.to_branch_id || !activeBranchIds.includes(delivery.to_branch_id)) {
      return false
    }

    if (!filters.branchId) {
      return true
    }

    return delivery?.to_branch_id === filters.branchId
  })

  return buildSummary(
    (transactionsResponse.data ?? []) as FinanceTransactionRow[],
    (expensesResponse.data ?? []) as FinanceExpenseRow[],
    stockCosts,
    (lossesResponse.data ?? []) as FinanceLossRow[]
  )
}

async function getRecurringExpenseData(
  businessId: string,
  filters: FinancePageFilters
): Promise<{ templates: RecurringExpenseTemplate[]; pendingInstances: RecurringExpenseInstance[] }> {
  const supabase = await createClient()

  const ensureResponse = await supabase.rpc('ensure_recurring_finance_expense_instances', {
    p_as_of: filters.endDateOnly,
  })

  if (ensureResponse.error) {
    logger.error('Recurring expense instance generation failed', { businessId, error: ensureResponse.error })
  }

  let templatesQuery = supabase
    .from('finance_recurring_expense_templates')
    .select('id, branch_id, category, description, default_amount, due_day, is_active, branches(name)')
    .eq('business_id', businessId)
    .order('is_active', { ascending: false })
    .order('due_day', { ascending: true })
    .range(0, 99)

  let instancesQuery = supabase
    .from('finance_recurring_expense_instances')
    .select('id, template_id, branch_id, category, description, amount, due_on, status, branches(name)')
    .eq('business_id', businessId)
    .eq('status', 'pending')
    .gte('due_on', filters.startDateOnly)
    .lte('due_on', filters.endDateOnly)
    .order('due_on', { ascending: true })
    .range(0, 99)

  if (filters.branchId) {
    templatesQuery = templatesQuery.or(`branch_id.eq.${filters.branchId},branch_id.is.null`)
    instancesQuery = instancesQuery.or(`branch_id.eq.${filters.branchId},branch_id.is.null`)
  }

  const [templatesResponse, instancesResponse] = await Promise.all([templatesQuery, instancesQuery])

  if (templatesResponse.error || instancesResponse.error) {
    logger.error('Recurring expenses fetch failed', {
      businessId,
      error: templatesResponse.error ?? instancesResponse.error,
    })
    return { templates: [], pendingInstances: [] }
  }

  return {
    templates: (templatesResponse.data ?? []) as RecurringExpenseTemplate[],
    pendingInstances: (instancesResponse.data ?? []) as RecurringExpenseInstance[],
  }
}

async function getPendingEmployeeDamageReports(businessId: string): Promise<PendingEmployeeDamageReportRow[]> {
  const supabase = await createClient()
  const response = await supabase.rpc('owner_pending_employee_inventory_loss_reports', {
    p_limit: 25,
  })

  if (response.error) {
    logger.error('Pending employee damage reports fetch failed', { businessId, error: response.error })
    return []
  }

  return (response.data ?? []) as PendingEmployeeDamageReportRow[]
}

async function getFinanceFormOptions(businessId: string): Promise<{ branches: BranchOption[]; lossProducts: LossProductOption[] }> {
  const supabase = await createClient()
  const [branchesResponse, stockResponse] = await Promise.all([
    supabase
      .from('branches')
      .select('id, name')
      .eq('business_id', businessId)
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('name', { ascending: true }),
    supabase
      .from('branch_stock')
      .select(
        `
        branch_id,
        product_id,
        base_quantity_on_hand,
        base_quantity_reserved,
        average_base_unit_cost,
        branches(id, name),
        products(id, name, sku)
      `
      )
      .eq('business_id', businessId)
      .gt('base_quantity_on_hand', 0)
      .order('branch_id', { ascending: true }),
  ])

  if (branchesResponse.error || stockResponse.error) {
    logger.error('Owner finances options fetch failed', { businessId, error: branchesResponse.error ?? stockResponse.error })
    return { branches: [], lossProducts: [] }
  }

  const activeBranchIds = new Set((branchesResponse.data ?? []).map((branch) => branch.id as string))
  const stockRows = ((stockResponse.data ?? []) as RawFinanceStockRow[]).filter((row) => activeBranchIds.has(row.branch_id))
  const productIds = Array.from(new Set(stockRows.map((row) => row.product_id)))
  let uomsByProduct = new Map<string, LossProductOption['uom_options']>()
  const latestStockCostsByBranchProduct = new Map<string, LatestStockCost>()

  if (productIds.length > 0) {
    const [uomResponse, deliveryCostsResponse] = await Promise.all([
      supabase
        .from('product_uom_links')
        .select('product_id, is_base_uom, units_of_measure(id, name, abbreviation, conversion_factor, is_base_unit)')
        .eq('business_id', businessId)
        .in('product_id', productIds),
      supabase
        .from('supplier_deliveries')
        .select(
          `
          to_branch_id,
          delivered_at,
          approved_at,
          recorded_at,
          supplier_delivery_items(
            product_id,
            total_cost,
            base_unit_cost,
            base_quantity_received,
            base_quantity_expected,
            quantity_received,
            quantity_expected,
            supplier_delivery_item_costs(amount)
          )
        `
        )
        .eq('business_id', businessId)
        .eq('status', 'received')
        .range(0, 999),
    ])

    if (!uomResponse.error) {
      ;((uomResponse.data ?? []) as RawFinanceUomLinkRow[]).forEach((row) => {
        const uom = normalizeJoinedOne(row.units_of_measure)
        if (!uom) return
        const current = uomsByProduct.get(row.product_id) ?? []
        uomsByProduct.set(row.product_id, [
          ...current,
          {
            id: uom.id,
            name: uom.abbreviation ? `${uom.name} (${uom.abbreviation})` : uom.name,
            conversion_factor: Number(uom.conversion_factor),
            is_base_uom: row.is_base_uom,
            is_base_unit: uom.is_base_unit,
          },
        ])
      })
    } else {
      logger.error('Owner finances loss UOM fetch failed', { businessId, error: uomResponse.error })
    }

    if (!deliveryCostsResponse.error) {
      ;((deliveryCostsResponse.data ?? []) as RawFinanceDeliveryRow[]).forEach((delivery) => {
        const timestamp = Date.parse(delivery.delivered_at ?? delivery.approved_at ?? delivery.recorded_at)

        ;(delivery.supplier_delivery_items ?? []).forEach((deliveryItem) => {
          if (!productIds.includes(deliveryItem.product_id)) {
            return
          }

          const baseQuantity = [
            deliveryItem.base_quantity_received,
            deliveryItem.base_quantity_expected,
            deliveryItem.quantity_received,
            deliveryItem.quantity_expected,
          ].map((value) => toMoneyNumber(value)).find((value) => value > 0) ?? 0
          const costBreakdownTotal = (deliveryItem.supplier_delivery_item_costs ?? []).reduce(
            (sum, cost) => sum + toMoneyNumber(cost.amount),
            0
          )
          const totalCost = toMoneyNumber(deliveryItem.total_cost)
          const baseUnitCost = toMoneyNumber(deliveryItem.base_unit_cost)
          const resolvedTotalCost = costBreakdownTotal > 0
            ? costBreakdownTotal
            : totalCost > 0
              ? totalCost
              : baseUnitCost * baseQuantity

          if (baseQuantity <= 0 || resolvedTotalCost <= 0) {
            return
          }

          const key = `${delivery.to_branch_id}:${deliveryItem.product_id}`
          const current = latestStockCostsByBranchProduct.get(key)

          if (!current || timestamp > current.timestamp) {
            latestStockCostsByBranchProduct.set(key, {
              costPerBaseUnit: resolvedTotalCost / baseQuantity,
              totalCost: resolvedTotalCost,
              baseQuantity,
              timestamp,
            })
          }
        })
      })
    } else {
      logger.error('Owner finances loss stock-cost fetch failed', { businessId, error: deliveryCostsResponse.error })
    }
  }

  return {
    branches: (branchesResponse.data ?? []) as BranchOption[],
    lossProducts: stockRows.flatMap((row) => {
      const branch = normalizeJoinedOne(row.branches)
      const product = normalizeJoinedOne(row.products)
      const baseUom = (uomsByProduct.get(row.product_id) ?? [])
        .filter((uom) => uom.is_base_uom || uom.is_base_unit || uom.conversion_factor === 1)
        .sort((first, second) => (
          Number(second.is_base_uom) - Number(first.is_base_uom) ||
          Number(second.is_base_unit) - Number(first.is_base_unit) ||
          first.conversion_factor - second.conversion_factor
        ))[0]
      const latestCost = latestStockCostsByBranchProduct.get(`${row.branch_id}:${row.product_id}`)
      const stockAverageCost = toMoneyNumber(row.average_base_unit_cost)
      const costPerBaseUnit = latestCost?.costPerBaseUnit ?? stockAverageCost

      if (!baseUom || costPerBaseUnit <= 0) {
        return []
      }

      return {
        branch_id: row.branch_id,
        branch_name: branch?.name ?? 'Unknown branch',
        product_id: row.product_id,
        product_name: product?.name ?? 'Unknown product',
        sku: product?.sku ?? null,
        available_base_quantity: Math.max(toMoneyNumber(row.base_quantity_on_hand) - toMoneyNumber(row.base_quantity_reserved), 0),
        average_base_unit_cost: costPerBaseUnit,
        cost_source_label: latestCost ? 'Latest stock receipt' : 'Stock average cost',
        cost_source_total: latestCost?.totalCost ?? 0,
        cost_source_base_quantity: latestCost?.baseQuantity ?? 0,
        uom_options: [baseUom],
      }
    }),
  }
}

function MarginIcon() {
  return (
    <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path d="M3 17l6-6 4 4 8-8" />
      <path d="M14 7h7v7" />
    </svg>
  )
}

function MoneyIcon() {
  return (
    <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <line x1="12" y1="1" x2="12" y2="23" />
      <path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
    </svg>
  )
}

function SummaryTable({ title, groups, currency }: { title: string; groups: FinanceGroup[]; currency: string }) {
  return (
    <Card padding="md">
      <CardHeader title={title} />
      {groups.length === 0 ? (
        <p style={{ margin: 0, fontSize: 14, color: 'var(--color-text-muted)' }}>
          No verified sales with cost data in the last 30 days.
        </p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                {['Name', 'Qty', 'Revenue', 'Cost', 'Profit', 'Margin'].map((heading) => (
                  <th key={heading} style={{ padding: '12px', textAlign: 'left', color: 'var(--color-text-muted)' }}>
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => {
                const margin = group.revenue > 0 ? (group.profit / group.revenue) * 100 : 0

                return (
                  <tr key={group.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <td style={{ padding: 12, color: 'var(--color-text-primary)', fontWeight: 600 }}>
                      {group.label}
                      {group.secondary && (
                        <span style={{ display: 'block', marginTop: 3, color: 'var(--color-text-muted)', fontSize: 12 }}>
                          {group.secondary}
                        </span>
                      )}
                    </td>
                    <td style={{ padding: 12, color: 'var(--color-text-primary)' }}>
                      {group.quantity.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                    </td>
                    <td style={{ padding: 12, color: 'var(--color-text-primary)' }}>{formatCurrency(group.revenue, currency)}</td>
                    <td style={{ padding: 12, color: 'var(--color-text-primary)' }}>{formatCurrency(group.cost, currency)}</td>
                    <td style={{ padding: 12, color: group.profit >= 0 ? 'var(--color-success)' : 'var(--color-danger)', fontWeight: 700 }}>
                      {formatCurrency(group.profit, currency)}
                    </td>
                    <td style={{ padding: 12, color: 'var(--color-text-primary)' }}>
                      {margin.toLocaleString(undefined, { maximumFractionDigits: 1 })}%
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

function RecentExpenseTable({ rows, currency }: { rows: FinanceExpenseRow[]; currency: string }) {
  return (
    <Card padding="md">
      <CardHeader title="Recent operating expenses" />
      {rows.length === 0 ? (
        <p style={{ margin: 0, fontSize: 14, color: 'var(--color-text-muted)' }}>No operating expenses recorded in the last 30 days.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                {['Date', 'Category', 'Description', 'Branch', 'Amount'].map((heading) => (
                  <th key={heading} style={{ padding: 12, textAlign: 'left', color: 'var(--color-text-muted)' }}>{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const branch = normalizeJoinedOne(row.branches)
                return (
                  <tr key={row.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <td style={{ padding: 12, color: 'var(--color-text-primary)' }}>{row.incurred_on}</td>
                    <td style={{ padding: 12, color: 'var(--color-text-primary)', fontWeight: 600 }}>{row.category}</td>
                    <td style={{ padding: 12, color: 'var(--color-text-muted)' }}>{row.description}</td>
                    <td style={{ padding: 12, color: 'var(--color-text-muted)' }}>{branch?.name ?? 'Business-wide'}</td>
                    <td style={{ padding: 12, color: 'var(--color-danger)', fontWeight: 700 }}>{formatCurrency(toMoneyNumber(row.amount), currency)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

function RecentStockCostTable({ rows, currency }: { rows: FinanceStockCostRow[]; currency: string }) {
  return (
    <Card padding="md">
      <CardHeader title="Recent stock intake costs" />
      {rows.length === 0 ? (
        <p style={{ margin: 0, fontSize: 14, color: 'var(--color-text-muted)' }}>No stock intake costs recorded in the last 30 days.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                {['Date', 'Cost', 'Product', 'Supplier / branch', 'Amount'].map((heading) => (
                  <th key={heading} style={{ padding: 12, textAlign: 'left', color: 'var(--color-text-muted)' }}>{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const deliveryItem = normalizeJoinedOne(row.supplier_delivery_items)
                const product = normalizeJoinedOne(deliveryItem?.products ?? null)
                const delivery = normalizeJoinedOne(deliveryItem?.supplier_deliveries ?? null)
                const branch = normalizeJoinedOne(delivery?.branches ?? null)

                return (
                  <tr key={row.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <td style={{ padding: 12, color: 'var(--color-text-primary)' }}>{new Date(row.created_at).toLocaleDateString()}</td>
                    <td style={{ padding: 12, color: 'var(--color-text-primary)', fontWeight: 600 }}>{row.description}</td>
                    <td style={{ padding: 12, color: 'var(--color-text-primary)' }}>
                      {product?.name ?? 'Unknown product'}
                      {product?.sku && (
                        <span style={{ display: 'block', marginTop: 3, color: 'var(--color-text-muted)', fontSize: 12 }}>{product.sku}</span>
                      )}
                    </td>
                    <td style={{ padding: 12, color: 'var(--color-text-muted)' }}>
                      {delivery?.supplier_name ?? 'Unknown supplier'}
                      <span style={{ display: 'block', marginTop: 3 }}>{branch?.name ?? 'Unknown branch'}</span>
                    </td>
                    <td style={{ padding: 12, color: 'var(--color-accent)', fontWeight: 700 }}>{formatCurrency(toMoneyNumber(row.amount), currency)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

function RecentLossTable({ rows, currency }: { rows: FinanceLossRow[]; currency: string }) {
  return (
    <Card padding="md">
      <CardHeader title="Recent inventory losses" />
      {rows.length === 0 ? (
        <p style={{ margin: 0, fontSize: 14, color: 'var(--color-text-muted)' }}>No inventory losses recorded in the last 30 days.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                {['Date', 'Product', 'Type', 'Qty', 'Recoverable', 'Net loss'].map((heading) => (
                  <th key={heading} style={{ padding: 12, textAlign: 'left', color: 'var(--color-text-muted)' }}>{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const product = normalizeJoinedOne(row.products)
                const uom = normalizeJoinedOne(row.units_of_measure)
                const netLoss = calculateLossNetLoss(row)
                return (
                  <tr key={row.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <td style={{ padding: 12, color: 'var(--color-text-primary)' }}>{new Date(row.created_at).toLocaleDateString()}</td>
                    <td style={{ padding: 12, color: 'var(--color-text-primary)', fontWeight: 600 }}>
                      {product?.name ?? 'Unknown product'}
                      <span style={{ display: 'block', marginTop: 3, color: 'var(--color-text-muted)', fontSize: 12 }}>{row.reason}</span>
                    </td>
                    <td style={{ padding: 12, color: 'var(--color-text-muted)' }}>{row.loss_type.replace(/_/g, ' ')}</td>
                    <td style={{ padding: 12, color: 'var(--color-text-primary)' }}>
                      {toMoneyNumber(row.quantity_in_uom).toLocaleString(undefined, { maximumFractionDigits: 4 })} {uom?.name ?? 'units'}
                    </td>
                    <td style={{ padding: 12, color: 'var(--color-text-primary)' }}>{formatCurrency(toMoneyNumber(row.recoverable_amount), currency)}</td>
                    <td style={{ padding: 12, color: 'var(--color-danger)', fontWeight: 700 }}>
                      {formatCurrency(netLoss, currency)}
                      <span style={{ display: 'block', marginTop: 3, color: 'var(--color-text-muted)', fontSize: 12, fontWeight: 500 }}>
                        {formatCurrency(toMoneyNumber(row.gross_cost), currency)} cost - {formatCurrency(toMoneyNumber(row.recoverable_amount), currency)} recovered
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

export default async function OwnerFinancesPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; branch?: string }>
}) {
  const profile = await requireRole([GlobalRole.Owner])
  const businessId = profile.business_id

  if (!businessId) {
    throw new Error('Owner profile missing business ID')
  }

  const filters = await parseFinanceFilters(searchParams)
  const supabase = await createClient()
  const [{ data: business }, summary, formOptions, recurringData, pendingDamageReports] = await Promise.all([
    supabase.from('businesses').select('currency').eq('id', businessId).single(),
    getFinanceSummary(businessId, filters),
    getFinanceFormOptions(businessId),
    getRecurringExpenseData(businessId, filters),
    getPendingEmployeeDamageReports(businessId),
  ])
  const currency = business?.currency ?? 'KES'
  const selectedBranch = formOptions.branches.find((branch) => branch.id === filters.branchId) ?? null
  const periodLabel = filters.period === 'week' ? 'this week' : filters.period === 'month' ? 'this month' : 'today'

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <div>
          <h1
            className="font-bold"
            style={{ fontSize: '22px', color: 'var(--color-text-primary)', letterSpacing: '-0.3px', margin: 0 }}
          >
            Finances
          </h1>
          <p style={{ fontSize: '14px', color: 'var(--color-text-muted)', marginTop: '4px' }}>
            {selectedBranch ? `${selectedBranch.name} performance` : 'All stores performance'} for {periodLabel}.
          </p>
        </div>

        <FinanceFilters
          branches={formOptions.branches}
          selectedBranchId={filters.branchId}
          selectedPeriod={filters.period}
        />
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <MetricCard label="Total profit" value={formatCurrency(summary.netProfit, currency)} icon={<MarginIcon />} valueColor={summary.netProfit >= 0 ? 'var(--color-success)' : 'var(--color-danger)'} />
        <MetricCard
          label="Best store"
          value={summary.bestStore ? summary.bestStore.label : 'No sales yet'}
          icon={<MarginIcon />}
          valueColor="var(--color-text-primary)"
        />
        <MetricCard label="Revenue" value={formatCurrency(summary.revenue, currency)} icon={<MoneyIcon />} valueColor="var(--color-text-primary)" />
        <MetricCard label="Gross profit" value={formatCurrency(summary.grossProfit, currency)} icon={<MarginIcon />} valueColor={summary.grossProfit >= 0 ? 'var(--color-success)' : 'var(--color-danger)'} />
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <MetricCard label="Cost of goods" value={formatCurrency(summary.cost, currency)} icon={<MoneyIcon />} valueColor="var(--color-accent)" />
        <MetricCard label="Stock intake costs" value={formatCurrency(summary.stockIntakeCosts, currency)} icon={<MoneyIcon />} valueColor="var(--color-accent)" />
        <MetricCard label="Expenses" value={formatCurrency(summary.operatingExpenses, currency)} icon={<MoneyIcon />} valueColor="var(--color-danger)" />
        <MetricCard label="Inventory losses" value={formatCurrency(summary.inventoryLosses, currency)} icon={<MoneyIcon />} valueColor="var(--color-danger)" />
      </div>

      <Card padding="md">
        <CardHeader title="How profit is calculated" />
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: 'var(--color-text-muted)' }}>
          Stock costs are entered during supplier delivery, converted into base-unit cost, and averaged into the branch stock cost basis.
          Each employee sale stores revenue, discount, line cost, and gross profit permanently. Operating expenses and inventory losses are then subtracted from gross profit to get net profit.
          Stock intake costs are displayed below for visibility, but they are not subtracted again because they are already included in cost of goods when stock is sold.
        </p>
      </Card>

      <RecurringExpensePanel
        branches={formOptions.branches}
        templates={recurringData.templates}
        pendingInstances={recurringData.pendingInstances}
        currency={currency}
      />

      <FinanceControls branches={formOptions.branches} lossProducts={formOptions.lossProducts} />

      <PendingEmployeeDamageReportsTable rows={pendingDamageReports} currency={currency} />

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <SummaryTable title="Profit by branch" groups={summary.byBranch} currency={currency} />
        <SummaryTable title="Profit by product" groups={summary.byProduct} currency={currency} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <SummaryTable title="Expenses by category" groups={summary.expenseGroups} currency={currency} />
        <SummaryTable title="Stock intake costs by type" groups={summary.stockCostGroups} currency={currency} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <SummaryTable title="Losses by type" groups={summary.lossGroups} currency={currency} />
        <RecentExpenseTable rows={summary.recentExpenses} currency={currency} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <RecentStockCostTable rows={summary.recentStockCosts} currency={currency} />
        <RecentLossTable rows={summary.recentLosses} currency={currency} />
      </div>
    </div>
  )
}
