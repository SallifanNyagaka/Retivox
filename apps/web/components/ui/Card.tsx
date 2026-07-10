/**
 * Retivox Card Component
 *
 * Reusable card container used across all dashboards in the Retivox retail SaaS.
 * Server component — no client JS needed.
 * Uses CSS variables for colors, borders, radii and shadows.
 */

import type { ReactNode } from 'react'

type Padding = 'sm' | 'md' | 'lg'

const PADDING_MAP: Record<Padding, string> = {
  sm: '12px',
  md: '16px',
  lg: '24px',
}

export interface CardProps {
  /** Content rendered inside the card */
  children: ReactNode
  /** Optional additional className */
  className?: string
  /** Optional inline style overrides */
  style?: React.CSSProperties
  /** Padding size — default md */
  padding?: Padding
  /** Enables hover shadow transition — default false */
  hoverable?: boolean
}

/**
 * Card — generic reusable container for dashboard sections.
 * Uses CSS variables so the design system controls appearance globally.
 */
export function Card({
  children,
  className = '',
  style,
  padding = 'md',
  hoverable = false,
}: CardProps) {
  return (
    <div
      className={`${hoverable ? 'transition-shadow duration-200 hover:shadow-card-hover' : ''} ${className}`.trim()}
      style={{
        backgroundColor: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-card)',
        boxShadow: 'var(--shadow-card)',
        padding: PADDING_MAP[padding],
        ...style,
      }}
    >
      {children}
    </div>
  )
}

export interface CardHeaderProps {
  /** Title text on the left */
  title: string
  /** Optional action slot on the right — links, buttons etc */
  action?: ReactNode
  /** Optional additional className */
  className?: string
}

/**
 * CardHeader — renders title left, optional action right.
 * Used at the top of every dashboard card.
 */
export function CardHeader({ title, action, className = '' }: CardHeaderProps) {
  return (
    <div
      className={`flex items-center justify-between gap-3 ${className}`.trim()}
      style={{ marginBottom: '14px' }}
    >
      <CardTitle>{title}</CardTitle>
      {action && <div>{action}</div>}
    </div>
  )
}

export interface CardTitleProps {
  /** Content to render as the title */
  children: ReactNode
  /** Optional additional className */
  className?: string
}

/**
 * CardTitle — 14px medium weight title for card headers.
 */
export function CardTitle({ children, className = '' }: CardTitleProps) {
  return (
    <h3
      className={className}
      style={{
        fontSize: '14px',
        fontWeight: 500,
        color: 'var(--color-text-primary)',
        margin: 0,
      }}
    >
      {children}
    </h3>
  )
}