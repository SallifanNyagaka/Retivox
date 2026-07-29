import { GlobalRole } from '@smartretail/shared'
import { requireRole } from '../../../../lib/auth/helpers'
import { getStockDashboardData } from '../../../../lib/dashboard/stock'
import SuppliersPageClient from './SuppliersPageClient'

export default async function OwnerSuppliersPage() {
  const profile = await requireRole([GlobalRole.Owner])
  const businessId = profile.business_id

  if (!businessId) {
    throw new Error('Owner profile missing business ID')
  }

  const { suppliers } = await getStockDashboardData(profile.id, businessId)

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-bold" style={{ fontSize: 22, color: 'var(--color-text-primary)', letterSpacing: '-0.3px' }}>
          Suppliers
        </h1>
        <p style={{ fontSize: 14, color: 'var(--color-text-muted)', marginTop: 4 }}>
          Manage supplier contacts, availability notes, and rankings across your business.
        </p>
      </div>

      <SuppliersPageClient role="owner" suppliers={suppliers} />
    </div>
  )
}
