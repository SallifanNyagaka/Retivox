/**
 * Server-rendered view for the owner audit log dashboard.
 *
 * This component renders URL-backed filters, immutable audit rows, compact
 * old/new value summaries, pagination, and a professional empty state.
 */

import Link from 'next/link'
import { Card, CardHeader } from '../../../../components/ui/Card'
import { Badge } from '../../../../components/ui/Badge'
import { MetricCard } from '../../../../components/dashboard/MetricCard'
import AuditDetailsButton from './AuditDetailsButton'
import type { AuditActorRow, AuditFilterOptions, AuditFilters, AuditLogView, AuditMetrics, JsonValue } from './types'

/**
 * Props for the audit dashboard view.
 */
type Props = {
  logs: AuditLogView[]
  actors: AuditActorRow[]
  filters: AuditFilters
  options: AuditFilterOptions
  metrics: AuditMetrics
  totalPages: number
}

/**
 * Truncates long text to the audit prompt's 80-character summary limit.
 */
function truncateSummary(value: string) {
  if (value.length <= 80) {
    return value
  }

  return `${value.slice(0, 77)}...`
}

/**
 * Converts JSONB audit values to a compact human-readable summary.
 */
function summarizeJsonValue(value: JsonValue) {
  if (value === null) {
    return '-'
  }

  if (Array.isArray(value)) {
    return truncateSummary(JSON.stringify(value))
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value)
    if (entries.length === 0) {
      return '{}'
    }

    const summary = entries
      .slice(0, 4)
      .map(([key, entryValue]) => `${key}: ${typeof entryValue === 'object' ? JSON.stringify(entryValue) : String(entryValue)}`)
      .join(', ')

    return truncateSummary(summary)
  }

  return truncateSummary(String(value))
}

/**
 * Formats an audit timestamp for table display.
 */
