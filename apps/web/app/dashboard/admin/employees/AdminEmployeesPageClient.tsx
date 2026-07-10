'use client'
/**
 * Client shell for the admin employees dashboard.
 *
 * Renders branch-scoped employee filters, metrics, add employee modal, and
 * branch-access actions for only the branches managed by the current admin.
 */

import { useMemo, useState } from 'react'
import { Badge } from '../../../../components/ui/Badge'
import { Card, CardHeader } from '../../../../components/ui/Card'
import { MetricCard } from '../../../../components/dashboard/MetricCard'
import AddAdminEmployeeForm, { type AdminEmployeeBranchOption } from './AddAdminEmployeeForm'
import AdminEmployeeRowActions from './AdminEmployeeRowActions'

/**
 * Hydrated employee row displayed in the admin table.
 */
export type AdminEmployeeRow = {
  roleId: string
  userId: string
  name: string
  email: string
  phone: string | null
  branchId: string
  branchName: string
  accountIsActive: boolean
  accessIsActive: boolean
  assignedAt: string
  transactionCount: number
}

/**
 * Summary metrics displayed at the top of the admin employees page.
 */
export type AdminEmployeesMetrics = {
  totalEmployees: number
  activeAccess: number
  inactiveAccess: number
  averageTransactions: number
}

/**
 * Props for AdminEmployeesPageClient.
 */
type Props = {
  employees: AdminEmployeeRow[]
  branches: AdminEmployeeBranchOption[]
  metrics: AdminEmployeesMetrics
}

/**
 * Returns a friendly date label for assignment dates.
 */
function formatDateLabel(isoDate: string) {
  return new Date(isoDate).toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

/**
 * Empty state for admins who do not yet manage employees.
 */
function EmptyEmployeesState({ branches }: { branches: AdminEmployeeBranchOption[] }) {
  return (
    <div className="flex flex-col items-center justify-center text-center" style={{ padding: '48px 20px', gap: 16 }}>
      <div
        className="rounded-2xl"
        style={{
          width: 84,
          height: 84,
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
        <h2 style={{ fontSize: 20, fontWeight: 600, color: 'var(--color-text-primary)', margin: 0 }}>
          No employees found
        </h2>
        <p style={{ fontSize: 14, color: 'var(--color-text-muted)', marginTop: 8 }}>
          Add employees to the branches you manage and their activity will appear here.
        </p>
      </div>
      <AddAdminEmployeeForm branches={branches} />
    </div>
  )
}

/**
 * AdminEmployeesPageClient renders the interactive admin employee directory.
 */
export default function AdminEmployeesPageClient({ employees, branches, metrics }: Props) {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<'all' | 'active' | 'inactive'>('all')
  const [branchId, setBranchId] = useState('all')

  /**
   * Filters employee rows locally after the server has already branch-scoped them.
   */
  const filteredEmployees = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase()

    return employees.filter((employee) => {
      const isOperationallyActive = employee.accountIsActive && employee.accessIsActive
      const matchesSearch = normalizedSearch
        ? `${employee.name} ${employee.email} ${employee.phone ?? ''} ${employee.branchName}`
            .toLowerCase()
            .includes(normalizedSearch)
        : true
      const matchesStatus =
        status === 'all' ? true : status === 'active' ? isOperationallyActive : !isOperationallyActive
      const matchesBranch = branchId === 'all' ? true : employee.branchId === branchId

      return matchesSearch && matchesStatus && matchesBranch
    })
  }, [branchId, employees, search, status])

  return (
    <div className="flex flex-col gap-6">
      {/* Header and primary action */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-bold" style={{ fontSize: 22, color: 'var(--color-text-primary)', letterSpacing: '-0.3px' }}>
            Employees
          </h1>
          <p style={{ fontSize: 14, color: 'var(--color-text-muted)', marginTop: 4 }}>
            Add employees and manage access for the branches assigned to you.
          </p>
        </div>
        <AddAdminEmployeeForm branches={branches} />
      </div>

      {/* Search and filter controls */}
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
              <option value="all">All managed branches</option>
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
        <MetricCard label="Active access" value={String(metrics.activeAccess)} />
        <MetricCard label="Inactive access" value={String(metrics.inactiveAccess)} />
        <MetricCard label="Avg transactions" value={String(metrics.averageTransactions)} />
      </div>

      {/* Employee directory table */}
      <Card padding="md">
        <CardHeader title="Branch employee access" />
        {filteredEmployees.length === 0 ? (
          <EmptyEmployeesState branches={branches} />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderSpacing: 0 }}>
              <thead>
                <tr style={{ textAlign: 'left' }}>
                  {['Name', 'Email', 'Phone', 'Branch', 'Assigned', 'Transactions', 'Status', 'Actions'].map((heading) => (
                    <th key={heading} style={{ padding: 12, fontSize: 12, color: 'var(--color-text-muted)' }}>
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredEmployees.map((employee, index) => {
                  const operationallyActive = employee.accountIsActive && employee.accessIsActive
                  const statusLabel = !employee.accountIsActive
                    ? 'Account inactive'
                    : employee.accessIsActive
                      ? 'Active'
                      : 'Access inactive'

                  return (
                    <tr
                      key={employee.roleId}
                      style={{ backgroundColor: index % 2 === 0 ? 'var(--color-background)' : 'var(--color-surface)' }}
                    >
                      <td style={{ padding: 12, fontSize: 13, color: 'var(--color-text-primary)' }}>{employee.name}</td>
                      <td style={{ padding: 12, fontSize: 13, color: 'var(--color-text-primary)' }}>{employee.email}</td>
                      <td style={{ padding: 12, fontSize: 13, color: 'var(--color-text-primary)' }}>{employee.phone ?? '-'}</td>
                      <td style={{ padding: 12, fontSize: 13, color: 'var(--color-text-primary)' }}>{employee.branchName}</td>
                      <td style={{ padding: 12, fontSize: 13, color: 'var(--color-text-primary)' }}>
                        {formatDateLabel(employee.assignedAt)}
                      </td>
                      <td style={{ padding: 12, fontSize: 13, color: 'var(--color-text-primary)' }}>
                        {employee.transactionCount}
                      </td>
                      <td style={{ padding: 12 }}>
                        <Badge variant={operationallyActive ? 'success' : 'muted'}>{statusLabel}</Badge>
                      </td>
                      <td style={{ padding: 12 }}>
                        <AdminEmployeeRowActions
                          employee={{
                            roleId: employee.roleId,
                            userId: employee.userId,
                            name: employee.name,
                            branchId: employee.branchId,
                            branchName: employee.branchName,
                            accountIsActive: employee.accountIsActive,
                            accessIsActive: employee.accessIsActive,
                          }}
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
