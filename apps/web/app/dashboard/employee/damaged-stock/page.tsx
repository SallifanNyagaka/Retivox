/**
 * Employee damaged stock reporting page.
 */

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Badge, type BadgeVariant } from '../../../../components/ui/Badge'
import { Card, CardHeader } from '../../../../components/ui/Card'
import { requireAuth } from '../../../../lib/auth/helpers'
import { getEmployeeProfile } from '../../../../lib/employee/auth'
import logger from '../../../../lib/logger'
import { createClient } from '../../../../lib/supabase/server'
import ReportDamagedStockForm, { type DamageReportProductOption } from './ReportDamagedStockForm'

type RawDamageProductRow = {
  product_id: string
  name: string
  sku: string | null
  category: string | null
  base_quantity_available: number
  uom_options?: Array<{
    id?: string
    name?: string
    abbreviation?: string
    conversionFactor?: number
    isBaseUnit?: boolean
    isBaseUom?: boolean
    isDefaultPurchaseUom?: boolean
    isDefaultSaleUom?: boolean
  }> | null
}

type EmployeeLossReportRow = {
  report_id: string
  product_name: string
  sku: string | null
  uom_name: string
  quantity_in_uom: number
  base_quantity: number
  loss_type: string
  reason: string
  status: 'pending' | 'approved' | 'rejected'
  review_note: string | null
  created_at: string
  reviewed_at: string | null
}

function mapProductOption(row: RawDamageProductRow): DamageReportProductOption {
  return {
    productId: row.product_id,
    name: row.name,
    sku: row.sku,
    category: row.category,
    baseQuantityAvailable: Number(row.base_quantity_available ?? 0),
    uomOptions: (row.uom_options ?? [])
      .map((option) => ({
        id: String(option.id ?? ''),
        name: String(option.name ?? 'Unit'),
        abbreviation: String(option.abbreviation ?? ''),
        conversionFactor: Number(option.conversionFactor ?? 1),
        isBaseUnit: Boolean(option.isBaseUnit),
        isBaseUom: Boolean(option.isBaseUom),
        isDefaultPurchaseUom: Boolean(option.isDefaultPurchaseUom),
        isDefaultSaleUom: Boolean(option.isDefaultSaleUom),
      }))
      .filter((option) => (
        option.id.length > 0
        && option.conversionFactor > 0
        && (option.isBaseUom || option.isBaseUnit || option.conversionFactor === 1)
      )),
  }
}

function formatDateTime(isoDate: string) {
  return new Date(isoDate).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatQuantity(value: number) {
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: 4 })
}

function getStatusVariant(status: EmployeeLossReportRow['status']): BadgeVariant {
  if (status === 'approved') return 'success'
  if (status === 'rejected') return 'danger'
  return 'warning'
}

