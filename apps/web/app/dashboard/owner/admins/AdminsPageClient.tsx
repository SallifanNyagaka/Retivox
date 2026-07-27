'use client'
/**
 * Client shell for the owner admins dashboard.
 *
 * This component renders the metrics, admin table, history tab, and the
 * top-level add/invite modals that sit above the row-level actions.
 */

import { useMemo, useState } from 'react'
import { Card, CardHeader } from '../../../../components/ui/Card'
import { Badge } from '../../../../components/ui/Badge'
import { MetricCard } from '../../../../components/dashboard/MetricCard'
import PersonDetailsDialog, { type PersonDetail } from '../../../../components/dashboard/PersonDetailsDialog'
import SpreadsheetTools from '../../../../components/dashboard/SpreadsheetTools'
import AddAdminForm from './AddAdminForm'
import InviteAdminForm from './InviteAdminForm'
import AdminRowActions from './AdminRowActions'
import { importAdmins } from './actions'
import type { AdminRow, BranchRow, TransferHistoryRow } from './types'

/**
 * Props passed from the server page after data hydration.
 */
type Props = {
  currency: string
  ownerAccount: AdminRow | null
  admins: AdminRow[]
  branches: BranchRow[]
  availableBranches: BranchRow[]
  transferHistory: TransferHistoryRow[]
  metrics: {
    totalAdmins: number
    branchesCovered: number
    unassignedBranches: number
  }
}

/**
 * Returns a readable time label.
 */
