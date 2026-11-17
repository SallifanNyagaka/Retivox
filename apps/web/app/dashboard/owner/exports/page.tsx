import { GlobalRole } from '@smartretail/shared'
import { Card, CardHeader } from '../../../../components/ui/Card'
import { requireRole } from '../../../../lib/auth/helpers'

export const dynamic = 'force-dynamic'

const exportScopes = [
  ['transactions', 'Transactions', 'Sales, totals, status, branch, employee, customer link and offline sync status.'],
  ['transaction-items', 'Transaction line items', 'Products, quantities, prices, discounts and cost/profit snapshots for each sale.'],
  ['transaction-lot-allocations', 'Transaction batch allocations', 'Which inventory lots were consumed by each sale, supporting traceability and recalls.'],
  ['product-catalog', 'Product catalog', 'Product identities, descriptions, SKUs/barcodes, categories, status and expiry tracking setting.'],
  ['products', 'Product stock', 'Current stock by store, including reserved quantity, reorder threshold and cost.'],
  ['inventory-lots', 'Inventory lots', 'Received batch identifiers and expiry dates, including legacy lot tracking status.'],
  ['lot-stock', 'Batch stock by store', 'Remaining and reserved quantities for each product lot in each store.'],
  ['uoms', 'Units of measure', 'Business unit names, abbreviations and conversion factors.'],
  ['product-uoms', 'Product UOM mappings', 'Purchase and sale units assigned to each product, including defaults.'],
  ['customers', 'Customers', 'Customer contact details and purchase summary.'],
  ['branches', 'Stores', 'Store locations and active or archived status.'],
  ['employees', 'Employees and admins', 'Business team contact details and account status.'],
  ['team-assignments', 'Store team assignments', 'Employee/admin branch roles and assignment history.'],
  ['suppliers', 'Suppliers', 'Supplier contact details and active status.'],
  ['deliveries', 'Supplier deliveries', 'Delivery references, approval status, ratings and destination store.'],
  ['delivery-items', 'Delivery line items', 'Received and expected quantities, costs, lot codes and expiry dates.'],
  ['payments', 'Sales payments', 'Payment methods, amounts, provider references and reconciliation/refund status.'],
  ['receivables', 'Credit balances', 'Customer balances, due dates and account status.'],
  ['expenses', 'Expenses', 'Recorded business expenses and dates.'],
  ['recurring-expenses', 'Recurring expense entries', 'Recorded monthly expense entries, confirmation and skip status.'],
  ['recurring-expense-templates', 'Recurring expense templates', 'Recurring expense schedule and default amounts.'],
  ['cash-deposits', 'Cash deposits', 'Deposits, approval stages, variances and review notes.'],
  ['cash-deposit-reviews', 'Cash deposit review history', 'Who reviewed each deposit and when.'],
  ['refunds', 'Refund requests', 'Refund amounts, status, provider reference and review history.'],
  ['stock-movements', 'Stock transfers', 'Transfer headers between stores and receipt status.'],
  ['stock-transfer-items', 'Stock transfer line items', 'Sent/received quantities and discrepancies for each transfer.'],
] as const

export default async function OwnerExportsPage() {
  await requireRole([GlobalRole.Owner])
  return <div className="flex flex-col gap-5">
    <div><h1 style={{ margin: 0, fontSize: 25, fontWeight: 900, color: 'var(--color-text-primary)' }}>Business data export</h1><p style={{ margin: '6px 0 0', color: 'var(--color-text-muted)', fontSize: 14 }}>Export business records in CSV, Excel or PDF while records are retained. Exports are limited to your business, support up to 100,000 rows per dataset, and are recorded for audit.</p></div>
    <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
      {exportScopes.map(([scope, title, description]) => <Card key={scope} padding="md">
        <CardHeader title={title} />
        <p style={descriptionStyle}>{description}</p>
        <ExportLinks scope={scope} />
      </Card>)}
    </div>
    <p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: 12 }}>Exports include personal contact details where needed to preserve business records. Store downloaded files securely. Attachments and provider credentials are never exported.</p>
  </div>
}

function ExportLinks({ scope }: { scope: string }) {
  return <div className="flex flex-wrap gap-2"><a className="btn-primary" style={buttonStyle} href={`/dashboard/owner/exports/download?scope=${scope}&format=csv`}>Download CSV</a><a className="btn-outline" style={buttonStyle} href={`/dashboard/owner/exports/download?scope=${scope}&format=xlsx`}>Download Excel</a><a className="btn-outline" style={buttonStyle} href={`/dashboard/owner/exports/download?scope=${scope}&format=pdf`}>Download PDF</a></div>
}

const descriptionStyle = { margin: '0 0 14px', color: 'var(--color-text-muted)', fontSize: 13, minHeight: 38 }
const buttonStyle = { display: 'inline-flex', alignItems: 'center', textDecoration: 'none', borderRadius: 8, padding: '9px 13px', fontSize: 13, fontWeight: 750 }
