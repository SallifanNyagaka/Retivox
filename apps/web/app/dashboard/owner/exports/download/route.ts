import ExcelJS from 'exceljs'
import { GlobalRole } from '@smartretail/shared'
import { requireRole } from '../../../../../lib/auth/helpers'
import { createClient } from '../../../../../lib/supabase/server'
import { createServiceRoleClient } from '../../../../../lib/supabase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type ExportRow = Record<string, string | number | boolean | null>
type Scope = 'transactions' | 'transaction-items' | 'transaction-lot-allocations' | 'product-catalog' | 'products' | 'inventory-lots' | 'lot-stock' | 'uoms' | 'product-uoms' | 'customers' | 'branches' | 'employees' | 'team-assignments' | 'suppliers' | 'deliveries' | 'delivery-items' | 'payments' | 'receivables' | 'expenses' | 'recurring-expenses' | 'recurring-expense-templates' | 'cash-deposits' | 'cash-deposit-reviews' | 'refunds' | 'stock-movements' | 'stock-transfer-items'

const scopes: Scope[] = ['transactions', 'transaction-items', 'transaction-lot-allocations', 'product-catalog', 'products', 'inventory-lots', 'lot-stock', 'uoms', 'product-uoms', 'customers', 'branches', 'employees', 'team-assignments', 'suppliers', 'deliveries', 'delivery-items', 'payments', 'receivables', 'expenses', 'recurring-expenses', 'recurring-expense-templates', 'cash-deposits', 'cash-deposit-reviews', 'refunds', 'stock-movements', 'stock-transfer-items']
const scopeLabels: Record<Scope, string> = {
  transactions: 'Transactions', 'transaction-items': 'Transaction line items', 'transaction-lot-allocations': 'Transaction batch allocations', 'product-catalog': 'Product catalog', products: 'Product stock', 'inventory-lots': 'Inventory lots', 'lot-stock': 'Batch stock by store', uoms: 'Units of measure', 'product-uoms': 'Product UOM mappings', customers: 'Customers', branches: 'Stores', employees: 'Employees', 'team-assignments': 'Store team assignments',
  suppliers: 'Suppliers', deliveries: 'Supplier deliveries', 'delivery-items': 'Supplier delivery line items', payments: 'Sales payments', receivables: 'Credit balances',
  expenses: 'Expenses', 'recurring-expenses': 'Recurring expense entries', 'recurring-expense-templates': 'Recurring expense templates', 'cash-deposits': 'Cash deposits', 'cash-deposit-reviews': 'Cash deposit review history', refunds: 'Refunds', 'stock-movements': 'Stock transfers', 'stock-transfer-items': 'Stock transfer line items',
}

function escapePdfText(value: string) {
  return value.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)')
}

function printable(value: unknown) {
  return String(value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7E]/g, '?')
}

