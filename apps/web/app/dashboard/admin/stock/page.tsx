/**
 * Admin stock page.
 *
 * Renders the shared inventory dashboard for branches where the current user
 * has at least admin-level branch access.
 */

import { GlobalRole } from '@smartretail/shared'
import { requireRole } from '../../../../lib/auth/helpers'
import { getStockDashboardData } from '../../../../lib/dashboard/stock'
import StockPageClient from '../../owner/stock/StockPageClient'

/**
 * Admin stock page server component.
 */
export default async function AdminStockPage() {
  const profile = await requireRole([GlobalRole.Admin])
  const businessId = profile.business_id

  if (!businessId) {
    throw new Error('Admin profile missing business ID')
  }

  const { rows, metrics, branches, products, movements, deliveries, deliveryEditRequests, suppliers, expiryAlerts } = await getStockDashboardData(profile.id, businessId)

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-bold" style={{ fontSize: 22, color: 'var(--color-text-primary)', letterSpacing: '-0.3px' }}>
          Inventory
        </h1>
        <p style={{ fontSize: 14, color: 'var(--color-text-muted)', marginTop: 4 }}>
          Current stock levels for branches you manage.
        </p>
      </div>

      <StockPageClient role="admin" rows={rows} metrics={metrics} branches={branches} products={products} movements={movements} deliveries={deliveries} deliveryEditRequests={deliveryEditRequests} suppliers={suppliers} expiryAlerts={expiryAlerts} />
    </div>
  )
}
