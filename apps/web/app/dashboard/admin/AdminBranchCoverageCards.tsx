'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Badge } from '../../../components/ui/Badge'
import type { BranchInsight } from '../owner/branches/OwnerBranchCards'

type BranchRow = {
  id: string
  name: string
  location: string
  branch_type: string
  is_active: boolean
}

type Props = {
  branches: BranchRow[]
  insights: Record<string, BranchInsight>
  currency: string
}

function getBranchTypeVariant(branchType: string) {
  return branchType === 'warehouse' ? 'info' : 'success'
}

function formatMoney(amount: number, currency: string) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)
}

function formatNumber(value: number) {
  return value.toLocaleString(undefined, { maximumFractionDigits: 4 })
}

export default function AdminBranchCoverageCards({ branches, insights, currency }: Props) {
  const [selectedBranch, setSelectedBranch] = useState<BranchRow | null>(null)
  const selectedInsight = selectedBranch ? insights[selectedBranch.id] : null

  return (
    <>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {branches.map((branch) => {
          const insight = insights[branch.id]

          return (
            <div
              key={branch.id}
              role="button"
              tabIndex={0}
              className="cursor-pointer rounded-xl border transition-shadow duration-200 hover:shadow-card-hover"
              style={{
                borderColor: 'var(--color-border)',
                backgroundColor: 'var(--color-background)',
                padding: '16px',
              }}
              onClick={() => setSelectedBranch(branch)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  setSelectedBranch(branch)
                }
              }}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p style={{ fontSize: '15px', fontWeight: 600, color: 'var(--color-text-primary)', margin: 0 }}>
                    {branch.name}
                  </p>
                  <p style={{ fontSize: '13px', color: 'var(--color-text-muted)', marginTop: '6px' }}>
                    {branch.location}
                  </p>
                </div>
                <Badge variant={branch.is_active ? 'success' : 'muted'}>
                  {branch.is_active ? 'Active' : 'Inactive'}
                </Badge>
              </div>

              <div className="flex flex-wrap gap-2" style={{ marginTop: '12px' }}>
                <Badge variant={getBranchTypeVariant(branch.branch_type)}>{branch.branch_type}</Badge>
                <Badge variant="info">{insight?.todaySales ? formatMoney(insight.todaySales, currency) : 'No sales today'}</Badge>
              </div>

              {insight && (
                <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: '12px 0 0' }}>
                  {insight.employees.length} employees · {formatNumber(insight.stockBaseQuantity)} base units in stock
                </p>
              )}
            </div>
          )
        })}
      </div>

      {selectedBranch && selectedInsight && (
        <div
          role="presentation"
          className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6"
          style={{ backgroundColor: 'rgba(15, 23, 42, 0.55)' }}
          onClick={() => setSelectedBranch(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`${selectedBranch.name} branch details`}
            className="w-full max-w-4xl"
            style={{
              backgroundColor: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-card)',
              boxShadow: 'var(--shadow-card)',
              maxHeight: '88vh',
              overflowY: 'auto',
              padding: 24,
            }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-text-primary)', margin: 0 }}>
                  {selectedBranch.name}
                </h2>
                <p style={{ fontSize: 14, color: 'var(--color-text-muted)', marginTop: 6 }}>
                  {selectedBranch.location}
                </p>
              </div>
              <button type="button" className="btn-outline" style={{ padding: '8px 14px', borderRadius: 8 }} onClick={() => setSelectedBranch(null)}>
                Close
              </button>
            </div>

            <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Metric label="Sales today" value={formatMoney(selectedInsight.todaySales, currency)} />
              <Metric label="Verified today" value={formatMoney(selectedInsight.todayVerifiedSales, currency)} />
              <Metric label="Profit today" value={formatMoney(selectedInsight.todayProfit, currency)} />
              <Metric label="Remaining stock" value={`${formatNumber(selectedInsight.stockBaseQuantity)} base units`} />
            </div>

            <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Metric
                label="Best employee today"
                value={selectedInsight.bestEmployeeName ? `${selectedInsight.bestEmployeeName} (${formatMoney(selectedInsight.bestEmployeeSales, currency)})` : 'No employee sales today'}
              />
              <Metric
                label="Your admin sales today"
                value={selectedInsight.bestAdminName ? `${selectedInsight.bestAdminName} (${formatMoney(selectedInsight.bestAdminSales, currency)})` : 'No admin sales today'}
              />
              <Metric label="Employees assigned" value={String(selectedInsight.employees.length)} />
              <Metric label="Pending damages" value={String(selectedInsight.pendingDamageReports)} />
            </div>

            <div className="mt-6 flex flex-wrap gap-3 border-t pt-4" style={{ borderColor: 'var(--color-border)' }}>
              <Link href={`/dashboard/admin/transactions?branch=${selectedBranch.id}`} className="btn-primary" style={{ padding: '10px 18px', borderRadius: 8 }}>
                View transactions
              </Link>
              {selectedBranch.is_active && (
                <Link href={`/dashboard/admin/transactions/new?branch=${selectedBranch.id}`} className="btn-outline" style={{ padding: '10px 18px', borderRadius: 8 }}>
                  Make transaction
                </Link>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ border: '1px solid var(--color-border)', borderRadius: 12, padding: 14, backgroundColor: 'var(--color-background)' }}>
      <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: 0 }}>{label}</p>
      <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--color-text-primary)', marginTop: 6 }}>{value}</p>
    </div>
  )
}
