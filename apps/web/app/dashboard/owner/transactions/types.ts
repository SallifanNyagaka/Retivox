/**
 * Shared types for the owner transactions dashboard.
 *
 * These row shapes keep the server page, client components, and server actions
 * aligned without using untyped Supabase results.
 */

/**
 * Transaction status values supported by the database.
 */
export type TransactionStatus =
  | 'pending_sync'
  | 'synced'
  | 'pending_verify'
  | 'verified'
  | 'rejected'
  | 'flagged'
  | 'voided'

/**
 * Payment method values supported by the database.
 */
export type PaymentMethod = 'mpesa_stk' | 'mpesa_manual' | 'cash' | 'card'

/**
 * Payment status values supported by the database.
 */
export type PaymentStatus = 'pending' | 'pending_verify' | 'verified' | 'rejected'

/**
 * Minimal branch row used for filters and table labels.
 */
export type BranchFilterRow = {
  id: string
  name: string
}

/**
 * Minimal user row used for employee filters and labels.
 */
export type UserFilterRow = {
  id: string
  name: string
  email: string
}

/**
 * Raw transaction row fetched from Supabase.
 */
export type TransactionRow = {
  id: string
  branch_id: string | null
  employee_id: string | null
  customer_id: string | null
  status: TransactionStatus
  subtotal: number
  discount_amount: number
  total_amount: number
  origin: string
  sync_status: string
  local_id: string | null
  recorded_at: string
  synced_at: string | null
  created_at: string
}

/**
 * Raw payment row fetched from Supabase.
 */
export type PaymentRow = {
  id: string
  transaction_id: string
  payment_method: PaymentMethod
  amount: number
  status: PaymentStatus
  mpesa_ref_code: string | null
  mpesa_checkout_id: string | null
  paybill_number: string | null
  account_reference: string | null
  cash_deposit_code: string | null
  verified_by: string | null
  verified_at: string | null
  payment_at: string
}

/**
 * Product join row for transaction line items.
 */
export type TransactionLineItemProduct = {
  name: string
  sku: string | null
}

/**
 * UOM join row for transaction line items.
 */
export type TransactionLineItemUOM = {
  name: string
  abbreviation: string | null
  conversion_factor: string | number
}

/**
 * Compact line item summary shown in transaction history tables.
 */
export type TransactionItemSummary = {
  transactionId: string
  productId: string
  productName: string
  isRecovery: boolean
  quantity: number
  quantityInUom: number | null
  baseQuantity: number | null
  uomName: string | null
  uomConversionFactor: number | null
  baseUomName: string | null
}

/**
 * Lazy-loaded transaction line item shown inside the detail modal.
 */
export type TransactionLineItemView = {
  id: string
  productName: string
  productId: string
  productSku: string | null
  isRecovery: boolean
  quantity: number
  quantityInUom: number | null
  baseQuantity: number | null
  uomName: string | null
  uomConversionFactor: number | null
  baseUomName: string | null
  unitPriceAtSale: number
  lineTotal: number
  stockStatus: string
}

/**
 * Hydrated transaction row used by the client table.
 */
export type TransactionView = TransactionRow & {
  branch_name: string
  employee_name: string
  employee_email: string | null
  payments: PaymentRow[]
  primary_payment: PaymentRow | null
  item_summary: TransactionItemSummary[]
}

/**
 * Validated URL filters for the transactions page.
 */
export type TransactionFilters = {
  branch: string
  employeeId: string
  status: string
  paymentMethod: string
  dateFrom: string
  dateTo: string
  search: string
  page: number
}

/**
 * Summary metrics displayed above the transactions table.
 */
export type TransactionMetrics = {
  totalToday: number
  totalThisWeek: number
  pendingVerifications: number
  rejectedCount: number
}

/**
 * Form state returned by transaction server actions.
 */
export type FormState = {
  success: boolean
  error: string | null
}
