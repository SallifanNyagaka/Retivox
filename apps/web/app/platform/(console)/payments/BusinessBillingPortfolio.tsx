'use client'

import { useMemo, useState } from 'react'
import { Badge } from '../../../../components/ui/Badge'
import { Card, CardHeader } from '../../../../components/ui/Card'

export type BillingPortfolioRow = {
  businessId: string
  businessName: string
  plan: string
  subscriptionStatus: string
  billingInterval: string | null
  periodEnd: string | null
  nextPlan: string | null
  nextInterval: string | null
  nextPeriodStart: string | null
  latestPayment: {
    status: string
    amount: number
    currency: string
    method: string
    reference: string
    submittedAt: string
  } | null
  lastVerifiedPayment: {
    amount: number
    currency: string
    method: string
    reference: string
    paidAt: string | null
  } | null
}

type Filter = 'all' | 'active' | 'pending' | 'rejected' | 'no_record'

const badgeVariant = (status: string): 'success' | 'warning' | 'danger' | 'muted' => {
  if (status === 'active' || status === 'verified') return 'success'
  if (status === 'rejected' || status === 'expired' || status === 'cancelled') return 'danger'
  return 'warning'
}

function money(amount: number, currency: string) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount)
}

export default function BusinessBillingPortfolio({ rows, loadError = false }: { rows: BillingPortfolioRow[]; loadError?: boolean }) {
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const summary = useMemo(() => ({
    businesses: rows.length,
    pending: rows.filter((row) => row.latestPayment?.status === 'pending').length,
    latestPaid: rows.filter((row) => row.latestPayment?.status === 'verified').length,
    noRecord: rows.filter((row) => !row.latestPayment).length,
  }), [rows])
  const visibleRows = useMemo(() => rows.filter((row) => {
    const matchesSearch = `${row.businessName} ${row.plan} ${row.latestPayment?.reference ?? ''}`.toLowerCase().includes(search.trim().toLowerCase())
    const matchesFilter = filter === 'all'
      || (filter === 'active' && row.latestPayment?.status === 'verified')
      || (filter === 'pending' && row.latestPayment?.status === 'pending')
      || (filter === 'rejected' && row.latestPayment?.status === 'rejected')
      || (filter === 'no_record' && !row.latestPayment)
    return matchesSearch && matchesFilter
  }), [filter, rows, search])

  return <Card padding="md">
    <CardHeader title="Business payment status" action={<Badge variant="info">{rows.length} businesses</Badge>} />
    <p style={{ margin: '0 0 14px', color: 'var(--color-text-muted)', fontSize: 13 }}>
      Review each business’s current subscription, latest payment request, verified payment history, and any scheduled plan change.
    </p>
    {loadError ? <p role="alert" style={{ margin: 0, color: 'var(--color-danger)', fontSize: 13 }}>Business billing records could not be loaded. Payment statuses below are unavailable; refresh or check the database connection.</p> : <>
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4" style={{ marginBottom: 16 }}>
      <Summary label="Businesses" value={summary.businesses} />
      <Summary label="Awaiting review" value={summary.pending} />
      <Summary label="Latest request paid" value={summary.latestPaid} />
      <Summary label="No payment request" value={summary.noRecord} />
    </div>
    <div className="mb-3 flex flex-wrap gap-2">
      <input aria-label="Search businesses and payment references" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search business or reference" style={inputStyle} />
      <select aria-label="Filter payment status" value={filter} onChange={(event) => setFilter(event.target.value as Filter)} style={{ ...inputStyle, width: 'auto' }}>
        <option value="all">All businesses</option>
        <option value="active">Latest request paid</option>
        <option value="pending">Awaiting review</option>
        <option value="rejected">Latest request rejected</option>
        <option value="no_record">No payment request</option>
      </select>
    </div>
    <div className="overflow-x-auto rounded-xl" style={{ border: '1px solid var(--color-border)' }}>
      <table style={{ width: '100%', minWidth: 1050, borderCollapse: 'collapse', fontSize: 12 }}>
        <thead><tr style={{ background: 'var(--color-background)', color: 'var(--color-text-muted)', textAlign: 'left' }}>
          {['Business', 'Current subscription', 'Latest payment request', 'Last verified payment', 'Scheduled plan change'].map((label) => <th key={label} style={thStyle}>{label}</th>)}
        </tr></thead>
        <tbody>
          {visibleRows.map((row) => <tr key={row.businessId} style={{ borderTop: '1px solid var(--color-border)', color: 'var(--color-text-primary)' }}>
            <td style={tdStyle}><strong>{row.businessName}</strong><div style={mutedStyle}>{row.businessId}</div></td>
            <td style={tdStyle}><div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}><strong>{row.plan}</strong><Badge variant={badgeVariant(row.subscriptionStatus)}>{row.subscriptionStatus.replaceAll('_', ' ')}</Badge></div><div style={mutedStyle}>{row.billingInterval ?? 'billing interval unavailable'}{row.periodEnd ? ` · through ${new Date(row.periodEnd).toLocaleDateString()}` : ''}</div></td>
            <td style={tdStyle}>{row.latestPayment ? <><Badge variant={badgeVariant(row.latestPayment.status)}>{row.latestPayment.status.replaceAll('_', ' ')}</Badge><div style={{ marginTop: 5 }}>{money(Number(row.latestPayment.amount), row.latestPayment.currency)} · {row.latestPayment.method.replaceAll('_', ' ')}</div><div style={mutedStyle}>Ref {row.latestPayment.reference} · {new Date(row.latestPayment.submittedAt).toLocaleDateString()}</div></> : <span style={{ color: 'var(--color-text-muted)' }}>No payment request recorded</span>}</td>
            <td style={tdStyle}>{row.lastVerifiedPayment ? <><strong>{money(Number(row.lastVerifiedPayment.amount), row.lastVerifiedPayment.currency)}</strong><div style={mutedStyle}>{row.lastVerifiedPayment.method.replaceAll('_', ' ')} · {row.lastVerifiedPayment.paidAt ? new Date(row.lastVerifiedPayment.paidAt).toLocaleDateString() : 'date unavailable'}</div><div style={mutedStyle}>Ref {row.lastVerifiedPayment.reference}</div></> : <span style={{ color: 'var(--color-text-muted)' }}>No verified payment found</span>}</td>
            <td style={tdStyle}>{row.nextPlan ? <><strong>{row.nextPlan}</strong><div style={mutedStyle}>{row.nextInterval ?? ''}{row.nextPeriodStart ? ` · starts ${new Date(row.nextPeriodStart).toLocaleDateString()}` : ''}</div></> : <span style={{ color: 'var(--color-text-muted)' }}>None</span>}</td>
          </tr>)}
          {visibleRows.length === 0 && <tr><td colSpan={5} style={{ ...tdStyle, color: 'var(--color-text-muted)', textAlign: 'center' }}>No businesses match this filter.</td></tr>}
        </tbody>
      </table>
    </div>
    </>}
  </Card>
}

function Summary({ label, value }: { label: string; value: number }) {
  return <div style={{ border: '1px solid var(--color-border)', borderRadius: 12, padding: 12 }}><div style={{ color: 'var(--color-text-muted)', fontSize: 11 }}>{label}</div><strong style={{ display: 'block', marginTop: 3, color: 'var(--color-text-primary)', fontSize: 18 }}>{value}</strong></div>
}

const inputStyle = { minHeight: 38, border: '1px solid var(--color-border)', borderRadius: 8, padding: '0 10px', background: 'var(--color-background)', color: 'var(--color-text-primary)', fontSize: 12 } as const
const thStyle = { padding: '10px 12px', fontSize: 11, fontWeight: 800, whiteSpace: 'nowrap' as const }
const tdStyle = { padding: '11px 12px', verticalAlign: 'top' as const }
const mutedStyle = { marginTop: 4, color: 'var(--color-text-muted)', fontSize: 11 }