function formatDateTimeLabel(isoDate: string) {
  return new Date(isoDate).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Returns a short readable entity id.
 */
function truncateEntityId(entityId: string) {
  return entityId.length > 12 ? `${entityId.slice(0, 8)}...${entityId.slice(-4)}` : entityId
}

/**
 * Returns the badge variant used for audit actions.
 */
function getActionVariant(action: string) {
  if (['approved', 'created', 'received', 'verified'].includes(action)) return 'success'
  if (['rejected', 'deactivated', 'voided', 'deleted'].includes(action)) return 'danger'
  if (['updated', 'requested', 'invited'].includes(action)) return 'warning'
  return 'info'
}

/**
 * Creates a URL for audit pagination while preserving active filters.
 */
function buildAuditHref(filters: AuditFilters, page: number) {
  const params = new URLSearchParams()

  if (filters.dateFrom) params.set('date_from', filters.dateFrom)
  if (filters.dateTo) params.set('date_to', filters.dateTo)
  if (filters.actor) params.set('actor', filters.actor)
  if (filters.action) params.set('action', filters.action)
  if (filters.entityType) params.set('entity_type', filters.entityType)
  if (page > 1) params.set('page', String(page))

  const query = params.toString()
  return query ? `/dashboard/owner/audit?${query}` : '/dashboard/owner/audit'
}

/**
 * Renders the URL-backed filter form.
 */
function AuditFilterBar({
  actors,
  filters,
  options,
}: {
  actors: AuditActorRow[]
  filters: AuditFilters
  options: AuditFilterOptions
}) {
  const inputStyle = {
    width: '100%',
    height: 44,
    border: '1px solid var(--color-border)',
    borderRadius: 8,
    padding: '0 12px',
    boxSizing: 'border-box' as const,
    fontSize: 13,
    color: 'var(--color-text-primary)',
    backgroundColor: 'var(--color-background)',
  }

  return (
    <Card padding="md">
      <CardHeader title="Filters" />

      <form action="/dashboard/owner/audit" method="get">
        <input type="hidden" name="page" value="1" />
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
          {/* Date-from filter */}
          <label style={{ fontSize: 13 }}>
            <span style={{ display: 'block', marginBottom: 6, color: 'var(--color-text-muted)' }}>From</span>
            <input type="date" name="date_from" defaultValue={filters.dateFrom} style={inputStyle} />
          </label>

          {/* Date-to filter */}
          <label style={{ fontSize: 13 }}>
            <span style={{ display: 'block', marginBottom: 6, color: 'var(--color-text-muted)' }}>To</span>
            <input type="date" name="date_to" defaultValue={filters.dateTo} style={inputStyle} />
          </label>

          {/* Actor filter */}
          <label style={{ fontSize: 13 }}>
            <span style={{ display: 'block', marginBottom: 6, color: 'var(--color-text-muted)' }}>Actor</span>
            <select name="actor" defaultValue={filters.actor} style={inputStyle}>
              <option value="">All actors</option>
              {actors.map((actor) => (
                <option key={actor.id} value={actor.id}>
                  {actor.name}
                </option>
              ))}
            </select>
          </label>

          {/* Action type filter */}
          <label style={{ fontSize: 13 }}>
            <span style={{ display: 'block', marginBottom: 6, color: 'var(--color-text-muted)' }}>Action type</span>
            <select name="action" defaultValue={filters.action} style={inputStyle}>
              <option value="">All actions</option>
              {options.actions.map((action) => (
                <option key={action} value={action}>
                  {action}
                </option>
              ))}
            </select>
          </label>

          {/* Entity type filter */}
          <label style={{ fontSize: 13 }}>
            <span style={{ display: 'block', marginBottom: 6, color: 'var(--color-text-muted)' }}>Entity type</span>
            <select name="entity_type" defaultValue={filters.entityType} style={inputStyle}>
              <option value="">All entities</option>
              {options.entityTypes.map((entityType) => (
                <option key={entityType} value={entityType}>
                  {entityType}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center" style={{ marginTop: 14 }}>
          <button type="submit" className="btn-primary" style={{ padding: '8px 16px', borderRadius: 8 }}>
            Apply filters
          </button>
          <Link href="/dashboard/owner/audit" className="btn-outline" style={{ padding: '8px 16px', borderRadius: 8 }}>
            Clear filters
          </Link>
        </div>
      </form>
    </Card>
  )
}

/**
 * Renders the standard audit empty state.
 */
function EmptyAuditState() {
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
          <path d="M9 11l3 3L22 4" />
          <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
        </svg>
      </div>
      <div>
        <h2 style={{ fontSize: '20px', fontWeight: 600, color: 'var(--color-text-primary)', margin: 0 }}>
          No audit entries found
        </h2>
        <p style={{ fontSize: '14px', color: 'var(--color-text-muted)', marginTop: '8px' }}>
          Try clearing filters or checking a wider date range.
        </p>
      </div>
      <Link href="/dashboard/owner/audit" className="btn-primary" style={{ padding: '10px 20px', borderRadius: 8 }}>
        Clear filters
      </Link>
    </div>
  )
}

/**
 * Renders an old/new JSONB summary cell with subtle diff styling.
 */
function DiffSummary({ value, tone }: { value: JsonValue; tone: 'old' | 'new' }) {
  const isOld = tone === 'old'

  return (
    <span
      style={{
        display: 'inline-block',
        maxWidth: 260,
        borderRadius: 8,
        padding: '6px 8px',
        backgroundColor: isOld ? 'var(--color-danger-light)' : 'var(--color-success-light)',
        color: isOld ? 'var(--color-danger)' : 'var(--color-success)',
        fontSize: 12,
        lineHeight: 1.4,
      }}
    >
      {summarizeJsonValue(value)}
    </span>
  )
}

/**
 * Owner audit log dashboard view.
 */
export default function AuditPageView({ logs, actors, filters, options, metrics, totalPages }: Props) {
  const previousPage = Math.max(1, filters.page - 1)
  const nextPage = Math.min(totalPages, filters.page + 1)

  return (
    <div className="flex flex-col gap-6">
      {/* Page header */}
      <div>
        <h1
          className="font-bold"
          style={{
            fontSize: '22px',
            color: 'var(--color-text-primary)',
            letterSpacing: '-0.3px',
          }}
        >
          Audit log
        </h1>
        <p style={{ fontSize: '14px', color: 'var(--color-text-muted)', marginTop: '4px' }}>
          Review the immutable record of important changes across the business.
        </p>
      </div>

      {/* Summary metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <MetricCard label="Matching entries" value={String(metrics.totalMatching)} />
        <MetricCard label="Actors" value={String(metrics.actorCount)} />
        <MetricCard label="Action types" value={String(metrics.actionTypeCount)} />
        <MetricCard label="Entity types" value={String(metrics.entityTypeCount)} />
      </div>

      {/* URL-backed filters */}
      <AuditFilterBar actors={actors} filters={filters} options={options} />

      {/* Audit log table */}
      <Card padding="md">
        <CardHeader
          title="Audit trail"
          action={
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
              Page {filters.page} of {totalPages}
            </span>
          }
        />

        {logs.length === 0 ? (
          <EmptyAuditState />
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderSpacing: 0 }}>
                <thead>
                  <tr style={{ textAlign: 'left' }}>
                    {['Timestamp', 'Actor', 'Action', 'Entity type', 'Entity ID', 'Old value', 'New value', 'Details'].map((heading) => (
                      <th key={heading} style={{ padding: '12px', fontSize: '12px', color: 'var(--color-text-muted)' }}>
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log, index) => (
                    <tr
                      key={log.id}
                      style={{
                        backgroundColor: index % 2 === 0 ? 'var(--color-background)' : 'var(--color-surface)',
                      }}
                    >
                      <td style={{ padding: '12px', fontSize: '13px', color: 'var(--color-text-primary)' }}>
                        {formatDateTimeLabel(log.created_at)}
                      </td>
                      <td style={{ padding: '12px', fontSize: '13px', color: 'var(--color-text-primary)' }}>
                        <div>
                          <p style={{ margin: 0, color: 'var(--color-text-primary)' }}>{log.actor_name}</p>
                          {log.actor_email && (
                            <p style={{ marginTop: 4, color: 'var(--color-text-muted)', fontSize: 12 }}>
                              {log.actor_email}
                            </p>
                          )}
                        </div>
                      </td>
                      <td style={{ padding: '12px' }}>
                        <Badge variant={getActionVariant(log.action)}>{log.action}</Badge>
                      </td>
                      <td style={{ padding: '12px', fontSize: '13px', color: 'var(--color-text-primary)' }}>
                        {log.entity_type}
                      </td>
                      <td style={{ padding: '12px', fontSize: '13px', color: 'var(--color-text-primary)' }}>
                        <span title={log.entity_id}>{truncateEntityId(log.entity_id)}</span>
                      </td>
                      <td style={{ padding: '12px' }}>
                        <DiffSummary value={log.old_value} tone="old" />
                      </td>
                      <td style={{ padding: '12px' }}>
                        <DiffSummary value={log.new_value} tone="new" />
                      </td>
                      <td style={{ padding: '12px' }}>
                        <AuditDetailsButton log={log} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* URL-backed pagination */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between" style={{ marginTop: 16 }}>
              <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: 0 }}>
                Showing up to 50 immutable audit entries per page.
              </p>
              <div className="flex gap-2">
                {filters.page <= 1 ? (
                  <span className="btn-outline" style={{ padding: '8px 16px', borderRadius: 8, opacity: 0.65 }}>
                    Previous
                  </span>
                ) : (
                  <Link href={buildAuditHref(filters, previousPage)} className="btn-outline" style={{ padding: '8px 16px', borderRadius: 8 }}>
                    Previous
                  </Link>
                )}
                {filters.page >= totalPages ? (
                  <span className="btn-outline" style={{ padding: '8px 16px', borderRadius: 8, opacity: 0.65 }}>
                    Next
                  </span>
                ) : (
                  <Link href={buildAuditHref(filters, nextPage)} className="btn-primary" style={{ padding: '8px 16px', borderRadius: 8 }}>
                    Next
                  </Link>
                )}
              </div>
            </div>
          </>
        )}
      </Card>
    </div>
  )
}
