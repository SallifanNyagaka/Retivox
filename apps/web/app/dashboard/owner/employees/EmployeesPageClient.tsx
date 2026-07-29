'use client'
/**
 * Client shell for the owner employees dashboard.
 *
 * Renders employee metrics, employee management actions, branch assignments,
 * and employee transfer history using hydrated server data.
 */

import { useMemo, useState } from 'react'
import { Card, CardHeader } from '../../../../components/ui/Card'
import { Badge } from '../../../../components/ui/Badge'
import { MetricCard } from '../../../../components/dashboard/MetricCard'
import PersonDetailsDialog, { type PersonDetail } from '../../../../components/dashboard/PersonDetailsDialog'
import SpreadsheetTools from '../../../../components/dashboard/SpreadsheetTools'
import AddEmployeeForm from './AddEmployeeForm'
import InviteEmployeeForm from './InviteEmployeeForm'
import EmployeeRowActions from './EmployeeRowActions'
import EmployeeTransferActions from './EmployeeTransferActions'
import { importEmployees } from './actions'
import type { BranchRow, EmployeeRow, TransferHistoryRow } from './types'

/**
 * Props passed from the server page after data hydration.
 */
type Props = {
  currency: string
  employees: EmployeeRow[]
  branches: BranchRow[]
  transferHistory: TransferHistoryRow[]
  metrics: {
    totalEmployees: number
    activeEmployees: number
    inactiveEmployees: number
    averageTransactions: number
  }
}

/**
 * Returns a readable date and time label for table cells.
 */
