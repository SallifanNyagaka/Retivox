/**
 * Owner transaction recording page.
 */

import Link from 'next/link'
import { GlobalRole } from '@smartretail/shared'
import { requireRole } from '../../../../../lib/auth/helpers'
import { getDashboardSalePageData } from '../../../../../lib/dashboard/recordTransactionPage'
import { recordOwnerTransaction } from '../../../../../lib/dashboard/recordTransactionAction'
import { Card, CardHeader } from '../../../../../components/ui/Card'
import RecordEmployeeTransactionForm from '../../../employee/transactions/new/RecordEmployeeTransactionForm'

type SearchParams = Promise<{
  branch?: string
}>

export default async function OwnerNewTransactionPage({ searchParams }: { searchParams: SearchParams }) {
  const profile = await requireRole([GlobalRole.Owner])
  const businessId = profile.business_id

  if (!businessId) {
    throw new Error('Owner profile missing business ID')
  }

  const params = await searchParams
  const data = await getDashboardSalePageData(profile.id, businessId, 'owner', params.branch, 'owner_record_transaction')
  const selectedBranch = data.branches.find((branch) => branch.id === data.selectedBranchId) ?? null

  return (
    <div className="mx-auto flex w-full flex-col items-center gap-6 text-center">
      <div className="flex w-full flex-col items-center justify-center gap-4 text-center">
        <div>
          <h1 className="font-bold" style={{ fontSize: 22, color: 'var(--color-text-primary)', letterSpacing: '-0.3px' }}>
            Record owner transaction
          </h1>
          <p style={{ fontSize: 14, color: 'var(--color-text-muted)', marginTop: 4 }}>
            Record a sale for any active store. Owner sales are verified immediately.
          </p>
        </div>
        <Link href="/dashboard/owner/transactions" className="btn-outline" style={{ padding: '8px 16px', borderRadius: 8 }}>
          Back to transactions
        </Link>
      </div>

      <div className="w-full">
        <Card padding="md">
          <CardHeader title="Choose store" />
          {data.branches.length === 0 ? (
            <p style={{ fontSize: 14, color: 'var(--color-text-muted)', margin: 0 }}>
              No active stores are available for recording sales.
            </p>
          ) : (
            <form action="/dashboard/owner/transactions/new" method="get" className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
              <label style={{ fontSize: 13, textAlign: 'left', color: 'var(--color-text-primary)' }}>
                Store
                <select
                  name="branch"
                  defaultValue={data.selectedBranchId}
                  style={{
                    width: '100%',
                    height: 44,
                    border: '1px solid var(--color-border)',
                    borderRadius: 8,
                    padding: '0 12px',
                    marginTop: 6,
                    color: 'var(--color-text-primary)',
                    backgroundColor: 'var(--color-background)',
                  }}
                >
                  {data.branches.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.name}
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit" className="btn-outline" style={{ padding: '10px 16px', borderRadius: 8 }}>
                Load store
              </button>
            </form>
          )}
        </Card>
      </div>

      {selectedBranch && (
        <div className="w-full">
          <Card padding="md">
            <CardHeader title={`Sale details - ${selectedBranch.name}`} />
            {data.products.length === 0 ? (
              <div className="flex flex-col items-center justify-center text-center" style={{ padding: '42px 20px', gap: 14 }}>
                <h2 style={{ fontSize: 20, fontWeight: 600, color: 'var(--color-text-primary)', margin: 0 }}>
                  No products available
                </h2>
                <p style={{ fontSize: 14, color: 'var(--color-text-muted)', margin: 0 }}>
                  This store has no approved, stocked products available right now.
                </p>
              </div>
            ) : (
              <RecordEmployeeTransactionForm
                products={data.products}
                currency={data.currency}
                action={recordOwnerTransaction}
                branchId={data.selectedBranchId}
                redirectPath="/dashboard/owner/transactions"
                submitLabel="Record verified transaction"
                pendingMessage="Recording verified transaction..."
              />
            )}
          </Card>
        </div>
      )}
    </div>
  )
}