function getLossTypeLabel(lossType: string) {
  return lossType
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

export default async function EmployeeDamagedStockPage() {
  const user = await requireAuth()
  const employeeProfile = await getEmployeeProfile(user.id)

  if (!employeeProfile) {
    redirect('/unauthorized')
  }

  if (!employeeProfile.isActive) {
    redirect('/account/deactivated')
  }

  if (!employeeProfile.branchId) {
    redirect('/dashboard/employee/unassigned')
  }

  let products: DamageReportProductOption[] = []
  let reports: EmployeeLossReportRow[] = []
  let pageError: string | null = null

  try {
    const supabase = await createClient()
    const [productsResponse, reportsResponse] = await Promise.all([
      supabase.rpc('employee_damage_report_products', {
        p_branch_id: employeeProfile.branchId,
      }),
      supabase.rpc('employee_my_inventory_loss_reports', {
        p_limit: 25,
      }),
    ])

    if (productsResponse.error) {
      throw productsResponse.error
    }

    if (reportsResponse.error) {
      throw reportsResponse.error
    }

    products = ((productsResponse.data ?? []) as RawDamageProductRow[]).map(mapProductOption).filter((product) => product.uomOptions.length > 0)
    reports = (reportsResponse.data ?? []) as EmployeeLossReportRow[]
  } catch (error: unknown) {
    logger.error('EmployeeDamagedStockPage data fetch failed', {
      userId: employeeProfile.id,
      branchId: employeeProfile.branchId,
      businessId: employeeProfile.businessId,
      error,
    })
    pageError = error instanceof Error ? error.message : 'Unable to load damaged stock reporting'
  }

  if (pageError) {
    return (
      <Card padding="md">
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-text-primary)', letterSpacing: '-0.3px' }}>
          Damaged stock
        </h1>
        <p style={{ fontSize: 14, color: 'var(--color-danger)', marginTop: 8 }}>
          Failed to load damaged stock reporting. Please refresh and try again.
        </p>
      </Card>
    )
  }

  return (
    <div className="mx-auto flex w-full flex-col gap-6">
      <div className="flex flex-col gap-3 text-center sm:flex-row sm:items-center sm:justify-between sm:text-left">
        <div>
          <h1 className="font-bold" style={{ fontSize: 22, color: 'var(--color-text-primary)', letterSpacing: '-0.3px' }}>
            Damaged stock
          </h1>
          <p style={{ fontSize: 14, color: 'var(--color-text-muted)', marginTop: 4 }}>
            Report damaged, spoiled, missing, or discounted stock at {employeeProfile.branchName}.
          </p>
        </div>
        <Link href="/dashboard/employee/transactions/new" className="btn-outline" style={{ padding: '8px 16px', borderRadius: 8 }}>
          Back to sales
        </Link>
      </div>

      <Card padding="md">
        <CardHeader title="Submit a damage report" />
        <p style={{ margin: '0 0 14px', color: 'var(--color-text-muted)', fontSize: 13, lineHeight: 1.5 }}>
          This does not remove stock immediately. Employees report damaged individual units; the owner reviews the report and decides whether any recovered stock can be sold at a reduced price.
        </p>
        <ReportDamagedStockForm products={products} />
      </Card>

      <Card padding="md">
        <CardHeader title="My recent damage reports" />
        {reports.length === 0 ? (
          <div style={{ padding: '28px 16px', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>
            No damaged stock reports yet.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderSpacing: 0, fontSize: 13 }}>
              <thead>
                <tr>
                  {['Date', 'Product', 'Qty', 'Type', 'Status'].map((heading) => (
                    <th key={heading} style={{ padding: 10, textAlign: 'left', color: 'var(--color-text-muted)', fontSize: 12 }}>
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {reports.map((report, index) => (
                  <tr key={report.report_id} style={{ backgroundColor: index % 2 === 0 ? 'var(--color-background)' : 'var(--color-surface)' }}>
                    <td style={{ padding: 10, color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
                      {formatDateTime(report.created_at)}
                    </td>
                    <td style={{ padding: 10, color: 'var(--color-text-primary)' }}>
                      <div style={{ fontWeight: 800 }}>{report.product_name}</div>
                      <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>{report.reason}</div>
                    </td>
                    <td style={{ padding: 10, color: 'var(--color-text-primary)', whiteSpace: 'nowrap' }}>
                      {formatQuantity(report.quantity_in_uom)} {report.uom_name}
                      <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>
                        {formatQuantity(report.base_quantity)} individual
                      </div>
                    </td>
                    <td style={{ padding: 10, color: 'var(--color-text-primary)', whiteSpace: 'nowrap' }}>
                      {getLossTypeLabel(report.loss_type)}
                    </td>
                    <td style={{ padding: 10, whiteSpace: 'nowrap' }}>
                      <Badge variant={getStatusVariant(report.status)}>{getLossTypeLabel(report.status)}</Badge>
                      {report.review_note && (
                        <div style={{ marginTop: 4, color: 'var(--color-text-muted)', fontSize: 12 }}>
                          {report.review_note}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
