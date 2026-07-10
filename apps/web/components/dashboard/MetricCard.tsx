/**
 * MetricCard
 *
 * Displays a single KPI metric with label, value, delta and optional icon.
 * Used on owner and admin dashboards to surface key performance indicators.
 * Server component — no client JS needed.
 */

import type { ReactNode } from 'react'
import { Card } from '../ui/Card'

/**
 * Props for the MetricCard component.
 */
export type MetricCardProps = {
  /** Short label describing the metric e.g. "Total revenue" */
  label: string
  /** Primary metric value as formatted string e.g. "KES 84,320" */
  value: string
  /** Optional delta string e.g. "+12% vs yesterday" */
  delta?: string
  /**
   * Direction of delta — controls color and prefix arrow.
   * up = success color + ↑
   * down = danger color + ↓
   * neutral = muted color, no prefix
   * Default: neutral
   */
  deltaType?: 'up' | 'down' | 'neutral'
  /** Optional icon shown top right — pass an SVG or React node */
  icon?: ReactNode
  /** CSS color for the value text — default var(--color-text-primary) */
  valueColor?: string
}

/**
 * MetricCard — renders a single KPI card with label, value, delta and icon.
 */
export function MetricCard({
  label,
  value,
  delta,
  deltaType = 'neutral',
  icon,
  valueColor = 'var(--color-text-primary)',
}: MetricCardProps) {
  // Delta prefix arrow based on direction
  const deltaPrefix = deltaType === 'up' ? '↑ ' : deltaType === 'down' ? '↓ ' : ''

  // Delta color based on direction
  const deltaColor =
    deltaType === 'up'
      ? 'var(--color-success)'
      : deltaType === 'down'
      ? 'var(--color-danger)'
      : 'var(--color-text-muted)'

  return (
    <Card padding="md">
      {/* Top row — label left, icon right */}
      <div className="flex items-center justify-between gap-2">
        <p
          style={{
            fontSize: '12px',
            color: 'var(--color-text-muted)',
            margin: 0,
          }}
        >
          {label}
        </p>
        {icon && (
          <div
            style={{
              width: '20px',
              height: '20px',
              color: 'var(--color-text-muted)',
              flexShrink: 0,
            }}
          >
            {icon}
          </div>
        )}
      </div>

      {/* Value */}
      <div
        style={{
          fontSize: '22px',
          fontWeight: 600,
          marginTop: '6px',
          lineHeight: 1,
          color: valueColor,
        }}
      >
        {value}
      </div>

      {/* Delta */}
      {delta && (
        <div
          style={{
            fontSize: '12px',
            marginTop: '6px',
            color: deltaColor,
          }}
        >
          {deltaPrefix}{delta}
        </div>
      )}
    </Card>
  )
}