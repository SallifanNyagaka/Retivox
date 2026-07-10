/**
 * Employee web transaction recording page.
 *
 * Loads only products available at the employee's current branch and renders a
 * web sale form that records transactions through the atomic database RPC.
 */

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Card, CardHeader } from '../../../../../components/ui/Card'
import { requireAuth } from '../../../../../lib/auth/helpers'
import { getEmployeeProfile } from '../../../../../lib/employee/auth'
import logger from '../../../../../lib/logger'
import { createClient } from '../../../../../lib/supabase/server'
import RecordEmployeeTransactionForm, { type EmployeeProductOption } from './RecordEmployeeTransactionForm'
import { mapEmployeeProductOption, type EmployeeAvailableProductRow } from './productOptions'

/**
 * Business row used to load the display currency.
 */
type BusinessCurrencyRow = {
  currency: string
}

/**
 * EmployeeNewTransactionPage renders the branch-scoped web transaction form.
 */
export default async function EmployeeNewTransactionPage() {
  const user = await requireAuth()
  const employeeProfile = await getEmployeeProfile(user.id)

  if (!employeeProfile) {
    redirect('/unauthorized')
  }

  if (!employeeProfile.isActive) {
    redirect('/account/deactivated')
  }

  if (!employeeProfile.branchId) {
    redirect('/dashboard/employee/unassigned')
  }

  let products: EmployeeProductOption[] = []
  let currency = 'USD'
  let pageError: string | null = null

  try {
    const supabase = await createClient()
    const [businessResponse, productsResponse] = await Promise.all([
      supabase.from('businesses').select('currency').eq('id', employeeProfile.businessId).single(),
      supabase.rpc('employee_available_products', {
        p_branch_id: employeeProfile.branchId,
      }),
    ])

    if (businessResponse.error) {
      throw businessResponse.error
    }

    if (productsResponse.error) {
      throw productsResponse.error
    }

    const business = businessResponse.data as BusinessCurrencyRow | null
    currency = business?.currency ?? currency
    products = ((productsResponse.data ?? []) as EmployeeAvailableProductRow[]).map(mapEmployeeProductOption)
  } catch (error: unknown) {
    logger.error('EmployeeNewTransactionPage data fetch failed', {
      userId: employeeProfile.id,
      businessId: employeeProfile.businessId,
      branchId: employeeProfile.branchId,
      error,
    })
    pageError = error instanceof Error ? error.message : 'Unable to load transaction form'
  }

  if (pageError) {
    return (
      <Card padding="md">
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-text-primary)', letterSpacing: '-0.3px' }}>
          Record transaction
        </h1>
        <p style={{ fontSize: 14, color: 'var(--color-danger)', marginTop: 8 }}>
          Failed to load the transaction form. Please refresh and try again.
        </p>
      </Card>
    )
  }

  return (
    <div className="mx-auto flex w-full flex-col items-center gap-6 text-center">
      {/* Page header */}
      <div className="flex w-full flex-col items-center justify-center gap-4 text-center">
        <div>
          <h1
            className="font-bold"
            style={{ fontSize: 22, color: 'var(--color-text-primary)', letterSpacing: '-0.3px' }}
          >
            Record transaction
          </h1>
          <p style={{ fontSize: 14, color: 'var(--color-text-muted)', marginTop: 4 }}>
            Record a sale at {employeeProfile.branchName}. Prices and stock are checked server-side.
          </p>
        </div>
        <Link href="/dashboard/employee/transactions" className="btn-outline" style={{ padding: '8px 16px', borderRadius: 8 }}>
          Back to my transactions
        </Link>
      </div>

      <div className="w-full">
        <Card padding="md">
          <CardHeader title="Sale details" />
          {products.length === 0 ? (
            <div className="flex flex-col items-center justify-center text-center" style={{ padding: '42px 20px', gap: 14 }}>
              <h2 style={{ fontSize: 20, fontWeight: 600, color: 'var(--color-text-primary)', margin: 0 }}>
                No products available
              </h2>
              <p style={{ fontSize: 14, color: 'var(--color-text-muted)', margin: 0 }}>
                There are no approved, stocked products available at your branch right now.
              </p>
            </div>
          ) : (
            <RecordEmployeeTransactionForm products={products} currency={currency} />
          )}
        </Card>
      </div>
    </div>
  )
}
