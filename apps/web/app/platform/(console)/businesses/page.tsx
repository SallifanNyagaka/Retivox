import { Badge } from '../../../../components/ui/Badge'
import { Card, CardHeader } from '../../../../components/ui/Card'
import { createServiceRoleClient } from '../../../../lib/supabase/admin'
import { effectiveSubscriptionStatus } from '../../../../lib/subscriptions/status'
import LicenseAdjustmentForm from './LicenseAdjustmentForm'

export const dynamic = 'force-dynamic'

type BusinessSubscription = {
  id: string
  plan: string
  status: string
  cancelled_at: string | null
  license_type: string
  license_suspended_at: string | null
  monthly_amount: number
  currency: string
  current_period_end: string | null
}

type BusinessRow = {
  id: string
  name: string
  country: string
  currency: string
  subscription_plan: string
  subscription_status: string
  created_at: string
  subscriptions: BusinessSubscription[] | BusinessSubscription | null
}

function normalizeJoin<Row>(value: Row | Row[] | null | undefined): Row | null {
  if (!value) return null
  return Array.isArray(value) ? value[0] ?? null : value
}

function formatMoney(amount: number, currency: string) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount)
}

function variant(status: string): 'success' | 'warning' | 'danger' | 'muted' {
  if (status === 'active') return 'success'
  if (status === 'expired' || status === 'cancelled') return 'danger'
  return 'warning'
}

export default async function PlatformBusinessesPage() {
  const serviceClient = createServiceRoleClient()
  const [{ data, error }, { data: planRows }] = await Promise.all([serviceClient
    .from('businesses')
    .select('id, name, country, currency, subscription_plan, subscription_status, created_at, subscriptions(id, plan, status, cancelled_at, license_type, license_suspended_at, monthly_amount, currency, current_period_end)')
    .order('created_at', { ascending: false })
    .limit(100), serviceClient.from('platform_subscription_plans').select('plan_key,name').eq('is_active', true).neq('plan_key', 'trial').order('sort_order')])

  if (error) {
    throw new Error(error.message)
  }

  const businesses = (data ?? []) as BusinessRow[]

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 900, color: 'var(--color-text-primary)' }}>Businesses</h1>
        <p style={{ margin: '6px 0 0', fontSize: 14, color: 'var(--color-text-muted)' }}>
          All businesses registered on Retivox.
        </p>
      </div>

      <Card padding="md">
        <CardHeader title="Registered businesses" />
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderSpacing: 0 }}>
            <thead>
              <tr style={{ textAlign: 'left' }}>
                {['Business', 'Country', 'Plan', 'Monthly', 'Renewal', 'Status', 'License controls'].map((heading) => (
                  <th key={heading} style={{ padding: 12, color: 'var(--color-text-muted)', fontSize: 12 }}>{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {businesses.map((business, index) => {
                const subscription = normalizeJoin(business.subscriptions)
                const effectiveStatus = effectiveSubscriptionStatus(
                  subscription?.cancelled_at ? 'cancelled' : subscription?.plan === 'trial' ? 'trial' : subscription?.status ?? business.subscription_status,
                  subscription?.current_period_end,
                  Date.now(),
                  { isTrial: subscription?.plan === 'trial', cancelledAt: subscription?.cancelled_at },
                )
                return (
                  <tr key={business.id} style={{ backgroundColor: index % 2 === 0 ? 'var(--color-background)' : 'var(--color-surface)' }}>
                    <td style={{ padding: 12, color: 'var(--color-text-primary)', fontWeight: 700 }}>{business.name}</td>
                    <td style={{ padding: 12, color: 'var(--color-text-muted)' }}>{business.country}</td>
                    <td style={{ padding: 12, color: 'var(--color-text-primary)' }}>{subscription?.plan ?? business.subscription_plan}</td>
                    <td style={{ padding: 12, color: 'var(--color-text-primary)' }}>
                      {formatMoney(Number(subscription?.monthly_amount ?? 0), subscription?.currency ?? business.currency)}
                    </td>
                    <td style={{ padding: 12, color: 'var(--color-text-muted)' }}>
                      {subscription?.current_period_end ? new Date(subscription.current_period_end).toLocaleDateString() : '-'}
                    </td>
                    <td style={{ padding: 12 }}>
                      <Badge variant={subscription?.license_suspended_at ? 'danger' : variant(effectiveStatus)}>
                        {subscription?.license_suspended_at ? 'suspended' : effectiveStatus}
                      </Badge>
                    </td>
                    <td style={{ padding: 12, minWidth: 260 }}>
                      <details>
                        <summary style={{ cursor: 'pointer', color: 'var(--color-primary)', fontWeight: 750 }}>Manage license</summary>
                        {subscription && <LicenseAdjustmentForm
                          key={`${business.id}-${subscription.license_suspended_at ? 'suspended' : 'active'}`}
                          businessId={business.id}
                          businessName={business.name}
                          isSuspended={Boolean(subscription.license_suspended_at)}
                          plans={(planRows ?? []).map((plan) => ({ key: plan.plan_key, name: plan.name }))}
                        />}
                      </details>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
