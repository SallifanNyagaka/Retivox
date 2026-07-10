'use client'
/**
 * Compact store and period filters for owner finances.
 */

import { useRouter, useSearchParams } from 'next/navigation'

type BranchOption = {
  id: string
  name: string
}

type Props = {
  branches: BranchOption[]
  selectedBranchId: string
  selectedPeriod: 'today' | 'week' | 'month'
}

const periods: Array<{ id: Props['selectedPeriod']; label: string }> = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'This week' },
  { id: 'month', label: 'This month' },
]

/**
 * FinanceFilters keeps the server page simple by storing filters in the URL.
 */
export default function FinanceFilters({ branches, selectedBranchId, selectedPeriod }: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const updateFilter = (key: 'period' | 'branch', value: string) => {
    const params = new URLSearchParams(searchParams.toString())

    if (!value || (key === 'period' && value === 'today')) {
      params.delete(key)
    } else {
      params.set(key, value)
    }

    router.push(`/dashboard/owner/finances${params.toString() ? `?${params.toString()}` : ''}`)
  }

  return (
    <div className="rounded-xl border bg-[var(--color-surface)] p-3" style={{ borderColor: 'var(--color-border)' }}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-2">
          {periods.map((period) => {
            const isActive = selectedPeriod === period.id
            return (
              <button
                key={period.id}
                type="button"
                onClick={() => updateFilter('period', period.id)}
                className={isActive ? 'btn-primary' : 'btn-outline'}
                style={{ borderRadius: 999, padding: '8px 14px', fontSize: 13 }}
              >
                {period.label}
              </button>
            )
          })}
        </div>

        <label className="flex flex-col gap-1 text-left" style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
          Store
          <select
            value={selectedBranchId}
            onChange={(event) => updateFilter('branch', event.target.value)}
            style={{
              minWidth: 220,
              height: 40,
              border: '1px solid var(--color-border)',
              borderRadius: 10,
              padding: '0 12px',
              color: 'var(--color-text-primary)',
              backgroundColor: 'var(--color-background)',
              fontSize: 13,
            }}
          >
            <option value="">All stores</option>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  )
}
