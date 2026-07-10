/**
 * Admin products page.
 *
 * Shows the shared business product catalog in read-only mode for branch
 * administrators, with stock breakdowns limited to branches they administer.
 * Product creation, editing, pricing, activation, and deletion remain owner-only.
 */

import { GlobalRole } from '@smartretail/shared'
import { requireRole } from '../../../../lib/auth/helpers'
import { getAdminProductDashboardData } from '../../../../lib/dashboard/products'
import ProductsPageClient from '../../owner/products/ProductsPageClient'

/**
 * Admin products page server component.
 */
export default async function AdminProductsPage() {
  const profile = await requireRole([GlobalRole.Admin])
  const businessId = profile.business_id

  if (!businessId) {
    throw new Error('Admin profile missing business ID')
  }

  const { products, currency, productStocks, assignedBranchCount, metrics } = await getAdminProductDashboardData(
    profile.id,
    businessId
  )

  return (
    <ProductsPageClient
      products={products}
      currency={currency}
      readOnly
      productStocks={productStocks}
      assignedBranchCount={assignedBranchCount}
      metrics={metrics}
    />
  )
}
