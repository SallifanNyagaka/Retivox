/**
 * Global deactivated account notice.
 *
 * This route is outside the dashboard shell so inactive employee accounts can
 * be redirected here without rendering any protected dashboard data.
 */

import { Card } from '../../../components/ui/Card'

/**
 * AccountDeactivatedPage renders a safe inactive-account message.
 */
export default function AccountDeactivatedPage() {
  return (
    <main
      className="min-h-screen px-4 py-10"
      style={{
        backgroundColor: 'var(--color-background)',
        color: 'var(--color-text-primary)',
      }}
    >
      <div className="mx-auto max-w-lg">
        <Card padding="md">
          <div className="flex flex-col items-center justify-center text-center" style={{ padding: '48px 20px', gap: 14 }}>
            <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.3px', margin: 0 }}>
              Account deactivated
            </h1>
            <p style={{ fontSize: 14, color: 'var(--color-text-muted)', margin: 0 }}>
              Your employee account has been deactivated. Please contact your manager for help.
            </p>
          </div>
        </Card>
      </div>
    </main>
  )
}
