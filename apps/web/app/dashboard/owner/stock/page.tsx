/**
 * Owner stock page — shows current branch stock and allows quick adjustments.
 */

import { requireRole } from '../../../../lib/auth/helpers'
import { GlobalRole } from '@smartretail/shared'
import { getStockDashboardData } from '../../../../lib/dashboard/stock'
import StockPageClient from './StockPageClient'

/**
 * Owner stock page.
 */
export default async function OwnerStockPage() {
  const profile = await requireRole([GlobalRole.Owner])
  const businessId = profile.business_id

  if (!businessId) {
    throw new Error('Owner profile missing business ID')
  }

  const { rows, metrics, branches, products, movements, deliveries, deliveryEditRequests, suppliers, expiryAlerts } = await getStockDashboardData(profile.id, businessId)

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-bold" style={{ fontSize: 22, color: 'var(--color-text-primary)', letterSpacing: '-0.3px' }}>
          Inventory
        </h1>
        <p style={{ fontSize: 14, color: 'var(--color-text-muted)', marginTop: 4 }}>
          Current stock levels across branches.
        </p>
      </div>

      <StockPageClient role="owner" rows={rows} metrics={metrics} branches={branches} products={products} movements={movements} deliveries={deliveries} deliveryEditRequests={deliveryEditRequests} suppliers={suppliers} expiryAlerts={expiryAlerts} />
    </div>
  )
}
