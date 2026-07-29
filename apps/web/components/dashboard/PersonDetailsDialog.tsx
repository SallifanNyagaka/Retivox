'use client'

import Link from 'next/link'

export type PersonDetail = {
  id: string
  name: string
  roleLabel: string
  email: string
  phone: string | null
  statusLabel: string
  assignedLabel: string
  createdLabel?: string
  transactionCount: number
  operationsHref: string
  operationsLabel?: string
}

type Props = {
  person: PersonDetail | null
  onClose: () => void
}

export default function PersonDetailsDialog({ person, onClose }: Props) {
  if (!person) {
    return null
  }

  return (
    <div
      role="presentation"
      className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6"
      style={{ backgroundColor: 'rgba(15, 23, 42, 0.55)' }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${person.name} details`}
        className="w-full max-w-2xl"
        style={{
          backgroundColor: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-card)',
          boxShadow: 'var(--shadow-card)',
          padding: 24,
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: 0 }}>{person.roleLabel}</p>
            <h2 style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-text-primary)', margin: '4px 0 0' }}>
              {person.name}
            </h2>
          </div>
          <button type="button" className="btn-outline" style={{ padding: '8px 14px', borderRadius: 8 }} onClick={onClose}>
            Close
          </button>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Detail label="Email" value={person.email} />
          <Detail label="Phone" value={person.phone ?? '-'} />
          <Detail label="Status" value={person.statusLabel} />
          <Detail label="Assignment" value={person.assignedLabel} />
          <Detail label="Transactions recorded" value={String(person.transactionCount)} />
          <Detail label="Registered" value={person.createdLabel ?? '-'} />
        </div>

        <div className="mt-6 border-t pt-4" style={{ borderColor: 'var(--color-border)' }}>
          <Link href={person.operationsHref} className="btn-primary" style={{ padding: '10px 18px', borderRadius: 8 }}>
            {person.operationsLabel ?? 'View transactions / operations'}
          </Link>
        </div>
      </div>
    </div>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ border: '1px solid var(--color-border)', borderRadius: 12, padding: 14, backgroundColor: 'var(--color-background)' }}>
      <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: 0 }}>{label}</p>
      <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-text-primary)', marginTop: 6, overflowWrap: 'anywhere' }}>{value}</p>
    </div>
  )
}