function formatDateTimeLabel(isoDate: string | null) {
  if (!isoDate) {
    return '—'
  }

  return new Date(isoDate).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Returns the badge variant for transfer history rows.
 */
function getTransferStatusVariant(status: TransferHistoryRow['status']) {
  if (status === 'approved') return 'success'
  if (status === 'rejected') return 'danger'
  return 'warning'
}

/**
 * Returns the label for a transfer history status.
 */
function getTransferStatusLabel(status: TransferHistoryRow['status']) {
  if (status === 'approved') return 'Approved'
  if (status === 'rejected') return 'Rejected'
  return 'Pending'
}

/**
 * Owner admins dashboard client component.
 */
export default function AdminsPageClient({
  currency,
  ownerAccount,
  admins,
  branches,
  availableBranches,
  transferHistory,
  metrics,
}: Props) {
  const [activeTab, setActiveTab] = useState<'admins' | 'history'>('admins')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<'all' | 'active' | 'inactive'>('all')
  const [branchId, setBranchId] = useState('all')
  const [selectedAdmin, setSelectedAdmin] = useState<PersonDetail | null>(null)

  const filteredAdmins = useMemo(() => {
    const normalized = search.trim().toLowerCase()

    return admins.filter((admin) => {
      const matchesSearch = normalized
        ? `${admin.name} ${admin.email} ${admin.phone ?? ''} ${admin.assignedBranchNames.join(' ')}`
            .toLowerCase()
            .includes(normalized)
        : true
      const matchesStatus = status === 'all' ? true : status === 'active' ? admin.is_active : !admin.is_active
      const matchesBranch = branchId === 'all' ? true : admin.assignedBranchIds.includes(branchId)

      return matchesSearch && matchesStatus && matchesBranch
    })
  }, [admins, branchId, search, status])

  const exportParams = new URLSearchParams()
  if (search.trim()) exportParams.set('q', search.trim())
  if (status !== 'all') exportParams.set('status', status)
  if (branchId !== 'all') exportParams.set('branch', branchId)
  const exportHref = `/dashboard/owner/admins/export${exportParams.toString() ? `?${exportParams.toString()}` : ''}`

  return (
    <div className="flex flex-col gap-6" data-currency={currency}>
      {/* Page header and primary CTAs */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1
            className="font-bold"
            style={{
              fontSize: '22px',
              color: 'var(--color-text-primary)',
              letterSpacing: '-0.3px',
            }}
          >
            Admins
          </h1>
          <p style={{ fontSize: '14px', color: 'var(--color-text-muted)', marginTop: '4px' }}>
            Manage branch administrators, assignments, and transfer history.
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <SpreadsheetTools
            entityLabel="Admins"
            exportHref={exportHref}
            templateHref="/dashboard/owner/admins/template"
            importAction={importAdmins}
          />
          <InviteAdminForm />
          <AddAdminForm availableBranches={availableBranches} />
        </div>
      </div>

      <Card padding="md">
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-4">
          <label className="flex flex-col gap-2" style={{ fontSize: 13, color: 'var(--color-text-primary)' }}>
            Search
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Name, email, phone, or branch"
              style={{
                height: 44,
                borderRadius: 8,
                border: '1px solid var(--color-border)',
                padding: '0 14px',
                backgroundColor: 'var(--color-background)',
                color: 'var(--color-text-primary)',
              }}
            />
          </label>
          <label className="flex flex-col gap-2" style={{ fontSize: 13, color: 'var(--color-text-primary)' }}>
            Status
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value as 'all' | 'active' | 'inactive')}
              style={{
                height: 44,
                borderRadius: 8,
                border: '1px solid var(--color-border)',
                padding: '0 14px',
                backgroundColor: 'var(--color-background)',
                color: 'var(--color-text-primary)',
              }}
            >
              <option value="all">All statuses</option>
              <option value="active">Active only</option>
              <option value="inactive">Inactive only</option>
            </select>
          </label>
          <label className="flex flex-col gap-2" style={{ fontSize: 13, color: 'var(--color-text-primary)' }}>
            Branch
            <select
              value={branchId}
              onChange={(event) => setBranchId(event.target.value)}
              style={{
                height: 44,
                borderRadius: 8,
                border: '1px solid var(--color-border)',
                padding: '0 14px',
                backgroundColor: 'var(--color-background)',
                color: 'var(--color-text-primary)',
              }}
            >
              <option value="all">All branches</option>
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-end">
            <button
              type="button"
              className="btn-outline"
              style={{ padding: '8px 16px', borderRadius: 8 }}
              onClick={() => {
                setSearch('')
                setStatus('all')
                setBranchId('all')
              }}
            >
              Clear filters
            </button>
          </div>
        </div>
      </Card>

      {/* Summary metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <MetricCard label="Total admins" value={String(metrics.totalAdmins)} />
        <MetricCard label="Branches covered" value={String(metrics.branchesCovered)} />
        <MetricCard label="Unassigned branches" value={String(metrics.unassignedBranches)} />
      </div>

      {/* Owner summary */}
      {ownerAccount && (
        <Card padding="md">
          <CardHeader title="Owner account" />
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p style={{ fontSize: '15px', fontWeight: 600, color: 'var(--color-text-primary)', margin: 0 }}>
                {ownerAccount.name}
              </p>
              <p style={{ fontSize: '13px', color: 'var(--color-text-muted)', marginTop: '6px' }}>
                {ownerAccount.email}
              </p>
              <p style={{ fontSize: '13px', color: 'var(--color-text-muted)', marginTop: '4px' }}>
                {ownerAccount.assignedBranchNames.length > 0
                  ? ownerAccount.assignedBranchNames.join(', ')
                  : 'No branch assignments recorded'}
              </p>
            </div>
            <Badge variant={ownerAccount.is_active ? 'success' : 'muted'}>{ownerAccount.is_active ? 'Active' : 'Inactive'}</Badge>
          </div>
        </Card>
      )}

      {/* Section tabs */}
      <div className="flex flex-wrap gap-2">
        {[
          { key: 'admins' as const, label: 'Admins' },
          { key: 'history' as const, label: 'History' },
        ].map((tab) => {
          const active = activeTab === tab.key

          return (
            <button
              key={tab.key}
              type="button"
              className={active ? 'btn-primary' : 'btn-outline'}
              style={{
                padding: '8px 16px',
                borderRadius: 8,
                fontSize: '13px',
              }}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </button>
          )
        })}
      </div>

      {/* Admins table */}
      {activeTab === 'admins' && (
        <Card padding="md">
          <CardHeader title="Admin directory" />

          {filteredAdmins.length === 0 ? (
            <div
              className="flex flex-col items-center justify-center text-center"
              style={{
                padding: '48px 20px',
                gap: '16px',
              }}
            >
              <div
                className="rounded-2xl"
                style={{
                  width: '84px',
                  height: '84px',
                  display: 'grid',
                  placeItems: 'center',
                  backgroundColor: 'var(--color-primary-light)',
                  color: 'var(--color-primary)',
                }}
              >
                <svg width="36" height="36" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path d="M12 12a5 5 0 100-10 5 5 0 000 10z" />
                  <path d="M4 21a8 8 0 0116 0" />
                </svg>
              </div>
              <div>
                <h2 style={{ fontSize: '20px', fontWeight: 600, color: 'var(--color-text-primary)', margin: 0 }}>
                  No admins yet
                </h2>
                <p style={{ fontSize: '14px', color: 'var(--color-text-muted)', marginTop: '8px' }}>
                  Add or invite your first admin to start assigning branch access.
                </p>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row">
                <InviteAdminForm />
                <AddAdminForm availableBranches={availableBranches} />
              </div>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderSpacing: 0 }}>
                <thead>
                  <tr style={{ textAlign: 'left' }}>
                    {['Name', 'Email', 'Phone', 'Assigned branches', 'Status', 'Actions'].map((heading) => (
                      <th key={heading} style={{ padding: '12px', fontSize: '12px', color: 'var(--color-text-muted)' }}>
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredAdmins.map((admin, index) => (
                    <tr
                      key={admin.id}
                      role="button"
                      tabIndex={0}
                      style={{
                        backgroundColor: index % 2 === 0 ? 'var(--color-background)' : 'var(--color-surface)',
                        cursor: 'pointer',
                      }}
                      onClick={() =>
                        setSelectedAdmin({
                          id: admin.id,
                          name: admin.name,
                          roleLabel: 'Admin',
                          email: admin.email,
                          phone: admin.phone,
                          statusLabel: admin.is_active ? 'Active' : 'Inactive',
                          assignedLabel: admin.assignedBranchNames.length > 0 ? admin.assignedBranchNames.join(', ') : 'No branches assigned',
                          createdLabel: formatDateTimeLabel(admin.created_at),
                          transactionCount: admin.transactionCount,
                          operationsHref: `/dashboard/owner/transactions?employee=${admin.id}`,
                        })
                      }
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          setSelectedAdmin({
                            id: admin.id,
                            name: admin.name,
                            roleLabel: 'Admin',
                            email: admin.email,
                            phone: admin.phone,
                            statusLabel: admin.is_active ? 'Active' : 'Inactive',
                            assignedLabel: admin.assignedBranchNames.length > 0 ? admin.assignedBranchNames.join(', ') : 'No branches assigned',
                            createdLabel: formatDateTimeLabel(admin.created_at),
                            transactionCount: admin.transactionCount,
                            operationsHref: `/dashboard/owner/transactions?employee=${admin.id}`,
                          })
                        }
                      }}
                    >
                      <td style={{ padding: '12px', fontSize: '13px', color: 'var(--color-text-primary)' }}>
                        {admin.name}
                      </td>
                      <td style={{ padding: '12px', fontSize: '13px', color: 'var(--color-text-primary)' }}>
                        {admin.email}
                      </td>
                      <td style={{ padding: '12px', fontSize: '13px', color: 'var(--color-text-primary)' }}>
                        {admin.phone ?? '—'}
                      </td>
                      <td style={{ padding: '12px', fontSize: '13px', color: 'var(--color-text-primary)' }}>
                        {admin.assignedBranchNames.length > 0 ? admin.assignedBranchNames.join(', ') : 'No branches assigned'}
                      </td>
                      <td style={{ padding: '12px' }}>
                        <div className="flex flex-wrap gap-2">
                          <Badge variant={admin.is_active ? 'success' : 'muted'}>
                            {admin.is_active ? 'Active' : 'Inactive'}
                          </Badge>
                          <Badge variant="info">{admin.global_role === 'admin' ? 'Admin' : 'Owner'}</Badge>
                        </div>
                      </td>
                      <td style={{ padding: '12px' }} onClick={(event) => event.stopPropagation()}>
                        <AdminRowActions
                          admin={admin}
                          branches={branches}
                          availableBranches={availableBranches}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      <PersonDetailsDialog person={selectedAdmin} onClose={() => setSelectedAdmin(null)} />

      {/* Transfer history tab */}
      {activeTab === 'history' && (
        <Card padding="md">
          <CardHeader title="Transfer history" />

          {transferHistory.length === 0 ? (
            <div
              className="flex flex-col items-center justify-center text-center"
              style={{
                padding: '48px 20px',
                gap: '16px',
              }}
            >
              <div
                className="rounded-2xl"
                style={{
                  width: '84px',
                  height: '84px',
                  display: 'grid',
                  placeItems: 'center',
                  backgroundColor: 'var(--color-primary-light)',
                  color: 'var(--color-primary)',
                }}
              >
                <svg width="36" height="36" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path d="M7 7h10v10H7z" />
                  <path d="M12 11v4" />
                  <path d="M9 11h6" />
                </svg>
              </div>
              <div>
                <h2 style={{ fontSize: '20px', fontWeight: 600, color: 'var(--color-text-primary)', margin: 0 }}>
                  No transfer history yet
                </h2>
                <p style={{ fontSize: '14px', color: 'var(--color-text-muted)', marginTop: '8px' }}>
                  Branch transfer approvals will appear here once they are recorded.
                </p>
              </div>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderSpacing: 0 }}>
                <thead>
                  <tr style={{ textAlign: 'left' }}>
                    {['User', 'Route', 'Requested', 'Approved', 'Status'].map((heading) => (
                      <th key={heading} style={{ padding: '12px', fontSize: '12px', color: 'var(--color-text-muted)' }}>
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {transferHistory.map((transfer, index) => (
                    <tr
                      key={transfer.id}
                      style={{
                        backgroundColor: index % 2 === 0 ? 'var(--color-background)' : 'var(--color-surface)',
                      }}
                    >
                      <td style={{ padding: '12px', fontSize: '13px', color: 'var(--color-text-primary)' }}>
                        {transfer.user_name}
                      </td>
                      <td style={{ padding: '12px', fontSize: '13px', color: 'var(--color-text-primary)' }}>
                        {transfer.from_branch_name} → {transfer.to_branch_name}
                      </td>
                      <td style={{ padding: '12px', fontSize: '13px', color: 'var(--color-text-primary)' }}>
                        {formatDateTimeLabel(transfer.requested_at)}
                      </td>
                      <td style={{ padding: '12px', fontSize: '13px', color: 'var(--color-text-primary)' }}>
                        {formatDateTimeLabel(transfer.approved_at)}
                      </td>
                      <td style={{ padding: '12px' }}>
                        <Badge variant={getTransferStatusVariant(transfer.status)}>
                          {getTransferStatusLabel(transfer.status)}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      <p style={{ fontSize: '12px', color: 'var(--color-text-muted)', margin: 0 }}>
        Business currency: {currency}
      </p>
    </div>
  )
}
