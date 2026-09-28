/**
 * XLSX export route for owner products.
 *
 * Downloads product catalog rows with pricing boundaries and optional search,
 * status, and category filters.
 */

import { GlobalRole } from '@smartretail/shared'
import { requireRole } from '../../../../../lib/auth/helpers'
import { createClient } from '../../../../../lib/supabase/server'
import logger from '../../../../../lib/logger'
import { buildWorkbookBuffer, workbookDownloadResponse } from '../../../../../lib/spreadsheets/workbooks'

type ProductExportRow = {
  Name: string
  SKU: string
  'Product Kind': string
  Category: string
  Subcategory: string
  'Brand Family': string
  'Base Unit': string
  Description: string
  'Base Price': number
  'Min Price': number
  'Max Price': number
  'Pricing Method': string
  'Rounding Rule': string
  'Applies To': string
  'Branch Names': string
  'Price Points': string
  'Max Discounts': string
  Status: string
  Created: string
}

type ProductPricePointExportRow = {
  quantity_in_uom: string | number
  uom_id?: string | null
  max_discount_amount?: string | number
  price: string | number
}

type ProductPricingModelExportRow = {
  branch_id: string | null
  pricing_method: string
  rounding_rule: string
  status: string
  product_price_points?: ProductPricePointExportRow[] | null
}

type ProductQueryRow = {
  name: string
  sku: string
  product_kind?: string | null
  category: string
  subcategory?: string | null
  brand_family?: string | null
  unit: string
  description: string | null
  is_active: boolean
  created_at: string
  product_pricing?: Array<{ base_price: string; min_price: string; max_price: string }> | null
  product_pricing_models?: ProductPricingModelExportRow[] | null
}

type UnitExportLookupRow = {
  name: string
  abbreviation: string
  conversion_factor: string | number
}

const MAX_EXPORT_ROWS = 1000

/**
 * Returns a unique, sorted dropdown list with useful defaults first.
 */
function buildDropdownValues(defaults: string[], values: string[]): string[] {
  return Array.from(new Set([...defaults, ...values].map((value) => value.trim()).filter((value) => value.length > 0))).sort((first, second) =>
    first.localeCompare(second)
  )
}

/**
 * Formats price point rows into an import-compatible compact string.
 */
function formatPricePoints(points: ProductPricePointExportRow[] | null | undefined): string {
  return (points ?? [])
    .map((point) => `${Number(point.quantity_in_uom)}@${Number(point.price)}`)
    .join('; ')
}

/**
 * Formats maximum discount rows into a compact quantity<=amount string.
 */
function formatMaxDiscounts(points: ProductPricePointExportRow[] | null | undefined): string {
  return (points ?? [])
    .filter((point) => Number(point.max_discount_amount ?? 0) > 0)
    .map((point) => `${Number(point.quantity_in_uom)}<=${Number(point.max_discount_amount ?? 0)}`)
    .join('; ')
}

/**
 * Handles product spreadsheet downloads.
 */
