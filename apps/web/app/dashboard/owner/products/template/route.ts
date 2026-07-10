/**
 * XLSX template route for bulk product imports.
 *
 * Provides product and pricing headers expected by the import action.
 */

import { GlobalRole } from '@smartretail/shared'
import { requireRole } from '../../../../../lib/auth/helpers'
import { createClient } from '../../../../../lib/supabase/server'
import logger from '../../../../../lib/logger'
import { buildWorkbookBuffer, workbookDownloadResponse } from '../../../../../lib/spreadsheets/workbooks'

type ProductTemplateRow = {
  Name: string
  SKU: string
  'Product Kind': string
  Category: string
  Subcategory: string
  'Brand Family': string
  'Base Unit': string
  'Unit Abbreviation': string
  'Unit Conversion Factor': number
  Description: string
  'Base Price': number
  'Min Price': number
  'Max Price': number
  'Pricing Method': string
  'Rounding Rule': string
  'Applies To': string
  'Branch Names': string
  'Price Points': string
}

type UnitRow = {
  name: string
  abbreviation: string
  conversion_factor: string | number
}

type BranchRow = {
  name: string
}

type ExistingProductRow = {
  category: string
  subcategory: string | null
  brand_family: string | null
}

type QueryErrorLike = {
  code?: string
  message?: string
}

/**
 * Returns a unique, sorted dropdown list with useful defaults first.
 */
function buildDropdownValues(defaults: string[], values: string[]): string[] {
  return Array.from(new Set([...defaults, ...values].map((value) => value.trim()).filter((value) => value.length > 0))).sort((first, second) =>
    first.localeCompare(second)
  )
}

/**
 * Detects optional-schema lookup failures while additive migrations roll out.
 */
function isOptionalLookupError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false
  }

  const queryError = error as QueryErrorLike
  const message = queryError.message ?? ''

  return (
    queryError.code === '42P01' ||
    queryError.code === '42703' ||
    queryError.code === 'PGRST200' ||
    queryError.code === 'PGRST204' ||
    message.includes('does not exist') ||
    message.includes('Could not find')
  )
}

/**
 * Handles product import template downloads.
 */
