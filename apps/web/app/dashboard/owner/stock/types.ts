/**
 * Shared stock dashboard types for Retivox.
 *
 * These types are consumed by the owner and admin stock dashboards. They keep
 * Supabase join shapes explicit so UI components always access joined rows as
 * arrays with optional chaining.
 */

/**
 * Product details joined onto branch stock rows.
 */
export type BranchStockProduct = {
  id: string
  name: string
  sku?: string
}

/**
 * Product UOM option available for stock display conversion.
 */
export type StockUOMOption = {
  id: string
  name: string
  abbreviation: string
  conversion_factor: number
  is_base_unit: boolean
  is_base_uom: boolean
  is_purchase_uom: boolean
  is_sale_uom: boolean
  is_default_sale_uom: boolean
  is_default_purchase_uom: boolean
}

/**
 * Branch details joined onto branch stock rows.
 */
export type BranchStockBranch = {
  id: string
  name: string
}

/**
 * Current stock level for one product at one branch.
 */
export type BranchStockRow = {
  id: string
  branch_id: string
  quantity_on_hand: number
  quantity_reserved?: number
  base_quantity_on_hand: number
  base_quantity_reserved?: number
  low_stock_threshold: number
  average_base_unit_cost?: number
  products: BranchStockProduct[] | null
  branches: BranchStockBranch[] | null
  uom_options: StockUOMOption[]
}

/**
 * Aggregated stock dashboard metrics.
 */
export type StockMetrics = {
  totalSkus: number
  lowStockCount: number
  outOfStockCount: number
  branchesWithAlerts: number
}

export type StockExpiryAlert = {
  branch_id: string
  branch_name: string
  product_id: string
  product_name: string
  sku: string | null
  lot_id: string
  supplier_lot_code: string | null
  expires_on: string
  days_remaining: number
  base_quantity_on_hand: number
  alert_status: 'expiring_soon' | 'expired'
}

/**
 * Branch selector option.
 */
export type BranchSummary = {
  id: string
  name: string
}

/**
 * Product selector option used in delivery forms.
 */
export type StockProductOption = {
  id: string
  name: string
  sku?: string
  tracks_expiry?: boolean
  uom_options: StockUOMOption[]
}

/**
 * Stock movement history row from the dashboard movement RPC.
 */
export type StockMovementRow = {
  movement_id: string
  branch_id: string
  product_id: string
  product_name: string
  branch_name: string
  movement_type: 'supplier_delivery' | 'transfer_in' | 'transfer_out' | 'sale_deduction' | 'recovery_sale' | 'inventory_loss' | 'manual_adjustment'
  quantity: number
  actor_name: string | null
  reference_label: string | null
  created_at: string
}

/**
 * Supplier delivery workflow row shown in approval and arrival queues.
 */
export type StockDeliveryRow = {
  id: string
  branch_id: string
  branch_name: string
  supplier_id: string | null
  supplier_name: string
  reference_code: string | null
  supplier_reference_number: string | null
  supplier_price_rating: number | null
  supplier_stock_quality_rating: number | null
  supplier_availability_rating: number | null
  supplier_rating_note: string | null
  status: 'pending_approval' | 'approved' | 'received' | 'pending' | 'disputed'
  recorded_at: string
  item_count: number
  total_expected: number
  items: StockDeliveryItemRow[]
}

/**
 * Cost/expense row stored against a supplier delivery item.
 */
export type StockDeliveryItemCostRow = {
  id: string
  description: string
  amount: number
}

/**
 * Supplier delivery item row used for edit/history display.
 */
export type StockDeliveryItemRow = {
  id: string
  product_id: string
  product_name: string
  uom_id: string | null
  uom_name: string | null
  quantity_in_uom: number | null
  expires_on: string | null
  supplier_lot_code: string | null
  base_quantity_expected: number
  base_quantity_received: number
  unit_cost: number | null
  total_cost: number | null
  notes: string | null
  costs: StockDeliveryItemCostRow[]
}

/**
 * Pending delivery edit request awaiting owner approval.
 */
export type StockDeliveryEditRequestRow = {
  id: string
  delivery_id: string
  branch_id: string
  branch_name: string
  supplier_name: string
  reference_code: string | null
  requested_by_name: string
  old_value: unknown
  new_value: unknown
  reason: string | null
  requested_at: string
  status: 'pending_approval' | 'approved' | 'rejected'
}

/**
 * Supplier directory and ranking row shown in stock dashboards.
 */
export type SupplierDirectoryRow = {
  id: string
  name: string
  phone: string | null
  email: string | null
  contact_person: string | null
  notes: string | null
  is_active: boolean
  supply_count: number
  product_count: number
  branch_count: number
  average_price_rating: number | null
  average_stock_quality_rating: number | null
  average_availability_rating: number | null
  average_score: number | null
  last_supplied_at: string | null
}

/**
 * Shared server action result shape for stock forms.
 */
export type FormState = {
  success: boolean
  error?: string | null
}
