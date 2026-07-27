'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Badge } from '../../../../components/ui/Badge'
import BranchCardActions from './BranchCardActions'

export type OwnerBranchCardRow = {
  id: string
  name: string
  location: string
  branch_type: string
  is_active: boolean
  created_at: string
  transactionCount: number
}

export type BranchPersonSummary = {
  id: string
  name: string
  email: string | null
  phone: string | null
}

export type BranchInsight = {
  branchId: string
  admins: BranchPersonSummary[]
  employees: BranchPersonSummary[]
  stockItems: number
  stockBaseQuantity: number
  todaySales: number
  todayVerifiedSales: number
  todayProfit: number
  pendingDamageReports: number
  approvedLossReports: number
  bestEmployeeName: string | null
  bestEmployeeSales: number
  bestAdminName: string | null
  bestAdminSales: number
}

type Props = {
  branches: OwnerBranchCardRow[]
  adminCountMap: Record<string, number>
  insights: Record<string, BranchInsight>
  currency: string
}

function getBranchTypeVariant(branchType: string) {
  return branchType === 'warehouse' ? 'info' : 'success'
}

function formatDateLabel(isoDate: string) {
  return new Date(isoDate).toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
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

function TransactionIcon() {
  return (
    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path d="M4 4h16v16H4z" />
      <path d="M8 8h8" />
      <path d="M8 12h8" />
      <path d="M8 16h4" />
    </svg>
  )
}

export default function OwnerBranchCards({ branches, adminCountMap, insights, currency }: Props) {
  const [selectedBranch, setSelectedBranch] = useState<OwnerBranchCardRow | null>(null)
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
              className="flex cursor-pointer flex-col justify-between transition-shadow duration-200 hover:shadow-card-hover"
              style={{
                backgroundColor: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderLeft: `3px solid ${branch.is_active ? 'var(--color-success)' : 'var(--color-text-muted)'}`,
                borderRadius: 'var(--radius-card)',
                boxShadow: 'var(--shadow-card)',
                padding: '20px',
              }}
              onClick={() => setSelectedBranch(branch)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  setSelectedBranch(branch)
                }
              }}
            >
              <div className="flex flex-col gap-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p style={{ fontSize: '16px', fontWeight: 600, color: 'var(--color-text-primary)', margin: 0 }}>
                      {branch.name}
                    </p>
                    <p style={{ fontSize: '13px', color: 'var(--color-text-muted)', marginTop: '6px' }}>
                      {branch.location}
                    </p>
                  </div>
                  {branch.is_active && (
                    <Link
                      href={`/dashboard/owner/transactions/new?branch=${branch.id}`}
                      className="btn-primary"
                      style={{ borderRadius: 8, flexShrink: 0, padding: '7px 12px', fontSize: 12 }}
                      onClick={(event) => event.stopPropagation()}
                    >
                      Make transaction
                    </Link>
                  )}
                </div>

                <div className="flex flex-wrap gap-2">
                  <Badge variant={getBranchTypeVariant(branch.branch_type)}>{branch.branch_type}</Badge>
                  <Badge variant={branch.is_active ? 'success' : 'muted'}>
                    {branch.is_active ? 'Active' : 'Inactive'}
                  </Badge>
                </div>

                <div className="flex items-center gap-2" style={{ color: 'var(--color-text-primary)' }}>
                  <TransactionIcon />
                  <span style={{ fontSize: '13px', fontWeight: 500 }}>
                    {branch.transactionCount} transactions
                  </span>
                </div>

                {insight && (
                  <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: 0 }}>
                    Today: {formatMoney(insight.todaySales, currency)} sales, {formatNumber(insight.stockBaseQuantity)} base units in stock
                  </p>
                )}
              </div>

              <div className="flex items-center justify-between" style={{ marginTop: 18 }}>
                <p style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>Created {formatDateLabel(branch.created_at)}</p>
                <div className="flex items-center gap-2" onClick={(event) => event.stopPropagation()}>
                  <span style={{ fontSize: 13, color: 'var(--color-text-primary)' }}>{adminCountMap[branch.id] ?? 0} admins</span>
                  <BranchCardActions branchId={branch.id} branchName={branch.name} isActive={branch.is_active} />
                </div>
              </div>
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

            <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Panel title="Assigned admins" people={selectedInsight.admins} emptyText="No admin assigned" />
              <Panel title="Employees" people={selectedInsight.employees} emptyText="No employees assigned" />
            </div>

            <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Metric
                label="Best employee today"
                value={selectedInsight.bestEmployeeName ? `${selectedInsight.bestEmployeeName} (${formatMoney(selectedInsight.bestEmployeeSales, currency)})` : 'No employee sales today'}
              />
              <Metric
                label="Best admin today"
                value={selectedInsight.bestAdminName ? `${selectedInsight.bestAdminName} (${formatMoney(selectedInsight.bestAdminSales, currency)})` : 'No admin sales today'}
              />
              <Metric label="Pending damages" value={String(selectedInsight.pendingDamageReports)} />
              <Metric label="Approved losses" value={String(selectedInsight.approvedLossReports)} />
            </div>

            <div className="mt-5 flex flex-wrap gap-3">
              <Link href={`/dashboard/owner/transactions?branch=${selectedBranch.id}`} className="btn-primary" style={{ padding: '10px 18px', borderRadius: 8 }}>
                View transactions
              </Link>
              {selectedBranch.is_active && (
                <Link href={`/dashboard/owner/transactions/new?branch=${selectedBranch.id}`} className="btn-outline" style={{ padding: '10px 18px', borderRadius: 8 }}>
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

function Panel({ title, people, emptyText }: { title: string; people: BranchPersonSummary[]; emptyText: string }) {
  return (
    <div style={{ border: '1px solid var(--color-border)', borderRadius: 12, padding: 14 }}>
      <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-text-primary)', margin: 0 }}>{title}</h3>
      {people.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 10 }}>{emptyText}</p>
      ) : (
        <div className="mt-3 flex flex-col gap-3">
          {people.map((person) => (
            <div key={person.id}>
              <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text-primary)', margin: 0 }}>{person.name}</p>
              <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 3 }}>{person.email ?? 'No email'} · {person.phone ?? 'No phone'}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
