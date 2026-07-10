/**
 * Admin transactions dashboard page.
 *
 * Uses the shared transaction loader and existing owner transaction view while
 * scoping rows to branches where the admin has contextual access.
 */

import { GlobalRole } from '@smartretail/shared'
import { requireRole } from '../../../../lib/auth/helpers'
import {
  getTransactionsDashboardData,
  parseTransactionFilters,
  type TransactionsDashboardData,
  type TransactionsSearchParams,
} from '../../../../lib/dashboard/transactions'
import { Card } from '../../../../components/ui/Card'
import TransactionsPageView from '../../owner/transactions/TransactionsPageView'

/**
 * Admin transactions page server component.
 */
export default async function AdminTransactionsPage({ searchParams }: { searchParams: TransactionsSearchParams }) {
  const profile = await requireRole([GlobalRole.Admin])
  const businessId = profile.business_id

  if (!businessId) {
    throw new Error('Admin profile missing business ID')
  }

  const filters = await parseTransactionFilters(searchParams)
  let data: TransactionsDashboardData

  try {
    data = await getTransactionsDashboardData(profile.id, businessId, filters, {
      minimumBranchRole: 'admin',
    })
  } catch {
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h1
            className="font-bold"
            style={{
              fontSize: '22px',
              color: 'var(--color-text-primary)',
              letterSpacing: '-0.3px',
            }}
          >
            Transactions
          </h1>
          <p style={{ fontSize: '14px', color: 'var(--color-text-muted)', marginTop: '4px' }}>
            Review sales and payment activity for branches you manage.
          </p>
        </div>

        <Card>
          <p style={{ fontSize: '14px', color: 'var(--color-danger)', margin: 0 }}>
            Failed to load the transactions page. Please refresh and try again.
          </p>
        </Card>
      </div>
    )
  }

  return (
    <TransactionsPageView
      currency={data.currency}
      branches={data.branches}
      transactions={data.transactions}
      filters={data.filters}
      metrics={data.metrics}
      totalCount={data.totalCount}
      totalPages={data.totalPages}
      basePath="/dashboard/admin/transactions"
      subtitle="Review sales and payment activity for branches you manage."
      canManageTransactions={false}
    />
  )
}
