/**
 * XLSX export route for owner admins.
 *
 * Downloads admin rows with assigned branches and optional search/status/branch
 * filters matching the dashboard view.
 */

import { GlobalRole } from '@smartretail/shared'
import { requireRole } from '../../../../../lib/auth/helpers'
import { createClient } from '../../../../../lib/supabase/server'
import logger from '../../../../../lib/logger'
import { buildWorkbookBuffer, workbookDownloadResponse } from '../../../../../lib/spreadsheets/workbooks'

type AdminExportRow = {
  Name: string
  Email: string
  Phone: string
  'Assigned Branches': string
  Status: string
  Created: string
}

const MAX_EXPORT_ROWS = 1000

/**
 * Handles admin spreadsheet downloads.
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

    const [usersResponse, branchesResponse, rolesResponse] = await Promise.all([
      supabase
        .from('users')
        .select('id, name, email, phone, is_active, created_at', { count: 'exact' })
        .eq('business_id', businessId)
        .eq('global_role', 'admin')
        .is('deleted_at', null)
        .order('created_at', { ascending: true })
        .limit(MAX_EXPORT_ROWS + 1),
      supabase.from('branches').select('id, name', { count: 'exact' }).eq('business_id', businessId).is('deleted_at', null).limit(MAX_EXPORT_ROWS + 1),
      supabase
        .from('user_branch_roles')
        .select('user_id, branch_id', { count: 'exact' })
        .eq('business_id', businessId)
        .eq('role', 'admin')
        .limit(MAX_EXPORT_ROWS + 1),
    ])

    if (usersResponse.error) throw usersResponse.error
    if (branchesResponse.error) throw branchesResponse.error
    if (rolesResponse.error) throw rolesResponse.error
    if ([usersResponse.count, branchesResponse.count, rolesResponse.count].some((count) => (count ?? 0) > MAX_EXPORT_ROWS)) {
      return new Response(`Refine the filters to export no more than ${MAX_EXPORT_ROWS} records.`, { status: 413 })
    }

    const branchMap = new Map(((branchesResponse.data ?? []) as Array<{ id: string; name: string }>).map((branch) => [branch.id, branch.name]))
    const roleRows = (rolesResponse.data ?? []) as Array<{ user_id: string; branch_id: string }>
    const branchIdsByUser = new Map<string, string[]>()
    roleRows.forEach((role) => {
      const branchIds = branchIdsByUser.get(role.user_id) ?? []
      branchIds.push(role.branch_id)
      branchIdsByUser.set(role.user_id, branchIds)
    })

    const rows = ((usersResponse.data ?? []) as Array<{
      id: string
      name: string
      email: string
      phone: string | null
      is_active: boolean
      created_at: string
    }>)
      .map((admin) => {
        const assignedBranchIds = branchIdsByUser.get(admin.id) ?? []
        const assignedBranchNames = assignedBranchIds.map((branchId) => branchMap.get(branchId)).filter((name): name is string => Boolean(name))

        return {
          admin,
          assignedBranchIds,
          assignedBranchNames,
        }
      })
      .filter(({ admin, assignedBranchIds, assignedBranchNames }) => {
        const matchesSearch = query
          ? `${admin.name} ${admin.email} ${admin.phone ?? ''} ${assignedBranchNames.join(' ')}`.toLowerCase().includes(query)
          : true
        const matchesStatus = status === 'active' ? admin.is_active : status === 'inactive' ? !admin.is_active : true
        const matchesBranch = branchFilter ? assignedBranchIds.includes(branchFilter) : true

        return matchesSearch && matchesStatus && matchesBranch
      })
      .map<AdminExportRow>(({ admin, assignedBranchNames }) => ({
        Name: admin.name,
        Email: admin.email,
        Phone: admin.phone ?? '',
        'Assigned Branches': assignedBranchNames.join(', '),
        Status: admin.is_active ? 'Active' : 'Inactive',
        Created: new Date(admin.created_at).toISOString(),
      }))

    const buffer = await buildWorkbookBuffer<AdminExportRow>({
      sheetName: 'Admins',
      columns: [
        { header: 'Name', key: 'Name' },
        { header: 'Email', key: 'Email' },
        { header: 'Phone', key: 'Phone' },
        { header: 'Assigned Branches', key: 'Assigned Branches' },
        { header: 'Status', key: 'Status' },
        { header: 'Created', key: 'Created', numFmt: 'yyyy-mm-dd' },
      ],
      rows,
    })

    return workbookDownloadResponse(buffer, 'retivox-admins.xlsx')
  } catch (error: unknown) {
    logger.error('Admins export failed', { businessId, error })
    return new Response('Unable to export admins', { status: 500 })
  }
}