export async function GET(request: Request) {
  const profile = await requireRole([GlobalRole.Owner])
  const businessId = profile.business_id

  if (!businessId) {
    throw new Error('Owner profile missing business ID')
  }

  try {
    const url = new URL(request.url)
    const query = (url.searchParams.get('q') ?? '').trim().toLowerCase()
    const status = url.searchParams.get('status')
    const category = (url.searchParams.get('category') ?? '').trim().toLowerCase()
    const supabase = await createClient()

    const [branchesResponse, unitsResponse] = await Promise.all([
      supabase
        .from('branches')
        .select('id, name', { count: 'exact' })
        .eq('business_id', businessId)
        .limit(MAX_EXPORT_ROWS + 1),
      supabase
        .from('units_of_measure')
        .select('name, abbreviation, conversion_factor', { count: 'exact' })
        .eq('business_id', businessId)
        .eq('is_active', true)
        .limit(MAX_EXPORT_ROWS + 1),
    ])

    if (branchesResponse.error) throw branchesResponse.error
    if (unitsResponse.error) throw unitsResponse.error
    if ([branchesResponse.count, unitsResponse.count].some((count) => (count ?? 0) > MAX_EXPORT_ROWS)) {
      return new Response(`Refine the product or branch data to export no more than ${MAX_EXPORT_ROWS} lookup records.`, { status: 413 })
    }

    const branches = (branchesResponse.data ?? []) as Array<{ id: string; name: string }>
    const units = (unitsResponse.data ?? []) as UnitExportLookupRow[]
    const branchNameById = new Map(branches.map((branch) => [branch.id, branch.name]))

    let productQuery = supabase
      .from('products')
      .select(
        'name, sku, product_kind, category, subcategory, brand_family, unit, description, is_active, created_at, product_pricing(base_price, min_price, max_price), product_pricing_models(branch_id, pricing_method, rounding_rule, status, product_price_points(quantity_in_uom, uom_id, price, max_discount_amount))',
        { count: 'exact' }
      )
      .eq('business_id', businessId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(MAX_EXPORT_ROWS + 1)

    if (status === 'active') {
      productQuery = productQuery.eq('is_active', true)
    }

    if (status === 'inactive') {
      productQuery = productQuery.eq('is_active', false)
    }

    const { data, error, count } = await productQuery

    if (error) {
      throw error
    }
    if ((count ?? 0) > MAX_EXPORT_ROWS) {
      return new Response(`Refine the filters to export no more than ${MAX_EXPORT_ROWS} products.`, { status: 413 })
    }

    const rows = ((data ?? []) as ProductQueryRow[])
      .filter((product) => {
        const matchesSearch = query
          ? `${product.name} ${product.sku} ${product.category} ${product.subcategory ?? ''} ${product.brand_family ?? ''}`.toLowerCase().includes(query)
          : true
        const matchesCategory = category ? product.category.toLowerCase() === category : true
        return matchesSearch && matchesCategory
      })
      .map<ProductExportRow>((product) => {
        const pricing = product.product_pricing?.[0]
        const activeModels = (product.product_pricing_models ?? []).filter((model) => model.status === 'approved' || model.status === 'pending_approval')
        const primaryModel = activeModels.find((model) => model.branch_id === null) ?? activeModels[0] ?? null
        const branchModels = activeModels.filter((model) => model.branch_id)
        const branchNames = branchModels
          .map((model) => (model.branch_id ? branchNameById.get(model.branch_id) ?? model.branch_id : ''))
          .filter((name) => name.length > 0)
          .join(', ')

        return {
          Name: product.name,
          SKU: product.sku,
          'Product Kind': product.product_kind ?? 'fixed_package',
          Category: product.category,
          Subcategory: product.subcategory ?? '',
          'Brand Family': product.brand_family ?? '',
          'Base Unit': product.unit,
          Description: product.description ?? '',
          'Base Price': Number(pricing?.base_price ?? 0),
          'Min Price': Number(pricing?.min_price ?? 0),
          'Max Price': Number(pricing?.max_price ?? 0),
          'Pricing Method': primaryModel?.pricing_method ?? 'fixed_price',
          'Rounding Rule': primaryModel?.rounding_rule ?? 'nearest_5',
          'Applies To': branchModels.length > 0 ? 'selected' : 'all',
          'Branch Names': branchNames,
          'Price Points': formatPricePoints(primaryModel?.product_price_points),
          'Max Discounts': formatMaxDiscounts(primaryModel?.product_price_points),
          Status: product.is_active ? 'Active' : 'Inactive',
          Created: new Date(product.created_at).toISOString(),
        }
      })

    const buffer = await buildWorkbookBuffer<ProductExportRow>({
      sheetName: 'Products',
      columns: [
        { header: 'Name', key: 'Name' },
        { header: 'SKU', key: 'SKU' },
        { header: 'Product Kind', key: 'Product Kind' },
        { header: 'Category', key: 'Category' },
        { header: 'Subcategory', key: 'Subcategory' },
        { header: 'Brand Family', key: 'Brand Family' },
        { header: 'Base Unit', key: 'Base Unit' },
        { header: 'Description', key: 'Description' },
        { header: 'Base Price', key: 'Base Price', numFmt: '#,##0.00' },
        { header: 'Min Price', key: 'Min Price', numFmt: '#,##0.00' },
        { header: 'Max Price', key: 'Max Price', numFmt: '#,##0.00' },
        { header: 'Pricing Method', key: 'Pricing Method' },
        { header: 'Rounding Rule', key: 'Rounding Rule' },
        { header: 'Applies To', key: 'Applies To' },
        { header: 'Branch Names', key: 'Branch Names' },
        { header: 'Price Points', key: 'Price Points' },
        { header: 'Max Discounts', key: 'Max Discounts' },
        { header: 'Status', key: 'Status' },
        { header: 'Created', key: 'Created', numFmt: 'yyyy-mm-dd' },
      ],
      rows,
      dropdowns: [
        { key: 'Product Kind', values: ['fixed_package', 'measured_counted'], rows: Math.max(rows.length + 25, 500) },
        { key: 'Category', values: buildDropdownValues(['Food', 'Detergents', 'Bakery'], rows.map((row) => row.Category)), rows: Math.max(rows.length + 25, 500) },
        { key: 'Subcategory', values: buildDropdownValues(['Chicken Eggs', 'Powder Detergent'], rows.map((row) => row.Subcategory)), rows: Math.max(rows.length + 25, 500) },
        { key: 'Brand Family', values: buildDropdownValues(['Eggs', 'OMO'], rows.map((row) => row['Brand Family'])), rows: Math.max(rows.length + 25, 500) },
        { key: 'Base Unit', values: buildDropdownValues(['Single', 'Tray of 30', 'Pack of 6', 'Pack of 10', 'Kg', '500g'], units.map((unit) => unit.name)), rows: Math.max(rows.length + 25, 500) },
        { key: 'Pricing Method', values: ['fixed_price', 'assisted_pack', 'manual_quantity'], rows: Math.max(rows.length + 25, 500) },
        { key: 'Rounding Rule', values: ['nearest_5', 'up_5', 'down_5', 'nearest_10', 'none'], rows: Math.max(rows.length + 25, 500) },
        { key: 'Applies To', values: ['all', 'selected'], rows: Math.max(rows.length + 25, 500) },
        { key: 'Branch Names', values: branches.map((branch) => branch.name), rows: Math.max(rows.length + 25, 500) },
      ],
    })

    return workbookDownloadResponse(buffer, 'retivox-products.xlsx')
  } catch (error: unknown) {
    logger.error('Products export failed', { businessId, error })
    return new Response('Unable to export products', { status: 500 })
  }
}
