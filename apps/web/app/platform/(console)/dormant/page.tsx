import { AlertTriangle, MailWarning, PauseCircle, Trash2 } from 'lucide-react'
import { Badge } from '../../../../components/ui/Badge'
import { Card, CardHeader } from '../../../../components/ui/Card'
import { createServiceRoleClient } from '../../../../lib/supabase/admin'
import { deactivateBusiness, deleteDormantBusiness, warnDormantBusiness } from '../actions'

export const dynamic = 'force-dynamic'

type BusinessRow = {
  id: string
  name: string
  country: string
  created_at: string
  subscription_status: string
  platform_status: string
  is_active: boolean
  dormancy_warning_sent_at: string | null
  dormant_delete_after: string | null
  deactivated_at: string | null
  platform_status_note: string | null
}

type OwnerRow = {
  business_id: string
  name: string
  email: string
}

type ActivityRow = {
  business_id: string
  created_at?: string
  recorded_at?: string
}

type DormantBusiness = BusinessRow & {
  owner: OwnerRow | null
  lastActivityAt: string
  inactiveDays: number
  stage: 'watch' | 'warn' | 'delete'
}

const DAY_MS = 24 * 60 * 60 * 1000
const WARN_DAYS = 90
const DELETE_DAYS = 180

function formatDate(value: string | null) {
  if (!value) return '-'
  return new Date(value).toLocaleDateString()
}

function maxDate(...values: Array<string | null | undefined>) {
  return values.filter(Boolean).sort((a, b) => new Date(b as string).getTime() - new Date(a as string).getTime())[0] ?? new Date(0).toISOString()
}

function statusVariant(stage: DormantBusiness['stage']): 'warning' | 'danger' | 'muted' {
  if (stage === 'delete') return 'danger'
  if (stage === 'warn') return 'warning'
  return 'muted'
}