export async function GET() {
  const profile = await requireRole([GlobalRole.Owner])
  const businessId = profile.business_id

  if (!businessId) {
    throw new Error('Owner profile missing business ID')
  }

  try {
    const supabase = await createClient()
    const [unitsResponse, branchesResponse, productsResponse] = await Promise.all([
      supabase
        .from('units_of_measure')
        .select('name, abbreviation, conversion_factor')
        .eq('business_id', businessId)
        .eq('is_active', true)
        .order('name', { ascending: true }),
      supabase
        .from('branches')
        .select('name')
        .eq('business_id', businessId)
        .eq('is_active', true)
        .order('name', { ascending: true }),
      supabase
        .from('products')
        .select('category, subcategory, brand_family')
        .eq('business_id', businessId)
        .order('category', { ascending: true }),
    ])

    if (unitsResponse.error && !isOptionalLookupError(unitsResponse.error)) throw unitsResponse.error
    if (branchesResponse.error && !isOptionalLookupError(branchesResponse.error)) throw branchesResponse.error
    if (productsResponse.error && !isOptionalLookupError(productsResponse.error)) throw productsResponse.error

    if (unitsResponse.error) {
      logger.warn('Product template UOM lookup skipped; using default UOM dropdowns', { businessId, error: unitsResponse.error })
    }

    if (branchesResponse.error) {
      logger.warn('Product template branch lookup skipped; using empty branch dropdown', { businessId, error: branchesResponse.error })
    }

    if (productsResponse.error) {
      logger.warn('Product template product lookup skipped; using default category dropdowns', { businessId, error: productsResponse.error })
    }

    const units = (unitsResponse.error ? [] : unitsResponse.data ?? []) as UnitRow[]
    const branches = (branchesResponse.error ? [] : branchesResponse.data ?? []) as BranchRow[]
    const existingProducts = (productsResponse.error ? [] : productsResponse.data ?? []) as ExistingProductRow[]
    const baseUnitValues = buildDropdownValues(['Single', 'Tray of 30', 'Pack of 6', 'Pack of 10', 'Kg', '500g'], units.map((unit) => unit.name))
    const abbreviationValues = buildDropdownValues(['pc', 'tray30', 'pack6', 'pack10', 'kg', '500g'], units.map((unit) => unit.abbreviation))
    const conversionValues = buildDropdownValues(['1', '6', '10', '30', '0.5'], units.map((unit) => String(unit.conversion_factor)))

    const buffer = await buildWorkbookBuffer<ProductTemplateRow>({
      sheetName: 'Product Import Template',
      columns: [
        { header: 'Name', key: 'Name' },
        { header: 'SKU', key: 'SKU' },
        { header: 'Product Kind', key: 'Product Kind' },
        { header: 'Category', key: 'Category' },
        { header: 'Subcategory', key: 'Subcategory' },
        { header: 'Brand Family', key: 'Brand Family' },
        { header: 'Base Unit', key: 'Base Unit' },
        { header: 'Unit Abbreviation', key: 'Unit Abbreviation' },
        { header: 'Unit Conversion Factor', key: 'Unit Conversion Factor', numFmt: '#,##0.0000' },
        { header: 'Description', key: 'Description' },
        { header: 'Base Price', key: 'Base Price', numFmt: '#,##0.00' },
        { header: 'Min Price', key: 'Min Price', numFmt: '#,##0.00' },
        { header: 'Max Price', key: 'Max Price', numFmt: '#,##0.00' },
        { header: 'Pricing Method', key: 'Pricing Method' },
        { header: 'Rounding Rule', key: 'Rounding Rule' },
        { header: 'Applies To', key: 'Applies To' },
        { header: 'Branch Names', key: 'Branch Names' },
        { header: 'Price Points', key: 'Price Points' },
      ],
      rows: [
        {
          Name: 'Kienyeji Eggs',
          SKU: 'EGG-KIEN-001',
          'Product Kind': 'measured_counted',
          Category: 'Food',
          Subcategory: 'Chicken Eggs',
          'Brand Family': 'Eggs',
          'Base Unit': 'Single',
          'Unit Abbreviation': 'pc',
          'Unit Conversion Factor': 1,
          Description: 'Kienyeji chicken eggs',
          'Base Price': 20,
          'Min Price': 15,
          'Max Price': 25,
          'Pricing Method': 'assisted_pack',
          'Rounding Rule': 'nearest_5',
          'Applies To': 'all',
          'Branch Names': '',
          'Price Points': '1@20; 6@100; 10@170',
        },
      ],
      dropdowns: [
        { key: 'Product Kind', values: ['fixed_package', 'measured_counted'], rows: 500 },
        { key: 'Category', values: buildDropdownValues(['Food', 'Detergents', 'Bakery'], existingProducts.map((product) => product.category)), rows: 500 },
        { key: 'Subcategory', values: buildDropdownValues(['Chicken Eggs', 'Powder Detergent'], existingProducts.map((product) => product.subcategory ?? '')), rows: 500 },
        { key: 'Brand Family', values: buildDropdownValues(['Eggs', 'OMO'], existingProducts.map((product) => product.brand_family ?? '')), rows: 500 },
        { key: 'Base Unit', values: baseUnitValues, rows: 500 },
        { key: 'Unit Abbreviation', values: abbreviationValues, rows: 500 },
        { key: 'Unit Conversion Factor', values: conversionValues, rows: 500 },
        { key: 'Pricing Method', values: ['fixed_price', 'assisted_pack', 'manual_quantity'], rows: 500 },
        { key: 'Rounding Rule', values: ['nearest_5', 'up_5', 'down_5', 'nearest_10', 'none'], rows: 500 },
        { key: 'Applies To', values: ['all', 'selected'], rows: 500 },
        { key: 'Branch Names', values: branches.map((branch) => branch.name), rows: 500 },
      ],
    })

    return workbookDownloadResponse(buffer, 'retivox-product-import-template.xlsx')
  } catch (error: unknown) {
    logger.error('Product template download failed', { businessId, error })
    return new Response('Unable to download product template', { status: 500 })
  }
}
