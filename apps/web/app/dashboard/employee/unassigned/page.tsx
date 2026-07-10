/**
 * Unassigned employee account page.
 *
 * This page is shown when an employee has no valid single active branch
 * assignment. It deliberately avoids showing any operational business data.
 */

import { Card } from '../../../../components/ui/Card'

/**
 * UnassignedEmployeePage renders the missing assignment notice.
 */
export default function UnassignedEmployeePage() {
  return (
    <Card padding="md">
      <div className="flex flex-col items-center justify-center text-center" style={{ padding: '48px 20px', gap: 14 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-text-primary)', letterSpacing: '-0.3px', margin: 0 }}>
          Branch assignment needed
        </h1>
        <p style={{ fontSize: 14, color: 'var(--color-text-muted)', margin: 0 }}>
          Your employee account does not have one active branch assignment. Please contact your manager.
        </p>
      </div>
    </Card>
  )
}