export default async function PlatformDormantPage() {
  const serviceClient = createServiceRoleClient()
  const [businessesResponse, ownersResponse, loginActivityResponse, transactionActivityResponse] = await Promise.all([
    serviceClient
      .from('businesses')
      .select('id, name, country, created_at, subscription_status, platform_status, is_active, dormancy_warning_sent_at, dormant_delete_after, deactivated_at, platform_status_note')
      .order('created_at', { ascending: false })
      .limit(500),
    serviceClient
      .from('users')
      .select('business_id, name, email')
      .eq('global_role', 'owner')
      .order('created_at', { ascending: true })
      .limit(1000),
    serviceClient
      .from('platform_login_attempts')
      .select('business_id, created_at')
      .eq('surface', 'tenant')
      .eq('success', true)
      .not('business_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(2000),
    serviceClient
      .from('transactions')
      .select('business_id, recorded_at')
      .order('recorded_at', { ascending: false })
      .limit(2000),
  ])

  if (businessesResponse.error || ownersResponse.error || loginActivityResponse.error || transactionActivityResponse.error) {
    return (
      <Card padding="md">
        <CardHeader title="Dormancy setup needed" />
        <p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: 14 }}>
          Apply migration 049_platform_operations_console.sql to detect dormant businesses and manage lifecycle actions here.
        </p>
      </Card>
    )
  }

  const ownersByBusiness = new Map<string, OwnerRow>()
  for (const owner of (ownersResponse.data ?? []) as OwnerRow[]) {
    if (!ownersByBusiness.has(owner.business_id)) {
      ownersByBusiness.set(owner.business_id, owner)
    }
  }

  const loginByBusiness = new Map<string, string>()
  for (const login of (loginActivityResponse.data ?? []) as ActivityRow[]) {
    if (login.business_id && login.created_at && !loginByBusiness.has(login.business_id)) {
      loginByBusiness.set(login.business_id, login.created_at)
    }
  }

  const transactionByBusiness = new Map<string, string>()
  for (const transaction of (transactionActivityResponse.data ?? []) as ActivityRow[]) {
    if (transaction.business_id && transaction.recorded_at && !transactionByBusiness.has(transaction.business_id)) {
      transactionByBusiness.set(transaction.business_id, transaction.recorded_at)
    }
  }

  const now = Date.now()
  const dormantBusinesses = ((businessesResponse.data ?? []) as BusinessRow[])
    .map((business) => {
      const lastActivityAt = maxDate(
        loginByBusiness.get(business.id),
        transactionByBusiness.get(business.id),
        business.created_at
      )
      const inactiveDays = Math.floor((now - new Date(lastActivityAt).getTime()) / DAY_MS)
      const stage: DormantBusiness['stage'] = inactiveDays >= DELETE_DAYS ? 'delete' : inactiveDays >= WARN_DAYS ? 'warn' : 'watch'

      return {
        ...business,
        owner: ownersByBusiness.get(business.id) ?? null,
        lastActivityAt,
        inactiveDays,
        stage,
      }
    })
    .filter((business) => business.inactiveDays >= WARN_DAYS || business.platform_status !== 'active')
    .sort((a, b) => b.inactiveDays - a.inactiveDays)

  const warningCount = dormantBusinesses.filter((business) => business.stage === 'warn').length
  const deleteCount = dormantBusinesses.filter((business) => business.stage === 'delete').length
  const deactivatedCount = dormantBusinesses.filter((business) => business.platform_status === 'deactivated').length

  return (
    <div className="flex flex-col gap-6">
      <section
        className="rounded-3xl"
        style={{
          background: 'linear-gradient(135deg, #2b2b22 0%, #755f30 100%)',
          color: '#fff8ec',
          padding: 28,
          boxShadow: '0 24px 60px rgba(43,43,34,0.18)',
        }}
      >
        <p style={{ margin: 0, color: 'rgba(255,248,236,0.72)', fontSize: 12, fontWeight: 850, textTransform: 'uppercase' }}>
          Account lifecycle
        </p>
        <h1 style={{ margin: '10px 0 0', fontSize: 32, fontWeight: 950, letterSpacing: '-0.05em' }}>
          Dormant businesses
        </h1>
        <p style={{ margin: '10px 0 0', maxWidth: 740, color: 'rgba(255,248,236,0.78)', fontSize: 14, lineHeight: 1.7 }}>
          Accounts inactive for 3 months should receive an owner warning. Accounts inactive for 6 months can be permanently deleted after a warning is recorded.
        </p>
      </section>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Metric label="Need warning" value={warningCount} />
        <Metric label="Deletion candidates" value={deleteCount} />
        <Metric label="Already deactivated" value={deactivatedCount} />
      </div>

      <Card padding="md">
        <CardHeader title="Dormancy queue" />
        {dormantBusinesses.length === 0 ? (
          <p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: 14 }}>
            No dormant accounts need action right now.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {dormantBusinesses.map((business) => (
              <article
                key={business.id}
                className="rounded-2xl"
                style={{
                  border: '1px solid var(--color-border)',
                  backgroundColor: 'var(--color-background)',
                  padding: 16,
                }}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 style={{ margin: 0, color: 'var(--color-text-primary)', fontSize: 17, fontWeight: 900 }}>
                      {business.name}
                    </h2>
                    <p style={{ margin: '5px 0 0', color: 'var(--color-text-muted)', fontSize: 12 }}>
                      Owner: {business.owner?.email ?? 'No owner email'} - {business.country}
                    </p>
                  </div>
                  <Badge variant={statusVariant(business.stage)}>
                    {business.inactiveDays} days inactive
                  </Badge>
                </div>

                <div className="grid grid-cols-2 gap-3" style={{ marginTop: 14 }}>
                  <Info label="Last activity" value={formatDate(business.lastActivityAt)} />
                  <Info label="Platform status" value={business.platform_status} />
                  <Info label="Warning sent" value={formatDate(business.dormancy_warning_sent_at)} />
                  <Info label="Deactivate/delete after" value={formatDate(business.dormant_delete_after)} />
                </div>

                {business.platform_status_note && (
                  <p style={{ margin: '12px 0 0', color: 'var(--color-text-muted)', fontSize: 12, lineHeight: 1.5 }}>
                    Note: {business.platform_status_note}
                  </p>
                )}

                <div className="grid grid-cols-1 gap-2 md:grid-cols-3" style={{ marginTop: 14 }}>
                  <form action={warnDormantBusiness}>
                    <input type="hidden" name="businessId" value={business.id} />
                    <button type="submit" className="btn-outline" style={actionButtonStyle}>
                      <MailWarning size={15} />
                      Warn
                    </button>
                  </form>

                  <form action={deactivateBusiness}>
                    <input type="hidden" name="businessId" value={business.id} />
                    <input type="hidden" name="note" value="Deactivated after dormancy review." />
                    <button type="submit" className="btn-outline" style={actionButtonStyle}>
                      <PauseCircle size={15} />
                      Deactivate
                    </button>
                  </form>

                  <form action={deleteDormantBusiness} className="flex flex-col gap-2">
                    <input type="hidden" name="businessId" value={business.id} />
                    <input
                      name="confirmation"
                      placeholder="Type DELETE"
                      style={{
                        border: '1px solid var(--color-border)',
                        borderRadius: 8,
                        padding: '8px 10px',
                        fontSize: 12,
                        backgroundColor: 'var(--color-surface)',
                      }}
                    />
                    <button type="submit" className="btn-danger" style={actionButtonStyle}>
                      <Trash2 size={15} />
                      Delete
                    </button>
                  </form>
                </div>

                {business.stage === 'delete' && !business.dormancy_warning_sent_at && (
                  <p style={{ margin: '12px 0 0', color: 'var(--color-danger)', fontSize: 12, display: 'flex', gap: 6 }}>
                    <AlertTriangle size={15} />
                    Send the owner warning before permanent deletion.
                  </p>
                )}
              </article>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <Card padding="md">
      <p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: 12, textTransform: 'uppercase', fontWeight: 850 }}>
        {label}
      </p>
      <p style={{ margin: '8px 0 0', color: 'var(--color-text-primary)', fontSize: 30, fontWeight: 950 }}>
        {value}
      </p>
    </Card>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl" style={{ backgroundColor: 'var(--color-surface)', padding: 10 }}>
      <p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: 10, fontWeight: 850, textTransform: 'uppercase' }}>{label}</p>
      <p style={{ margin: '4px 0 0', color: 'var(--color-text-primary)', fontSize: 12, fontWeight: 750 }}>{value}</p>
    </div>
  )
}

const actionButtonStyle = {
  alignItems: 'center',
  borderRadius: 9,
  display: 'inline-flex',
  gap: 6,
  justifyContent: 'center',
  padding: '8px 10px',
  width: '100%',
}
