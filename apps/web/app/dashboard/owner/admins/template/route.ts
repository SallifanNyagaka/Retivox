/**
 * XLSX template route for bulk admin imports.
 *
 * Provides account and semicolon-separated branch assignment headers.
 */

import { GlobalRole } from '@smartretail/shared'
import { requireRole } from '../../../../../lib/auth/helpers'
import { buildWorkbookBuffer, workbookDownloadResponse } from '../../../../../lib/spreadsheets/workbooks'

type AdminTemplateRow = {
  Name: string
  Email: string
  Phone: string
  'Temporary Password': string
  Branches: string
}

/**
 * Handles admin import template downloads.
 */
export async function GET() {
  await requireRole([GlobalRole.Owner])

  const buffer = await buildWorkbookBuffer<AdminTemplateRow>({
    sheetName: 'Admin Import Template',
    columns: [
      { header: 'Name', key: 'Name' },
      { header: 'Email', key: 'Email' },
      { header: 'Phone', key: 'Phone' },
      { header: 'Temporary Password', key: 'Temporary Password' },
      { header: 'Branches', key: 'Branches' },
    ],
    rows: [
      {
        Name: 'Jane Admin',
        Email: 'jane.admin@example.com',
        Phone: '+254700000000',
        'Temporary Password': 'ChangeMe123!',
        Branches: 'Main Store; Central Warehouse',
      },
    ],
  })

  return workbookDownloadResponse(buffer, 'retivox-admin-import-template.xlsx')
}
