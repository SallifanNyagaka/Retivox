'use client'
/**
 * Owner review UI for employee damage reports.
 */

import { useState } from 'react'
import Modal from '../../../../components/ui/Modal'
import { Card, CardHeader } from '../../../../components/ui/Card'
import {
  approveEmployeeDamageReport,
  rejectEmployeeDamageReport,
  updateEmployeeDamageReport,
} from './actions'

export type PendingEmployeeDamageReportRow = {
  report_id: string
  branch_id: string
  branch_name: string
  product_id: string
  product_name: string
  sku: string | null
  uom_id: string
  uom_name: string
  reported_by: string
  reporter_name: string | null
  quantity_in_uom: number | string
  base_quantity: number | string
  loss_type: string
  reason: string
  suggested_recovery_sale_price_per_base_unit: number | string | null
  created_at: string
}

type Props = {
  rows: PendingEmployeeDamageReportRow[]
  currency: string
}

const inputStyle = {
  width: '100%',
  height: 42,
  border: '1px solid var(--color-border)',
  borderRadius: 8,
  padding: '0 12px',
  backgroundColor: 'var(--color-background)',
  color: 'var(--color-text-primary)',
  boxSizing: 'border-box',
  fontSize: 13,
} as const

function toNumber(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function formatQuantity(value: number | string | null | undefined) {
  return toNumber(value).toLocaleString(undefined, { maximumFractionDigits: 4 })
}

function formatLossType(value: string) {
  return value.replace(/_/g, ' ')
}

export default function PendingEmployeeDamageReportsTable({ rows }: Props) {
  const [reviewingReport, setReviewingReport] = useState<PendingEmployeeDamageReportRow | null>(null)
  const recoveryPrice = toNumber(reviewingReport?.suggested_recovery_sale_price_per_base_unit)

  return (
    <>
      <Card padding="md">
        <CardHeader title="Employee damage reports" />
        {rows.length === 0 ? (
          <p style={{ margin: 0, fontSize: 14, color: 'var(--color-text-muted)' }}>No pending employee damage reports.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                  {['Date', 'Product', 'Store / employee', 'Qty', 'Type', 'Action'].map((heading) => (
                    <th key={heading} style={{ padding: 12, textAlign: 'left', color: 'var(--color-text-muted)' }}>{heading}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.report_id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <td style={{ padding: 12, color: 'var(--color-text-primary)', whiteSpace: 'nowrap' }}>{new Date(row.created_at).toLocaleDateString()}</td>
                    <td style={{ padding: 12, color: 'var(--color-text-primary)', fontWeight: 600 }}>
                      {row.product_name}
                      {row.sku && <span style={{ display: 'block', marginTop: 3, color: 'var(--color-text-muted)', fontSize: 12 }}>{row.sku}</span>}
                      <span style={{ display: 'block', marginTop: 3, color: 'var(--color-text-muted)', fontSize: 12 }}>{row.reason}</span>
                    </td>
                    <td style={{ padding: 12, color: 'var(--color-text-muted)' }}>
                      {row.branch_name}
                      <span style={{ display: 'block', marginTop: 3 }}>{row.reporter_name ?? 'Unknown employee'}</span>
                    </td>
                    <td style={{ padding: 12, color: 'var(--color-text-primary)', whiteSpace: 'nowrap' }}>
                      {formatQuantity(row.quantity_in_uom)} {row.uom_name}
                      <span style={{ display: 'block', marginTop: 3, color: 'var(--color-text-muted)', fontSize: 12 }}>
                        {formatQuantity(row.base_quantity)} individual
                      </span>
                    </td>
                    <td style={{ padding: 12, color: 'var(--color-text-muted)', textTransform: 'capitalize' }}>
                      {formatLossType(row.loss_type)}
                    </td>
                    <td style={{ padding: 12 }}>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="btn-primary"
                          style={{ padding: '6px 12px', borderRadius: 8 }}
                          onClick={() => setReviewingReport(row)}
                        >
                          Edit / approve
                        </button>
                        <form action={rejectEmployeeDamageReport}>
                          <input type="hidden" name="reportId" value={row.report_id} />
                          <button type="submit" className="btn-outline" style={{ padding: '6px 12px', borderRadius: 8 }}>
                            Reject
                          </button>
                        </form>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        isOpen={Boolean(reviewingReport)}
        title="Record damaged, spoiled, or lost stock"
        onClose={() => setReviewingReport(null)}
      >
        {reviewingReport && (
          <form className="flex flex-col gap-3">
            <input type="hidden" name="reportId" value={reviewingReport.report_id} />

            <p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: 13, lineHeight: 1.5 }}>
              Reported by {reviewingReport.reporter_name ?? 'Unknown employee'} on {new Date(reviewingReport.created_at).toLocaleDateString()}.
              Correct any mistake before approving.
            </p>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-2 text-left" style={{ fontSize: 13, color: 'var(--color-text-primary)' }}>
                Branch
                <input value={reviewingReport.branch_name} disabled style={{ ...inputStyle, opacity: 0.8 }} />
              </label>

              <label className="flex flex-col gap-2 text-left" style={{ fontSize: 13, color: 'var(--color-text-primary)' }}>
                Product
                <input
                  value={`${reviewingReport.product_name}${reviewingReport.sku ? ` - ${reviewingReport.sku}` : ''}`}
                  disabled
                  style={{ ...inputStyle, opacity: 0.8 }}
                />
              </label>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-2 text-left" style={{ fontSize: 13, color: 'var(--color-text-primary)' }}>
                Individual unit from product setup
                <input value={reviewingReport.uom_name} disabled style={{ ...inputStyle, opacity: 0.8 }} />
              </label>

              <label className="flex flex-col gap-2 text-left" style={{ fontSize: 13, color: 'var(--color-text-primary)' }}>
                Quantity affected
                <input
                  name="quantity"
                  type="number"
                  min="0.0001"
                  step="0.0001"
                  defaultValue={String(reviewingReport.quantity_in_uom)}
                  required
                  style={inputStyle}
                />
              </label>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-2 text-left" style={{ fontSize: 13, color: 'var(--color-text-primary)' }}>
                Loss type
                <select name="lossType" defaultValue={reviewingReport.loss_type} required style={inputStyle}>
                  <option value="breakage">Breakage</option>
                  <option value="spoilage">Spoilage</option>
                  <option value="theft">Theft</option>
                  <option value="markdown_damage">Damaged markdown</option>
                  <option value="other">Other</option>
                </select>
              </label>
            </div>

            <label className="flex flex-col gap-2 text-left" style={{ fontSize: 13, color: 'var(--color-text-primary)' }}>
              Recovery selling price per individual unit
              <input
                name="recoverySalePrice"
                type="number"
                min="0"
                step="0.01"
                defaultValue={recoveryPrice > 0 ? String(recoveryPrice) : ''}
                placeholder="Optional, e.g. sell each cracked egg at 10"
                style={inputStyle}
              />
              <span style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>
                If set, approved damaged stock appears in the employee sale form at this recovery price.
              </span>
            </label>

            <label className="flex flex-col gap-2 text-left" style={{ fontSize: 13, color: 'var(--color-text-primary)' }}>
              Reason
              <input
                name="reason"
                defaultValue={reviewingReport.reason}
                required
                maxLength={240}
                placeholder="e.g. 12 eggs cracked during unloading"
                style={inputStyle}
              />
            </label>

            <label className="flex flex-col gap-2 text-left" style={{ fontSize: 13, color: 'var(--color-text-primary)' }}>
              Review note optional
              <input name="reviewNote" placeholder="e.g. corrected from 12 to 10 eggs" maxLength={180} style={inputStyle} />
            </label>

            <p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: 12, lineHeight: 1.5 }}>
              Current report: {formatQuantity(reviewingReport.quantity_in_uom)} {reviewingReport.uom_name} equals {formatQuantity(reviewingReport.base_quantity)} individual units.
              Save changes if the employee made a mistake. Approve will deduct normal stock and create sellable damaged stock if recovery price is set.
            </p>

            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="submit"
                formAction={updateEmployeeDamageReport}
                className="btn-outline"
                style={{ padding: '8px 16px', borderRadius: 8 }}
              >
                Save changes
              </button>
              <button
                type="submit"
                formAction={approveEmployeeDamageReport}
                className="btn-primary"
                style={{ padding: '8px 16px', borderRadius: 8 }}
              >
                Approve
              </button>
            </div>
          </form>
        )}
      </Modal>
    </>
  )
}
