import { Badge } from '../../../../components/ui/Badge'
import { Card, CardHeader } from '../../../../components/ui/Card'
import { createServiceRoleClient } from '../../../../lib/supabase/admin'

export const dynamic = 'force-dynamic'

type LoginAttemptRow = {
  id: string
  business_id: string | null
  email: string
  attempted_role: string | null
  surface: 'tenant' | 'platform'
  success: boolean
  failure_reason: string | null
  ip_address: string | null
  created_at: string
  businesses: { name: string } | Array<{ name: string }> | null
}

function normalizeJoin<Row>(value: Row | Row[] | null | undefined): Row | null {
  if (!value) return null
  return Array.isArray(value) ? value[0] ?? null : value
}

export default async function PlatformLoginAttemptsPage() {
  const serviceClient = createServiceRoleClient()
  const { data, error } = await serviceClient
    .from('platform_login_attempts')
    .select('id, business_id, email, attempted_role, surface, success, failure_reason, ip_address, created_at, businesses(name)')
    .order('created_at', { ascending: false })
    .limit(200)

  if (error) {
    throw new Error(error.message)
  }

  const attempts = (data ?? []) as LoginAttemptRow[]

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 900, color: 'var(--color-text-primary)' }}>Login attempts</h1>
        <p style={{ margin: '6px 0 0', fontSize: 14, color: 'var(--color-text-muted)' }}>
          Successful and unsuccessful tenant/platform logins across Retivox.
        </p>
      </div>

      <Card padding="md">
        <CardHeader title="Latest login activity" />
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderSpacing: 0 }}>
            <thead>
              <tr style={{ textAlign: 'left' }}>
                {['Time', 'Email', 'Business', 'Surface', 'Role', 'Result', 'Reason', 'IP'].map((heading) => (
                  <th key={heading} style={{ padding: 12, color: 'var(--color-text-muted)', fontSize: 12 }}>{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {attempts.map((attempt, index) => (
                <tr key={attempt.id} style={{ backgroundColor: index % 2 === 0 ? 'var(--color-background)' : 'var(--color-surface)' }}>
                  <td style={{ padding: 12, color: 'var(--color-text-muted)', fontSize: 13 }}>{new Date(attempt.created_at).toLocaleString()}</td>
                  <td style={{ padding: 12, color: 'var(--color-text-primary)', fontWeight: 700 }}>{attempt.email}</td>
                  <td style={{ padding: 12, color: 'var(--color-text-muted)' }}>{normalizeJoin(attempt.businesses)?.name ?? '-'}</td>
                  <td style={{ padding: 12, color: 'var(--color-text-primary)' }}>{attempt.surface}</td>
                  <td style={{ padding: 12, color: 'var(--color-text-muted)' }}>{attempt.attempted_role ?? '-'}</td>
                  <td style={{ padding: 12 }}>
                    <Badge variant={attempt.success ? 'success' : 'danger'}>{attempt.success ? 'Success' : 'Failed'}</Badge>
                  </td>
                  <td style={{ padding: 12, color: 'var(--color-text-muted)' }}>{attempt.failure_reason ?? '-'}</td>
                  <td style={{ padding: 12, color: 'var(--color-text-muted)' }}>{attempt.ip_address ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