function createPdf(scope: Scope, rows: ExportRow[], columns: string[]) {
  const lines = [`RETIVOX BUSINESS EXPORT  |  ${scopeLabels[scope].toUpperCase()}`, `Generated: ${new Date().toISOString()}  |  Records: ${rows.length}`, '']
  for (const [index, row] of rows.entries()) {
    const record = `${index + 1}. ${columns.map((column) => `${column}=${printable(row[column])}`).join(' | ')}`
    for (let offset = 0; offset < record.length; offset += 112) lines.push(record.slice(offset, offset + 112))
    lines.push('')
  }
  if (rows.length === 0) lines.push('No records were available for this export.')

  const pages: string[][] = []
  for (let i = 0; i < lines.length; i += 66) pages.push(lines.slice(i, i + 66))
  const objects: string[] = []
  const pageIds = pages.map((_, i) => 4 + i * 2)
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>'
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>'
  pages.forEach((page, index) => {
    const pageId = pageIds[index]
    const streamId = pageId + 1
    const text = `BT\n/F1 7 Tf\n32 806 Td\n10 TL\n${page.map((line) => `(${escapePdfText(line)}) Tj\nT*`).join('\n')}\nET`
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${streamId} 0 R >>`
    objects[streamId] = `<< /Length ${Buffer.byteLength(text, 'ascii')} >>\nstream\n${text}\nendstream`
  })
  let document = '%PDF-1.4\n'
  const offsets = [0]
  for (let i = 1; i < objects.length; i++) {
    offsets[i] = Buffer.byteLength(document, 'ascii')
    document += `${i} 0 obj\n${objects[i]}\nendobj\n`
  }
  const xrefOffset = Buffer.byteLength(document, 'ascii')
  document += `xref\n0 ${objects.length}\n0000000000 65535 f \n`
  for (let i = 1; i < objects.length; i++) document += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
  document += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`
  return Buffer.from(document, 'ascii')
}

const exportQuery: Record<Scope, { table: string; columns: string; order: string }> = {
  transactions: { table: 'transactions', columns: 'id,receipt_number,recorded_at,status,subtotal,discount_amount,total_amount,origin,branch_id,employee_id,customer_id,is_credit_sale,sync_status', order: 'recorded_at' },
  'transaction-items': { table: 'transaction_items', columns: 'id,transaction_id,product_id,quantity,unit_price_at_sale,line_total,stock_status,uom_id,quantity_in_uom,base_quantity,unit_cost_at_sale,line_cost,line_discount_amount,net_line_total,gross_profit', order: 'transaction_id' },
  'transaction-lot-allocations': { table: 'transaction_item_lot_allocations', columns: 'id,transaction_item_id,lot_id,base_quantity,created_at', order: 'created_at' },
  'product-catalog': { table: 'products', columns: 'id,name,sku,category,unit,description,is_active,created_at,deleted_at,delete_reason,product_kind,subcategory,brand_family,tracks_expiry', order: 'name' },
  products: { table: 'branch_stock', columns: 'branch_id,product_id,quantity_on_hand,quantity_reserved,low_stock_threshold,base_quantity_on_hand,base_quantity_reserved,average_base_unit_cost,products(name,sku)', order: 'branch_id' },
  'inventory-lots': { table: 'inventory_lots', columns: 'id,product_id,supplier_lot_code,received_at,expires_on,is_untracked_legacy,source_delivery_item_id,created_at', order: 'received_at' },
  'lot-stock': { table: 'branch_lot_stock', columns: 'id,branch_id,product_id,lot_id,base_quantity_on_hand,base_quantity_reserved,updated_at', order: 'updated_at' },
  uoms: { table: 'units_of_measure', columns: 'id,name,abbreviation,conversion_factor,is_base_unit,is_active,created_at', order: 'name' },
  'product-uoms': { table: 'product_uom_links', columns: 'id,product_id,uom_id,is_base_uom,is_default_purchase_uom,is_default_sale_uom,is_purchase_uom,is_sale_uom,created_at', order: 'product_id' },
  customers: { table: 'customers', columns: 'id,name,phone,email,total_visits,total_spent,first_purchase_at,last_purchase_at', order: 'name' },
  branches: { table: 'branches', columns: 'id,name,location,branch_type,is_active,created_at,deleted_at,delete_reason', order: 'name' },
  employees: { table: 'users', columns: 'id,name,email,phone,global_role,is_active,last_login_at,created_at,deleted_at,delete_reason', order: 'name' },
  'team-assignments': { table: 'user_branch_roles', columns: 'id,user_id,branch_id,role,assigned_by,assigned_at,is_active,deactivated_at,deactivated_by', order: 'assigned_at' },
  suppliers: { table: 'suppliers', columns: 'id,name,phone,email,contact_person,notes,is_active,created_at,updated_at', order: 'name' },
  deliveries: { table: 'supplier_deliveries', columns: 'id,to_branch_id,supplier_id,supplier_name,supplier_reference_number,reference_code,status,delivered_at,recorded_at,approved_at,supplier_price_rating,supplier_stock_quality_rating,supplier_availability_rating,supplier_rating_note', order: 'recorded_at' },
  'delivery-items': { table: 'supplier_delivery_items', columns: 'id,delivery_id,product_id,quantity_expected,quantity_received,quantity_discrepancy,unit_cost,notes,uom_id,quantity_in_uom,base_quantity_expected,base_quantity_received,base_unit_cost,total_cost,expires_on,supplier_lot_code,inventory_lot_id,line_number', order: 'delivery_id' },
  payments: { table: 'payments', columns: 'id,transaction_id,payment_method,amount,status,mpesa_ref_code,reference_code,provider,provider_transaction_id,reconciliation_status,payment_at,verified_at,refunded_amount', order: 'payment_at' },
  receivables: { table: 'receivable_account_balances', columns: 'id,branch_id,transaction_id,customer_id,due_date,created_at,customer_name,customer_phone,customer_email,branch_name,total_amount,amount_paid,balance_due,account_status', order: 'due_date' },
  expenses: { table: 'finance_expenses', columns: 'id,branch_id,category,description,amount,incurred_on,created_by,created_at', order: 'incurred_on' },
  'recurring-expenses': { table: 'finance_recurring_expense_instances', columns: 'id,template_id,branch_id,category,description,amount,period_start,period_end,due_on,status,finance_expense_id,created_by,confirmed_by,confirmed_at,skipped_by,skipped_at,created_at,updated_at', order: 'due_on' },
  'recurring-expense-templates': { table: 'finance_recurring_expense_templates', columns: 'id,branch_id,category,description,default_amount,frequency,due_day,is_active,created_by,updated_by,created_at,updated_at', order: 'created_at' },
  'cash-deposits': { table: 'branch_cash_deposits', columns: 'id,branch_id,deposited_by,verified_by,deposit_date,amount,expected_cash_amount,variance_amount,deposit_reference,note,review_note,status,verified_at,created_at,submitted_role,admin_approved_by,admin_approved_at', order: 'created_at' },
  'cash-deposit-reviews': { table: 'branch_cash_deposit_reviews', columns: 'id,local_id,deposit_id,actor_id,action,created_at', order: 'created_at' },
  refunds: { table: 'payment_refund_requests', columns: 'id,transaction_id,payment_id,requested_by,amount,reason,status,provider_refund_id,reviewed_by,reviewed_at,review_note,created_at,provider_submission_at,provider_submission_message', order: 'created_at' },
  'stock-movements': { table: 'stock_transfers', columns: 'id,from_branch_id,to_branch_id,initiated_by,received_by,status,notes,initiated_at,received_at', order: 'initiated_at' },
  'stock-transfer-items': { table: 'stock_transfer_items', columns: 'id,transfer_id,product_id,quantity_sent,quantity_received,quantity_discrepancy,discrepancy_notes,uom_id,quantity_in_uom,base_quantity_sent,base_quantity_received', order: 'transfer_id' },
}

export async function GET(request: Request) {
  const profile = await requireRole([GlobalRole.Owner])
  if (!profile.business_id) return new Response('Business account is unavailable.', { status: 403 })
  const url = new URL(request.url)
  const requestedScope = url.searchParams.get('scope') as Scope | null
  if (requestedScope && !scopes.includes(requestedScope)) return new Response('Unknown export scope.', { status: 400 })
  const scope: Scope = requestedScope ?? 'transactions'
  const requestedFormat = url.searchParams.get('format')
  if (requestedFormat && !['csv', 'xlsx', 'pdf'].includes(requestedFormat)) return new Response('Unsupported export format.', { status: 400 })
  const format = (requestedFormat ?? 'csv') as 'csv' | 'xlsx' | 'pdf'
  const supabase = await createClient()
  const query = exportQuery[scope]
  const rows: ExportRow[] = []

  for (let offset = 0; offset < 100000; offset += 1000) {
    const { data, error } = await supabase.from(query.table)
      .select(query.columns)
      .eq('business_id', profile.business_id)
      .order(query.order, { ascending: false, nullsFirst: false })
      .order('id', { ascending: true })
      .range(offset, offset + 999)
    if (error) return new Response(`Unable to export ${scopeLabels[scope].toLowerCase()} records.`, { status: 500 })
    if (scope === 'products') {
      const stockRows = (data ?? []) as unknown as Array<Record<string, unknown>>
      rows.push(...stockRows.map((row) => {
        const productValue = row.products
        const product = Array.isArray(productValue) ? productValue[0] as Record<string, unknown> | undefined : productValue as Record<string, unknown> | null
        return { branch_id: String(row.branch_id ?? ''), product_id: String(row.product_id ?? ''), product_name: String(product?.name ?? ''), sku: String(product?.sku ?? ''), quantity_on_hand: Number(row.quantity_on_hand ?? 0), quantity_reserved: Number(row.quantity_reserved ?? 0), low_stock_threshold: Number(row.low_stock_threshold ?? 0), base_quantity_on_hand: Number(row.base_quantity_on_hand ?? 0), base_quantity_reserved: Number(row.base_quantity_reserved ?? 0), average_base_unit_cost: Number(row.average_base_unit_cost ?? 0) }
      }))
    } else rows.push(...((data ?? []) as unknown as ExportRow[]))
    if (!data || data.length < 1000) break
  }
  if (rows.length === 100000) {
    const { data: overflow, error: overflowError } = await supabase.from(query.table)
      .select('id').eq('business_id', profile.business_id).order('id').range(100000, 100000)
    if (overflowError) return new Response('Unable to verify the export record limit.', { status: 500 })
    if (overflow?.length) return new Response('This export exceeds the 100,000-record limit. Narrow the data scope or contact support for a larger export.', { status: 413 })
  }

  const admin = createServiceRoleClient()
  const { error: auditError } = await admin.from('business_export_events').insert({
    business_id: profile.business_id, actor_user_id: profile.id, export_type: format, data_scope: scope, row_count: rows.length,
  })
  if (auditError) return new Response('Export could not be audited, so it was not generated.', { status: 500 })

  const filename = `retivox-${scope}-${new Date().toISOString().slice(0, 10)}`
  if (format === 'xlsx') {
    const workbook = new ExcelJS.Workbook()
    workbook.creator = 'Retivox'
    const sheet = workbook.addWorksheet(scopeLabels[scope].slice(0, 31))
    const columns = rows.length ? Object.keys(rows[0]) : query.columns.split(',').map((key) => key.trim()).filter((key) => !key.includes('('))
    sheet.columns = columns.map((key) => ({ header: key.replaceAll('_', ' '), key, width: Math.min(32, Math.max(14, key.length + 4)) }))
    sheet.addRows(rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, typeof value === 'string' && /^[\t\r\n ]*[=+\-@]/.test(value) ? `'${value}` : value]))))
    sheet.getRow(1).font = { bold: true }
    const buffer = await workbook.xlsx.writeBuffer()
    return new Response(buffer, { headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${filename}.xlsx"`, 'Cache-Control': 'no-store' } })
  }

  const columns = rows.length ? Object.keys(rows[0]) : query.columns.split(',').map((key) => key.trim()).filter((key) => !key.includes('('))
  if (format === 'pdf') {
    const buffer = createPdf(scope, rows, columns)
    return new Response(new Uint8Array(buffer), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${filename}.pdf"`, 'Cache-Control': 'no-store' } })
  }
  const escape = (value: unknown) => {
    const raw = typeof value === 'string' && /^[\t\r\n ]*[=+\-@]/.test(value) ? `'${value}` : String(value ?? '')
    return `"${raw.replaceAll('"', '""')}"`
  }
  const csv = [columns.map(escape).join(','), ...rows.map((row) => columns.map((key) => escape(row[key])).join(','))].join('\r\n')
  return new Response(`\uFEFF${csv}`, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${filename}.csv"`, 'Cache-Control': 'no-store' } })
}
