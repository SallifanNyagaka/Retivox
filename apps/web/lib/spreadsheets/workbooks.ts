/**
 * Spreadsheet utilities for Retivox imports and exports.
 *
 * Builds styled XLSX workbooks with auto-fitted columns and parses uploaded
 * XLSX/CSV files into plain row objects for server-side validation.
 */

import ExcelJS from 'exceljs'

/**
 * A typed column definition used by export workbooks.
 */
export type SpreadsheetColumn<Row extends Record<string, string | number | boolean | null>> = {
  header: string
  key: keyof Row & string
  width?: number
  numFmt?: string
}

/**
 * A reusable dropdown list applied to a data-entry column.
 */
export type SpreadsheetDropdown<Row extends Record<string, string | number | boolean | null>> = {
  key: keyof Row & string
  values: string[]
  allowBlank?: boolean
  rows?: number
}

/**
 * A parsed spreadsheet row keyed by normalized header text.
 */
export type ParsedSpreadsheetRow = Record<string, string>

/**
 * Normalizes spreadsheet headers so imports are forgiving about case/spaces.
 */
export function normalizeSpreadsheetHeader(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

/**
 * Returns the first non-empty value found for a list of accepted header keys.
 */
export function getSpreadsheetValue(row: ParsedSpreadsheetRow, keys: string[]) {
  for (const key of keys) {
    const value = row[normalizeSpreadsheetHeader(key)]
    if (value) {
      return value.trim()
    }
  }

  return ''
}

/**
 * Creates a polished XLSX workbook as a Node buffer.
 */
export async function buildWorkbookBuffer<Row extends Record<string, string | number | boolean | null>>({
  sheetName,
  columns,
  rows,
  dropdowns = [],
}: {
  sheetName: string
  columns: SpreadsheetColumn<Row>[]
  rows: Row[]
  dropdowns?: SpreadsheetDropdown<Row>[]
}) {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Retivox'
  workbook.created = new Date()

  const worksheet = workbook.addWorksheet(sheetName, {
    views: [{ state: 'frozen', ySplit: 1 }],
  })

  worksheet.columns = columns.map((column) => ({
    header: column.header,
    key: column.key,
    width: column.width ?? column.header.length + 4,
    style: column.numFmt ? { numFmt: column.numFmt } : undefined,
  }))

  rows.forEach((row) => {
    worksheet.addRow(row)
  })

  if (dropdowns.length > 0) {
    const lookupWorksheet = workbook.addWorksheet('Dropdown Lists')
    lookupWorksheet.state = 'veryHidden'

    dropdowns.forEach((dropdown, dropdownIndex) => {
      const uniqueValues = Array.from(new Set(dropdown.values.map((value) => value.trim()).filter((value) => value.length > 0)))

      if (uniqueValues.length === 0) {
        return
      }

      const lookupColumn = lookupWorksheet.getColumn(dropdownIndex + 1)
      uniqueValues.forEach((value, valueIndex) => {
        lookupWorksheet.getCell(valueIndex + 1, dropdownIndex + 1).value = value
      })

      const targetColumnIndex = columns.findIndex((column) => column.key === dropdown.key) + 1

      if (targetColumnIndex <= 0) {
        return
      }

      const targetColumnLetter = worksheet.getColumn(targetColumnIndex).letter
      const lookupColumnLetter = lookupColumn.letter
      const lastDataRow = Math.max(rows.length + 1, dropdown.rows ?? 501)

      for (let rowNumber = 2; rowNumber <= lastDataRow; rowNumber += 1) {
        worksheet.getCell(`${targetColumnLetter}${rowNumber}`).dataValidation = {
          type: 'list',
          allowBlank: dropdown.allowBlank ?? true,
          formulae: [`'Dropdown Lists'!$${lookupColumnLetter}$1:$${lookupColumnLetter}$${uniqueValues.length}`],
          showErrorMessage: false,
          showInputMessage: true,
          promptTitle: 'Suggested values',
          prompt: 'Choose from the dropdown or type a new value.',
        }
      }
    })
  }

  const headerRow = worksheet.getRow(1)
  headerRow.height = 22
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1F6F5B' },
    }
    cell.alignment = { vertical: 'middle' }
    cell.border = {
      bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
    }
  })

  worksheet.eachRow((row, rowNumber) => {
    row.eachCell((cell) => {
      cell.alignment = { vertical: 'top', wrapText: true }
      cell.border = {
        bottom: { style: 'thin', color: { argb: rowNumber === 1 ? 'FFCBD5E1' : 'FFF1F5F9' } },
      }
    })
  })

  worksheet.columns.forEach((column) => {
    const header = String(column.header ?? '')
    let maxLength = header.length

    column.eachCell?.({ includeEmpty: false }, (cell) => {
      const value = cell.value
      const text = value === null || value === undefined ? '' : cell.text || String(value)
      maxLength = Math.max(maxLength, text.length)
    })

    column.width = Math.min(Math.max(maxLength + 3, 12), 44)
  })

  worksheet.autoFilter = {
    from: 'A1',
    to: `${worksheet.getColumn(columns.length).letter}1`,
  }

  const buffer = await workbook.xlsx.writeBuffer()
  return new Uint8Array(buffer)
}

/**
 * Parses an uploaded XLSX or CSV file into normalized row objects.
 */
export async function parseSpreadsheetFile(file: File) {
  const fileName = file.name.toLowerCase()
  const buffer = await file.arrayBuffer()

  if (fileName.endsWith('.csv')) {
    return parseCsv(new TextDecoder().decode(new Uint8Array(buffer)))
  }

  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer)
  const worksheet = workbook.worksheets[0]

  if (!worksheet) {
    return []
  }

  const headers: string[] = []
  const parsedRows: ParsedSpreadsheetRow[] = []

  worksheet.getRow(1).eachCell((cell, columnNumber) => {
    headers[columnNumber] = normalizeSpreadsheetHeader(cell.text)
  })

  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) {
      return
    }

    const parsedRow: ParsedSpreadsheetRow = {}
    let hasValue = false

    row.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
      const header = headers[columnNumber]
      if (!header) {
        return
      }

      const value = cell.text.trim()
      parsedRow[header] = value
      if (value) {
        hasValue = true
      }
    })

    if (hasValue) {
      parsedRows.push(parsedRow)
    }
  })

  return parsedRows
}

/**
 * Parses simple CSV uploads without pulling parsing into client code.
 */
function parseCsv(content: string) {
  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0)
  const [headerLine, ...dataLines] = lines

  if (!headerLine) {
    return []
  }

  const headers = splitCsvLine(headerLine).map(normalizeSpreadsheetHeader)

  return dataLines.map((line) => {
    const values = splitCsvLine(line)
    const row: ParsedSpreadsheetRow = {}

    headers.forEach((header, index) => {
      row[header] = values[index]?.trim() ?? ''
    })

    return row
  })
}

/**
 * Splits a CSV line while respecting quoted values.
 */
function splitCsvLine(line: string) {
  const cells: string[] = []
  let current = ''
  let quoted = false

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    const next = line[index + 1]

    if (char === '"' && next === '"') {
      current += '"'
      index += 1
      continue
    }

    if (char === '"') {
      quoted = !quoted
      continue
    }

    if (char === ',' && !quoted) {
      cells.push(current)
      current = ''
      continue
    }

    current += char
  }

  cells.push(current)
  return cells
}

/**
 * Builds a standard XLSX HTTP response.
 */
export function workbookDownloadResponse(buffer: Uint8Array, filename: string) {
  const body = new ArrayBuffer(buffer.byteLength)
  new Uint8Array(body).set(buffer)

  return new Response(body, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}
