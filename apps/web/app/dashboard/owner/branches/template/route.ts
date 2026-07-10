/**
 * XLSX template route for bulk branch imports.
 *
 * Provides the exact headers expected by the branch import action.
 */

import { GlobalRole } from '@smartretail/shared'
import { requireRole } from '../../../../../lib/auth/helpers'
import { buildWorkbookBuffer, workbookDownloadResponse } from '../../../../../lib/spreadsheets/workbooks'

type BranchTemplateRow = {
  Name: string
  Location: string
  'Branch Type': string
}

/**
 * Handles branch import template downloads.
 */
export async function GET() {
  await requireRole([GlobalRole.Owner])

  const buffer = await buildWorkbookBuffer<BranchTemplateRow>({
    sheetName: 'Branch Import Template',
    columns: [
      { header: 'Name', key: 'Name' },
      { header: 'Location', key: 'Location' },
      { header: 'Branch Type', key: 'Branch Type' },
    ],
    rows: [
      {
        Name: 'Main Store',
        Location: 'Nairobi CBD',
        'Branch Type': 'store',
      },
      {
        Name: 'Central Warehouse',
        Location: 'Industrial Area',
        'Branch Type': 'warehouse',
      },
    ],
  })

  return workbookDownloadResponse(buffer, 'retivox-branch-import-template.xlsx')
}
