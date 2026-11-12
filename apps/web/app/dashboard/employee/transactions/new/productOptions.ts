import type { EmployeeProductOption } from './RecordEmployeeTransactionForm'

/**
 * Raw product row returned from employee_available_products.
 */
export type EmployeeAvailableProductRow = {
  product_id: string
  name: string
  sku: string
  barcodes?: string[]
  category: string
  unit: string
  selling_price: number
  pricing_method?: 'fixed_price' | 'assisted_pack' | 'manual_quantity'
  rounding_rule?: 'none' | 'nearest_5' | 'up_5' | 'down_5' | 'nearest_10'
  pricing_options?: Array<{ quantity?: number; baseQuantity?: number; price?: number; maxDiscountAmount?: number; uomId?: string | null }> | null
  uom_options?: Array<{
    id?: string
    name?: string
    abbreviation?: string
    conversionFactor?: number
    isBaseUnit?: boolean
    isBaseUom?: boolean
    isDefaultSaleUom?: boolean
    isDefaultPurchaseUom?: boolean
  }> | null
  quantity_on_hand: number
  quantity_reserved: number
  base_quantity_on_hand?: number
  base_quantity_reserved?: number
  recovery_item_id?: string | null
  stock_source?: 'normal' | 'recovery'
}

/**
 * Converts database product rows to employee sale form options.
 */
export function mapEmployeeProductOption(row: EmployeeAvailableProductRow): EmployeeProductOption {
  const uomOptions = (row.uom_options ?? []).map((option) => ({
    id: String(option.id ?? ''),
    name: String(option.name ?? 'Unit'),
    abbreviation: String(option.abbreviation ?? ''),
    conversionFactor: Number(option.conversionFactor ?? 1),
    isBaseUnit: Boolean(option.isBaseUnit),
    isBaseUom: Boolean(option.isBaseUom),
    isDefaultSaleUom: Boolean(option.isDefaultSaleUom),
    isDefaultPurchaseUom: Boolean(option.isDefaultPurchaseUom),
  })).filter((option) => option.id.length > 0 && option.conversionFactor > 0)
  const saleUomIds = new Set(uomOptions.map((option) => option.id))

  return {
    optionId: row.recovery_item_id ? `recovery:${row.recovery_item_id}` : `normal:${row.product_id}`,
    productId: row.product_id,
    name: row.name,
    sku: row.sku,
    barcodes: row.barcodes ?? [],
    category: row.category,
    unit: row.unit,
    sellingPrice: Number(row.selling_price),
    pricingMethod: row.pricing_method ?? 'fixed_price',
    roundingRule: row.rounding_rule ?? 'nearest_5',
    pricingOptions: (row.pricing_options ?? [])
      .filter((option) => !option.uomId || saleUomIds.has(option.uomId))
      .map((option) => ({
        quantity: Number(option.quantity ?? option.baseQuantity ?? 0),
        baseQuantity: Number(option.baseQuantity ?? option.quantity ?? 0),
        price: Number(option.price ?? 0),
        maxDiscountAmount: Number(option.maxDiscountAmount ?? 0),
        uomId: option.uomId ?? null,
      })),
    uomOptions,
    quantityOnHand: row.quantity_on_hand,
    quantityReserved: row.quantity_reserved,
    baseQuantityOnHand: Number(row.base_quantity_on_hand ?? row.quantity_on_hand),
    baseQuantityReserved: Number(row.base_quantity_reserved ?? row.quantity_reserved),
    recoveryItemId: row.recovery_item_id ?? null,
    stockSource: row.stock_source ?? 'normal',
  }
}
