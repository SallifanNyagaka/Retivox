/**
 * Operational risk alert panel for owner/admin dashboards.
 */

import Link from 'next/link'
import { Badge } from '../ui/Badge'
import { Card, CardHeader } from '../ui/Card'
import type { OperationalAlert } from '../../lib/dashboard/operationalAlerts'

function getSeverityBadge(severity: OperationalAlert['severity']) {
  if (severity === 'high') return 'danger'
  if (severity === 'medium') return 'warning'
  return 'muted'
}

export default function OperationalAlertsPanel({ alerts }: { alerts: OperationalAlert[] }) {
  return (
    <Card padding="md">
      <CardHeader title="Operational alerts" />
      {alerts.length === 0 ? (
        <p style={{ margin: 0, fontSize: 14, color: 'var(--color-text-muted)' }}>
          No unusual store activity detected right now.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {alerts.map((alert) => (
            <div
              key={alert.id}
              className="rounded-xl"
              style={{
                border: '1px solid var(--color-border)',
                backgroundColor: 'var(--color-background)',
                padding: 14,
              }}
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={getSeverityBadge(alert.severity)}>
                      {alert.severity}
                    </Badge>
                    <span style={{ fontSize: 12, color: 'var(--color-text-muted)', textTransform: 'capitalize' }}>
                      {alert.category}
                    </span>
                    {alert.branchName && (
                      <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                        {alert.branchName}
                      </span>
                    )}
                  </div>
                  <p style={{ margin: '8px 0 0', fontSize: 14, fontWeight: 800, color: 'var(--color-text-primary)' }}>
                    {alert.title}
                  </p>
                  <p style={{ margin: '4px 0 0', fontSize: 13, lineHeight: 1.5, color: 'var(--color-text-muted)' }}>
                    {alert.description}
                  </p>
                </div>
                <Link href={alert.href} className="btn-outline" style={{ padding: '7px 12px', borderRadius: 8, fontSize: 12, whiteSpace: 'nowrap' }}>
                  Review
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}