function formatDateTimeLabel(isoDate: string | null) {
  if (!isoDate) {
    return '-'
  }

  return new Date(isoDate).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Returns the badge variant for an employee transfer status.
 */
function getTransferStatusVariant(status: TransferHistoryRow['status']) {
  if (status === 'approved') return 'success'
  if (status === 'rejected') return 'danger'
  return 'warning'
}

/**
 * Returns the display label for an employee transfer status.
 */
function getTransferStatusLabel(status: TransferHistoryRow['status']) {
  if (status === 'approved') return 'Approved'
  if (status === 'rejected') return 'Rejected'
  return 'Pending'
}

/**
 * Renders the standard empty employee state.
 */
function EmptyEmployeesState({ branches }: { branches: BranchRow[] }) {
  return (
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
          No employees yet
        </h2>
        <p style={{ fontSize: '14px', color: 'var(--color-text-muted)', marginTop: '8px' }}>
          Add or invite your first employee to begin assigning branch access.
        </p>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row">
        <InviteEmployeeForm />
        <AddEmployeeForm branches={branches} />
      </div>
    </div>
  )
}

/**
 * Owner employees dashboard client component.
 */
export default function EmployeesPageClient({
  currency,
  employees,
  branches,
  transferHistory,
  metrics,
}: Props) {
  const [activeTab, setActiveTab] = useState<'employees' | 'transfers'>('employees')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<'all' | 'active' | 'inactive'>('all')
  const [branchId, setBranchId] = useState('all')
  const [selectedEmployee, setSelectedEmployee] = useState<PersonDetail | null>(null)

  const filteredEmployees = useMemo(() => {
    const normalized = search.trim().toLowerCase()

    return employees.filter((employee) => {
      const matchesSearch = normalized
        ? `${employee.name} ${employee.email} ${employee.phone ?? ''} ${employee.assignedBranchName ?? ''}`
            .toLowerCase()
            .includes(normalized)
        : true
      const matchesStatus =
        status === 'all' ? true : status === 'active' ? employee.is_active : !employee.is_active
      const matchesBranch = branchId === 'all' ? true : employee.assignedBranchId === branchId

      return matchesSearch && matchesStatus && matchesBranch
    })
  }, [branchId, employees, search, status])

  const exportParams = new URLSearchParams()
  if (search.trim()) exportParams.set('q', search.trim())
  if (status !== 'all') exportParams.set('status', status)
  if (branchId !== 'all') exportParams.set('branch', branchId)
  const exportHref = `/dashboard/owner/employees/export${exportParams.toString() ? `?${exportParams.toString()}` : ''}`

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
            Employees
          </h1>
          <p style={{ fontSize: '14px', color: 'var(--color-text-muted)', marginTop: '4px' }}>
            Manage employee access, branch assignments, activity, and transfer approvals.
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <SpreadsheetTools
            entityLabel="Employees"
            exportHref={exportHref}
            templateHref="/dashboard/owner/employees/template"
            importAction={importEmployees}
          />
          <InviteEmployeeForm />
          <AddEmployeeForm branches={branches} />
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
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <MetricCard label="Total employees" value={String(metrics.totalEmployees)} />
        <MetricCard label="Active" value={String(metrics.activeEmployees)} />
        <MetricCard label="Inactive" value={String(metrics.inactiveEmployees)} />
        <MetricCard label="Avg transactions" value={String(metrics.averageTransactions)} />
      </div>

      {/* Section tabs */}
      <div className="flex flex-wrap gap-2">
        {[
          { key: 'employees' as const, label: 'Employees' },
          { key: 'transfers' as const, label: 'Transfers' },
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

      {/* Employees table */}
      {activeTab === 'employees' && (
        <Card padding="md">
          <CardHeader title="Employee directory" />

          {filteredEmployees.length === 0 ? (
            <EmptyEmployeesState branches={branches} />
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderSpacing: 0 }}>
                <thead>
                  <tr style={{ textAlign: 'left' }}>
                    {['Name', 'Email', 'Phone', 'Branch', 'Transactions', 'Status', 'Actions'].map((heading) => (
                      <th key={heading} style={{ padding: '12px', fontSize: '12px', color: 'var(--color-text-muted)' }}>
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredEmployees.map((employee, index) => (
                    <tr
                      key={employee.id}
                      role="button"
                      tabIndex={0}
                      style={{
                        backgroundColor: index % 2 === 0 ? 'var(--color-background)' : 'var(--color-surface)',
                        cursor: 'pointer',
                      }}
                      onClick={() =>
                        setSelectedEmployee({
                          id: employee.id,
                          name: employee.name,
                          roleLabel: 'Employee',
                          email: employee.email,
                          phone: employee.phone,
                          statusLabel: employee.is_active ? 'Active' : 'Inactive',
                          assignedLabel: employee.assignedBranchName ?? 'No branch assigned',
                          createdLabel: formatDateTimeLabel(employee.created_at),
                          transactionCount: employee.transactionCount,
                          operationsHref: `/dashboard/owner/transactions?employee=${employee.id}`,
                        })
                      }
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          setSelectedEmployee({
                            id: employee.id,
                            name: employee.name,
                            roleLabel: 'Employee',
                            email: employee.email,
                            phone: employee.phone,
                            statusLabel: employee.is_active ? 'Active' : 'Inactive',
                            assignedLabel: employee.assignedBranchName ?? 'No branch assigned',
                            createdLabel: formatDateTimeLabel(employee.created_at),
                            transactionCount: employee.transactionCount,
                            operationsHref: `/dashboard/owner/transactions?employee=${employee.id}`,
                          })
                        }
                      }}
                    >
                      <td style={{ padding: '12px', fontSize: '13px', color: 'var(--color-text-primary)' }}>
                        {employee.name}
                      </td>
                      <td style={{ padding: '12px', fontSize: '13px', color: 'var(--color-text-primary)' }}>
                        {employee.email}
                      </td>
                      <td style={{ padding: '12px', fontSize: '13px', color: 'var(--color-text-primary)' }}>
                        {employee.phone ?? '-'}
                      </td>
                      <td style={{ padding: '12px', fontSize: '13px', color: 'var(--color-text-primary)' }}>
                        {employee.assignedBranchName ?? 'No branch assigned'}
                      </td>
                      <td style={{ padding: '12px', fontSize: '13px', color: 'var(--color-text-primary)' }}>
                        {employee.transactionCount}
                      </td>
                      <td style={{ padding: '12px' }}>
                        <Badge variant={employee.is_active ? 'success' : 'muted'}>
                          {employee.is_active ? 'Active' : 'Inactive'}
                        </Badge>
                      </td>
                      <td style={{ padding: '12px' }} onClick={(event) => event.stopPropagation()}>
                        <EmployeeRowActions employee={employee} branches={branches} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      <PersonDetailsDialog person={selectedEmployee} onClose={() => setSelectedEmployee(null)} />

      {/* Transfer history table */}
      {activeTab === 'transfers' && (
        <Card padding="md">
          <CardHeader title="Employee transfer history" />

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
                  <path d="M9 12h6" />
                  <path d="M12 9v6" />
                </svg>
              </div>
              <div>
                <h2 style={{ fontSize: '20px', fontWeight: 600, color: 'var(--color-text-primary)', margin: 0 }}>
                  No employee transfers yet
                </h2>
                <p style={{ fontSize: '14px', color: 'var(--color-text-muted)', marginTop: '8px' }}>
                  Transfer requests and approvals will appear here once created.
                </p>
              </div>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderSpacing: 0 }}>
                <thead>
                  <tr style={{ textAlign: 'left' }}>
                    {['Employee', 'Route', 'Requested', 'Approved', 'Status', 'Actions'].map((heading) => (
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
                        {transfer.from_branch_name} to {transfer.to_branch_name}
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
                      <td style={{ padding: '12px' }}>
                        <EmployeeTransferActions transfer={transfer} />
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
