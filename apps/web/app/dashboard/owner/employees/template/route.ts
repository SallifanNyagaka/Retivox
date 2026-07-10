/**
 * XLSX template route for bulk employee imports.
 *
 * Provides the required account and branch assignment headers.
 */

import { GlobalRole } from '@smartretail/shared'
import { requireRole } from '../../../../../lib/auth/helpers'
import { buildWorkbookBuffer, workbookDownloadResponse } from '../../../../../lib/spreadsheets/workbooks'

type EmployeeTemplateRow = {
  Name: string
  Email: string
  Phone: string
  'Temporary Password': string
  Branch: string
}

/**
 * Handles employee import template downloads.
 */
export async function GET() {
  await requireRole([GlobalRole.Owner])

  const buffer = await buildWorkbookBuffer<EmployeeTemplateRow>({
    sheetName: 'Employee Import Template',
    columns: [
      { header: 'Name', key: 'Name' },
      { header: 'Email', key: 'Email' },
      { header: 'Phone', key: 'Phone' },
      { header: 'Temporary Password', key: 'Temporary Password' },
      { header: 'Branch', key: 'Branch' },
    ],
    rows: [
      {
        Name: 'Jane Employee',
        Email: 'jane.employee@example.com',
        Phone: '+254700000000',
        'Temporary Password': 'ChangeMe123!',
        Branch: 'Main Store',
      },
    ],
  })

  return workbookDownloadResponse(buffer, 'retivox-employee-import-template.xlsx')
}
