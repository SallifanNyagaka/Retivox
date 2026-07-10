/**
 * XLSX export route for owner branches.
 *
 * Downloads branch records using optional query filters while keeping data
 * scoped to the current owner's business through authenticated Supabase.
 */

import { GlobalRole } from '@smartretail/shared'
import { requireRole } from '../../../../../lib/auth/helpers'
import { createClient } from '../../../../../lib/supabase/server'
import logger from '../../../../../lib/logger'
import { buildWorkbookBuffer, workbookDownloadResponse } from '../../../../../lib/spreadsheets/workbooks'

type BranchExportRow = {
  Name: string
  Location: string
  Type: string
  Status: string
  Created: string
}

/**
 * Handles branch spreadsheet downloads.
 */
export async function GET(request: Request) {
  const profile = await requireRole([GlobalRole.Owner])
  const businessId = profile.business_id

  if (!businessId) {
    throw new Error('Owner profile missing business ID')
  }

  try {
    const url = new URL(request.url)
    const status = url.searchParams.get('status')
    const type = url.searchParams.get('type')
    const query = (url.searchParams.get('q') ?? '').trim().toLowerCase()
    const supabase = await createClient()

    let branchQuery = supabase
      .from('branches')
      .select('name, location, branch_type, is_active, created_at')
      .eq('business_id', businessId)
      .is('deleted_at', null)
      .order('created_at', { ascending: true })

    if (status === 'active') {
      branchQuery = branchQuery.eq('is_active', true)
    }

    if (status === 'inactive') {
      branchQuery = branchQuery.eq('is_active', false)
    }

    if (type === 'store' || type === 'warehouse') {
      branchQuery = branchQuery.eq('branch_type', type)
    }

    const { data, error } = await branchQuery

    if (error) {
      throw error
    }

    const rows = ((data ?? []) as Array<{
      name: string
      location: string
      branch_type: string
      is_active: boolean
      created_at: string
    }>)
      .filter((branch) => {
        if (!query) {
          return true
        }

        return `${branch.name} ${branch.location} ${branch.branch_type}`.toLowerCase().includes(query)
      })
      .map<BranchExportRow>((branch) => ({
        Name: branch.name,
        Location: branch.location,
        Type: branch.branch_type,
        Status: branch.is_active ? 'Active' : 'Inactive',
        Created: new Date(branch.created_at).toISOString(),
      }))

    const buffer = await buildWorkbookBuffer<BranchExportRow>({
      sheetName: 'Branches',
      columns: [
        { header: 'Name', key: 'Name' },
        { header: 'Location', key: 'Location' },
        { header: 'Type', key: 'Type' },
        { header: 'Status', key: 'Status' },
        { header: 'Created', key: 'Created', numFmt: 'yyyy-mm-dd' },
      ],
      rows,
    })

    return workbookDownloadResponse(buffer, 'retivox-branches.xlsx')
  } catch (error: unknown) {
    logger.error('Branches export failed', { businessId, error })
    return new Response('Unable to export branches', { status: 500 })
  }
}
