/**
 * Shared loaders for owner/admin dashboard transaction recording pages.
 */

import { getAccessibleBranchIds, type BranchRole } from '../auth/branchAccess'
import logger from '../logger'
import { createClient } from '../supabase/server'
import { runSoftDeleteAwareQuery } from '../supabase/softDelete'
import { mapEmployeeProductOption, type EmployeeAvailableProductRow } from '../../app/dashboard/employee/transactions/new/productOptions'
import type { EmployeeProductOption } from '../../app/dashboard/employee/transactions/new/RecordEmployeeTransactionForm'

export type SaleBranchOption = {
  id: string
  name: string
}

type BusinessCurrencyRow = {
  currency: string
}

export type DashboardSalePageData = {
  currency: string
  branches: SaleBranchOption[]
  selectedBranchId: string
  products: EmployeeProductOption[]
}

export async function getDashboardSalePageData(
  userId: string,
  businessId: string,
  minimumBranchRole: BranchRole,
  requestedBranchId: string | undefined,
  logContext: string
): Promise<DashboardSalePageData> {
  const supabase = await createClient()
  const accessibleBranchIds = await getAccessibleBranchIds(userId, minimumBranchRole)

  const [businessResponse, branchesResponse] = await Promise.all([
    supabase.from('businesses').select('currency').eq('id', businessId).single(),
    accessibleBranchIds.length > 0
      ? runSoftDeleteAwareQuery<SaleBranchOption>(
          () =>
            supabase
              .from('branches')
              .select('id, name')
              .eq('business_id', businessId)
              .eq('is_active', true)
              .in('id', accessibleBranchIds)
              .is('deleted_at', null)
              .order('name'),
          () =>
            supabase
              .from('branches')
              .select('id, name')
              .eq('business_id', businessId)
              .eq('is_active', true)
              .in('id', accessibleBranchIds)
              .order('name'),
          { table: 'branches', businessId, page: logContext }
        )
      : Promise.resolve({ data: [], error: null }),
  ])

  if (businessResponse.error) {
    throw businessResponse.error
  }

  if (branchesResponse.error) {
    throw branchesResponse.error
  }

  const business = businessResponse.data as BusinessCurrencyRow | null

  if (!business?.currency) {
    throw new Error('Business currency missing')
  }

  const branches = (branchesResponse.data ?? []) as SaleBranchOption[]
  const selectedBranchId = branches.some((branch) => branch.id === requestedBranchId)
    ? requestedBranchId as string
    : branches[0]?.id ?? ''
  let products: EmployeeProductOption[] = []

  if (selectedBranchId) {
    const productsResponse = await supabase.rpc('employee_available_products', {
      p_branch_id: selectedBranchId,
    })

    if (productsResponse.error) {
      logger.error('getDashboardSalePageData: products load failed', {
        userId,
        businessId,
        selectedBranchId,
        minimumBranchRole,
        error: productsResponse.error,
      })
      throw productsResponse.error
    }

    products = ((productsResponse.data ?? []) as EmployeeAvailableProductRow[]).map(mapEmployeeProductOption)
  }

  return {
    currency: business.currency,
    branches,
    selectedBranchId,
    products,
  }
}
