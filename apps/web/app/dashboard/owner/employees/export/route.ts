/**
 * XLSX export route for owner employees.
 *
 * Downloads employees with branch assignment, transaction counts, and optional
 * search/status/branch filters.
 */

import { GlobalRole } from '@smartretail/shared'
import { requireRole } from '../../../../../lib/auth/helpers'
import { createClient } from '../../../../../lib/supabase/server'
import logger from '../../../../../lib/logger'
import { buildWorkbookBuffer, workbookDownloadResponse } from '../../../../../lib/spreadsheets/workbooks'

type EmployeeExportRow = {
  Name: string
  Email: string
  Phone: string
  Branch: string
  Transactions: number
  Status: string
  Created: string
}

type EmployeeTransactionCountRow = {
  employeeId: string
  count: number
}

const MAX_EXPORT_ROWS = 1000

/**
 * Handles employee spreadsheet downloads.
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
    const branchFilter = url.searchParams.get('branch') ?? ''
    const supabase = await createClient()

    const [usersResponse, branchesResponse, rolesResponse, countsResponse] = await Promise.all([
      supabase
        .from('users')
        .select('id, name, email, phone, is_active, created_at', { count: 'exact' })
        .eq('business_id', businessId)
        .eq('global_role', 'employee')
        .is('deleted_at', null)
        .order('created_at', { ascending: true })
        .limit(MAX_EXPORT_ROWS + 1),
      supabase.from('branches').select('id, name', { count: 'exact' }).eq('business_id', businessId).is('deleted_at', null).limit(MAX_EXPORT_ROWS + 1),
      supabase
        .from('user_branch_roles')
        .select('user_id, branch_id', { count: 'exact' })
        .eq('business_id', businessId)
        .eq('role', 'employee')
        .limit(MAX_EXPORT_ROWS + 1),
      supabase.rpc('owner_employee_transaction_counts'),
    ])

    if (usersResponse.error) throw usersResponse.error
    if (branchesResponse.error) throw branchesResponse.error
    if (rolesResponse.error) throw rolesResponse.error
    if (countsResponse.error) throw countsResponse.error
    if (
      [usersResponse.count, branchesResponse.count, rolesResponse.count].some((count) => (count ?? 0) > MAX_EXPORT_ROWS) ||
      (countsResponse.data?.length ?? 0) > MAX_EXPORT_ROWS
    ) {
      return new Response(`Refine the filters to export no more than ${MAX_EXPORT_ROWS} records.`, { status: 413 })
    }

    const branchMap = new Map(((branchesResponse.data ?? []) as Array<{ id: string; name: string }>).map((branch) => [branch.id, branch.name]))
    const roleMap = new Map(((rolesResponse.data ?? []) as Array<{ user_id: string; branch_id: string }>).map((role) => [role.user_id, role.branch_id]))
    const countMap = new Map(((countsResponse.data ?? []) as EmployeeTransactionCountRow[]).map((row) => [row.employeeId, row.count]))

    const rows = ((usersResponse.data ?? []) as Array<{
      id: string
      name: string
      email: string
      phone: string | null
      is_active: boolean
      created_at: string
    }>)
      .filter((employee) => {
        const branchId = roleMap.get(employee.id) ?? ''
        const branchName = branchMap.get(branchId) ?? ''
        const matchesSearch = query
          ? `${employee.name} ${employee.email} ${employee.phone ?? ''} ${branchName}`.toLowerCase().includes(query)
          : true
        const matchesStatus =
          status === 'active' ? employee.is_active : status === 'inactive' ? !employee.is_active : true
        const matchesBranch = branchFilter ? branchId === branchFilter : true

        return matchesSearch && matchesStatus && matchesBranch
      })
      .map<EmployeeExportRow>((employee) => {
        const branchId = roleMap.get(employee.id) ?? ''

        return {
          Name: employee.name,
          Email: employee.email,
          Phone: employee.phone ?? '',
          Branch: branchMap.get(branchId) ?? '',
          Transactions: countMap.get(employee.id) ?? 0,
          Status: employee.is_active ? 'Active' : 'Inactive',
          Created: new Date(employee.created_at).toISOString(),
        }
      })

    const buffer = await buildWorkbookBuffer<EmployeeExportRow>({
      sheetName: 'Employees',
      columns: [
        { header: 'Name', key: 'Name' },
        { header: 'Email', key: 'Email' },
        { header: 'Phone', key: 'Phone' },
        { header: 'Branch', key: 'Branch' },
        { header: 'Transactions', key: 'Transactions', numFmt: '#,##0' },
        { header: 'Status', key: 'Status' },
        { header: 'Created', key: 'Created', numFmt: 'yyyy-mm-dd' },
      ],
      rows,
    })

    return workbookDownloadResponse(buffer, 'retivox-employees.xlsx')
  } catch (error: unknown) {
    logger.error('Employees export failed', { businessId, error })
    return new Response('Unable to export employees', { status: 500 })
  }
}
