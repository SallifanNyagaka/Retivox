/**
 * Shared transfer types for the owner transfers page.
 *
 * These types are used by the server page, client modal, and server actions
 * so the transfer flow stays consistent end to end.
 */

export type TransferStatus = 'initiated' | 'in_transit' | 'received' | 'disputed'

/**
 * Branch rows used in transfer dropdowns.
 */
export type BranchOption = {
  id: string
  name: string
  branch_type: string
  is_active: boolean
}

/**
 * Product rows sourced from branch stock records.
 */
export type StockProduct = {
  id: string
  name: string
  sku?: string
}

/**
 * Product UOM option used for transfer quantity conversion.
 */
export type TransferUOMOption = {
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
 * Stock rows used to populate transfer product options and validate quantities.
 */
export type TransferStockRow = {
  id: string
  branch_id: string
  product_id: string
  quantity_on_hand: number
  quantity_reserved: number
  base_quantity_on_hand: number
  base_quantity_reserved: number
  low_stock_threshold: number
  products: StockProduct[] | null
  branches: { id: string; name: string }[] | null
  uom_options: TransferUOMOption[]
}

/**
 * Raw stock row returned by Supabase before join normalization.
 */
export type RawTransferStockRow = Omit<TransferStockRow, 'products' | 'branches' | 'uom_options'> & {
  products: StockProduct | StockProduct[] | null
  branches: { id: string; name: string } | Array<{ id: string; name: string }> | null
}

/**
 * Raw transfer item rows from Supabase.
 */
export type TransferItemRow = {
  id: string
  transfer_id: string
  product_id: string
  quantity_sent: number
  quantity_received: number | null
  quantity_discrepancy: number | null
  uom_id: string | null
  quantity_in_uom: number | null
  base_quantity_sent: number | null
  base_quantity_received: number | null
}

/**
 * Raw transfer rows from Supabase.
 */
export type TransferRow = {
  id: string
  from_branch_id: string
  to_branch_id: string
  initiated_by: string
  received_by: string | null
  status: TransferStatus
  notes: string | null
  initiated_at: string
  received_at: string | null
}

/**
 * Materialized transfer row used by the page UI.
 */
export type TransferView = TransferRow & {
  from_branch_name: string
  to_branch_name: string
  initiated_by_name: string
  received_by_name: string | null
  items: TransferViewItem[]
}

/**
 * Materialized transfer item used by the page UI.
 */
export type TransferViewItem = {
  id: string
  product_id: string
  product_name: string
  product_sku: string | null
  quantity_sent: number
  quantity_received: number | null
  quantity_discrepancy: number | null
  uom_id: string | null
  uom_name: string | null
  uom_conversion_factor: number | null
  quantity_in_uom: number | null
  base_quantity_sent: number | null
  base_quantity_received: number | null
}

/**
 * Form state returned by transfer server actions.
 */
export type FormState = {
  success: boolean
  error: string | null
}

/**
 * Draft item used by the client-side initiate transfer modal.
 */
export type TransferDraftItem = {
  productId: string
  uomId: string
  quantity: string
}
