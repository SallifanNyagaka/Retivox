/**
 * Pure Unit of Measure conversion helpers for Retivox.
 *
 * These functions contain no Supabase or server-only imports so they can be
 * safely reused by client previews, server actions, and tests.
 */

/**
 * Converts a quantity in a given UOM to base units.
 *
 * @param quantity - Amount in the selected UOM.
 * @param conversionFactor - UOM multiplier relative to the base unit.
 * @returns Equivalent quantity in base units.
 */
export function toBaseUnits(quantity: number, conversionFactor: number): number {
  return quantity * conversionFactor
}

/**
 * Converts a base quantity into a human-readable UOM label.
 *
 * @param baseQuantity - Quantity stored in base units.
 * @param uom - Display UOM metadata and base UOM label.
 * @returns Human-readable label such as "10 Trays of 30 and 10 Singles".
 */
export function fromBaseUnits(
  baseQuantity: number,
  uom: { name: string; conversionFactor: number; baseUomName: string }
): string {
  const fullUnits = Math.floor(baseQuantity / uom.conversionFactor)
  const remainder = baseQuantity % uom.conversionFactor

  if (remainder === 0) {
    return `${fullUnits} ${uom.name}`
  }

  return `${fullUnits} ${uom.name} and ${remainder} ${uom.baseUomName}`
}

/**
 * Formats a real-time conversion preview for stock entry forms.
 *
 * @param quantity - Amount in the selected UOM.
 * @param conversionFactor - UOM multiplier relative to the base unit.
 * @param baseUomName - Human label for the base unit.
 * @returns Preview string such as "= 300 Single units will be added to inventory".
 */
export function conversionPreview(quantity: number, conversionFactor: number, baseUomName: string): string {
  const base = toBaseUnits(quantity, conversionFactor)
  return `= ${base} ${baseUomName} will be added to inventory`
}
