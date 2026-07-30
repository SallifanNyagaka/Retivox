/**
 * Employee sale pricing helpers for Retivox mobile.
 *
 * These helpers mirror the web form's client-side preview. The database RPC is
 * still the source of truth for final prices, discounts, and stock deduction.
 */

import type { EmployeeProductOption, UomOption } from './employeeApi'

export type PreviewPricing = {
  lineTotal: number
  maxDiscountAmount: number
}

/**
 * Formats a money amount for the business currency.
 *
 * @param amount - Money amount.
 * @param currency - ISO currency code.
 * @returns Formatted money label.
 */
export function formatMoney(amount: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)
}

/**
 * Formats quantities without noisy decimal places.
 *
 * @param quantity - Quantity value.
 * @returns Human-readable quantity.
 */
export function formatQuantity(quantity: number): string {
  return quantity.toLocaleString(undefined, { maximumFractionDigits: 4 })
}

/**
 * Returns a title-cased status label.
 *
 * @param status - Raw status.
 * @returns Readable status.
 */
export function formatStatusLabel(status: string): string {
  return status
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

/**
 * Gets the default sale UOM for a product.
 *
 * @param product - Product option.
 * @returns UOM option or null.
 */
export function getDefaultSaleUom(product: EmployeeProductOption | null): UomOption | null {
  if (!product) return null

  return product.uomOptions.find((uom) => uom.isDefaultSaleUom) ??
    product.uomOptions.find((uom) => uom.isBaseUom || uom.isBaseUnit || uom.conversionFactor === 1) ??
    product.uomOptions[0] ??
    null
}

/**
 * Gets the base UOM for a product.
 *
 * @param product - Product option.
 * @returns UOM option or null.
 */
export function getBaseUom(product: Pick<EmployeeProductOption, 'uomOptions'> | null): UomOption | null {
  if (!product) return null

  return product.uomOptions.find((uom) => uom.isBaseUom || uom.isBaseUnit || uom.conversionFactor === 1) ??
    product.uomOptions[0] ??
    null
}

/**
 * Converts quantity in selected UOM to base quantity.
 *
 * @param quantity - Selected UOM quantity.
 * @param selectedUom - Selected UOM.
 * @returns Base quantity or null.
 */
export function getBaseQuantity(quantity: number, selectedUom: UomOption | null): number | null {
  if (!selectedUom || !Number.isFinite(quantity) || quantity <= 0) {
    return null
  }

  return Number((quantity * selectedUom.conversionFactor).toFixed(4))
}

/**
 * Applies preview rounding.
 *
 * @param value - Raw amount.
 * @param rule - Rounding rule.
 * @returns Rounded amount.
 */
function roundPreviewPrice(value: number, rule: EmployeeProductOption['roundingRule']): number {
  if (rule === 'none') return Number(value.toFixed(2))
  if (rule === 'up_5') return Math.ceil(value / 5) * 5
  if (rule === 'down_5') return Math.floor(value / 5) * 5
  if (rule === 'nearest_10') return Math.round(value / 10) * 10
  return Math.round(value / 5) * 5
}

/**
 * Resolves display-only pricing for a product line.
 *
 * @param product - Product option.
 * @param baseQuantity - Sale base quantity.
 * @param selectedUomId - Selected UOM id.
 * @returns Preview pricing or null when manual pricing has no exact price.
 */
export function resolvePreviewPricing(
  product: EmployeeProductOption,
  baseQuantity: number,
  selectedUomId: string | null,
): PreviewPricing | null {
  if (!Number.isFinite(baseQuantity) || baseQuantity <= 0) {
    return null
  }

  if (product.stockSource === 'recovery') {
    const selectedUom = product.uomOptions.find((uom) => uom.id === selectedUomId) ?? getDefaultSaleUom(product)
    const matchingOption = product.pricingOptions.find((option) => option.uomId === selectedUom?.id) ?? product.pricingOptions[0]
    const recoveryUnitPrice = matchingOption?.price ?? product.sellingPrice

    if (!selectedUom || recoveryUnitPrice <= 0) {
      return null
    }

    return {
      lineTotal: Number(((baseQuantity / selectedUom.conversionFactor) * recoveryUnitPrice).toFixed(2)),
      maxDiscountAmount: 0,
    }
  }

  const matchingUomOptions = product.pricingOptions.filter((option) => option.uomId === selectedUomId)

  if (product.pricingMethod === 'fixed_price' && matchingUomOptions.length === 0) {
    return {
      lineTotal: Number((product.sellingPrice * baseQuantity).toFixed(2)),
      maxDiscountAmount: 0,
    }
  }

  const sourceOptions = matchingUomOptions.length > 0
    ? matchingUomOptions
    : product.pricingOptions.filter((option) => option.uomId === null)

  const sortedOptions = [...sourceOptions]
    .filter((option) => option.baseQuantity > 0 && option.price >= 0)
    .sort((first, second) => first.baseQuantity - second.baseQuantity)

  if (sortedOptions.length === 0) {
    return {
      lineTotal: Number((product.sellingPrice * baseQuantity).toFixed(2)),
      maxDiscountAmount: 0,
    }
  }

  if (product.pricingMethod === 'manual_quantity') {
    const exactOption = sortedOptions.find((option) => option.baseQuantity === baseQuantity)
    return exactOption
      ? {
          lineTotal: Number(exactOption.price.toFixed(2)),
          maxDiscountAmount: Number(exactOption.maxDiscountAmount.toFixed(2)),
        }
      : null
  }

  const exactOption = sortedOptions.find((option) => option.baseQuantity === baseQuantity)

  if (exactOption) {
    return {
      lineTotal: Number(exactOption.price.toFixed(2)),
      maxDiscountAmount: Number(exactOption.maxDiscountAmount.toFixed(2)),
    }
  }

  const basisOption = [...sortedOptions].reverse().find((option) => option.baseQuantity < baseQuantity) ?? sortedOptions[0]
  const quantityMultiplier = baseQuantity / basisOption.baseQuantity

  return {
    lineTotal: roundPreviewPrice(baseQuantity * (basisOption.price / basisOption.baseQuantity), product.roundingRule),
    maxDiscountAmount: Number((basisOption.maxDiscountAmount * quantityMultiplier).toFixed(2)),
  }
}

/**
 * Formats available stock in base units.
 *
 * @param product - Product option.
 * @returns Available stock label.
 */
export function formatProductAvailability(product: Pick<EmployeeProductOption, 'baseQuantityOnHand' | 'baseQuantityReserved' | 'uomOptions'>): string {
  const baseUom = getBaseUom(product)
  const available = Math.max(product.baseQuantityOnHand - product.baseQuantityReserved, 0)

  return `${formatQuantity(available)} ${baseUom?.name ?? 'units'}`
}
