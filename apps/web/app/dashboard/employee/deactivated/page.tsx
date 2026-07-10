/**
 * Deactivated employee account page.
 *
 * This page intentionally shows no business, branch, product, or transaction
 * data. It gives inactive employees a clear next step without exposing records.
 */

import { Card } from '../../../../components/ui/Card'

/**
 * DeactivatedEmployeePage renders the inactive account notice.
 */
export default function DeactivatedEmployeePage() {
  return (
    <Card padding="md">
      <div className="flex flex-col items-center justify-center text-center" style={{ padding: '48px 20px', gap: 14 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-text-primary)', letterSpacing: '-0.3px', margin: 0 }}>
          Account deactivated
        </h1>
        <p style={{ fontSize: 14, color: 'var(--color-text-muted)', margin: 0 }}>
          Your employee account has been deactivated. Please contact your manager for help.
        </p>
      </div>
    </Card>
  )
}
