/**
 * Reusable status badge component for Retivox dashboards.
 *
 * This component is used across the dashboard experience to render
 * small status indicators such as success, warning, danger, info, and muted.
 * It is implemented as a server component and uses CSS variables for styling.
 */
import type { ReactNode } from 'react';

export type BadgeVariant = 'success' | 'warning' | 'danger' | 'info' | 'muted';

type BadgeProps = {
  variant: BadgeVariant;
  children: ReactNode;
  className?: string;
};

const variantStyles: Record<BadgeVariant, { backgroundColor: string; color: string }> = {
  success: {
    backgroundColor: 'var(--color-success-light)',
    color: 'var(--color-success)',
  },
  warning: {
    backgroundColor: 'var(--color-accent-light)',
    color: 'var(--color-accent)',
  },
  danger: {
    backgroundColor: 'var(--color-danger-light)',
    color: 'var(--color-danger)',
  },
  info: {
    backgroundColor: 'rgba(55,138,221,0.12)',
    color: '#378ADD',
  },
  muted: {
    backgroundColor: 'var(--color-border)',
    color: 'var(--color-text-muted)',
  },
}

/**
 * Badge displays a small status indicator with variant-specific colors.
 *
 * @param props.variant - The visual style of the badge.
 * @param props.children - Content rendered inside the badge.
 * @param props.className - Optional additional CSS classes.
 */
export function Badge({ variant, children, className }: BadgeProps) {
  const styles = variantStyles[variant];

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${className ?? ''}`.trim()}
      style={{ backgroundColor: styles.backgroundColor, color: styles.color }}
    >
      {children}
    </span>
  );
}
