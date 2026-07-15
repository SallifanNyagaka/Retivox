import Link from 'next/link'
import type { ReactNode } from 'react'
import { Building2, CreditCard, Moon, ShieldAlert, Tags } from 'lucide-react'
import { Badge } from '../../../components/ui/Badge'
import { Card, CardHeader } from '../../../components/ui/Card'
import { createServiceRoleClient } from '../../../lib/supabase/admin'

export const dynamic = 'force-dynamic'

type BusinessRow = {
  id: string
  name: string
  subscription_plan: string
  subscription_status: string
  created_at: string
}

type SubscriptionRow = {
  business_id: string
  monthly_amount: number
  currency: string
  current_period_end: string | null
}

type PaymentRequestRow = {
  id: string
  business_id: string
  amount: number
  currency: string
  status: 'pending' | 'verified' | 'rejected'
  payment_method: string
  reference_code: string
  submitted_at: string
  businesses: { name: string } | Array<{ name: string }> | null
}

function normalizeJoin<Row>(value: Row | Row[] | null | undefined): Row | null {
  if (!value) return null
  return Array.isArray(value) ? value[0] ?? null : value
}

function formatMoney(amount: number, currency: string) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount)
}

function statusVariant(status: string): 'success' | 'warning' | 'danger' | 'muted' {
  if (status === 'active' || status === 'verified') return 'success'
  if (status === 'rejected' || status === 'expired' || status === 'cancelled') return 'danger'
  return 'warning'
}

export default async function PlatformOverviewPage() {
  const serviceClient = createServiceRoleClient()
  const [businessCountResponse, businessesResponse, subscriptionsResponse, paymentsResponse, attemptsResponse] = await Promise.all([
    serviceClient
      .from('businesses')
      .select('id', { count: 'exact', head: true }),
    serviceClient
      .from('businesses')
      .select('id, name, subscription_plan, subscription_status, created_at')
      .order('created_at', { ascending: false })
      .limit(8),
    serviceClient
      .from('subscriptions')
      .select('business_id, monthly_amount, currency, current_period_end'),
    serviceClient
      .from('subscription_payment_requests')
      .select('id, business_id, amount, currency, status, payment_method, reference_code, submitted_at, businesses(name)')
      .order('submitted_at', { ascending: false })
      .limit(8),
    serviceClient
      .from('platform_login_attempts')
      .select('id', { count: 'exact', head: true })
      .eq('success', false),
  ])

  const businesses = (businessesResponse.data ?? []) as BusinessRow[]
  const subscriptions = (subscriptionsResponse.data ?? []) as SubscriptionRow[]
  const payments = (paymentsResponse.data ?? []) as PaymentRequestRow[]
  const subscriptionByBusinessId = new Map(subscriptions.map((subscription) => [subscription.business_id, subscription]))
  const monthlyTotal = subscriptions.reduce((sum, subscription) => sum + Number(subscription.monthly_amount ?? 0), 0)

  return (
    <div className="flex flex-col gap-6">
      <section
        className="rounded-3xl"
        style={{
          background: 'linear-gradient(135deg, #17201c 0%, #315342 62%, #d6a143 150%)',
          color: '#fff8ec',
          padding: 30,
          boxShadow: '0 24px 70px rgba(23,32,28,0.2)',
        }}
      >
        <p style={{ margin: 0, color: 'rgba(255,248,236,0.72)', fontSize: 12, fontWeight: 850, textTransform: 'uppercase' }}>
          Retivox operations
        </p>
        <h1 style={{ margin: '10px 0 0', fontSize: 36, fontWeight: 950, letterSpacing: '-0.055em' }}>
          Platform command center
        </h1>
        <p style={{ margin: '10px 0 0', maxWidth: 760, fontSize: 14, lineHeight: 1.7, color: 'rgba(255,248,236,0.76)' }}>
          Manage tenant accounts, package pricing, payment receiving details, dormant-account cleanup, login security, and published owner testimonials.
        </p>
      </section>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <MetricCard label="Businesses" value={businessCountResponse.count ?? businesses.length} />
        <MetricCard label="MRR snapshot" value={formatMoney(monthlyTotal, 'KES')} />
        <MetricCard label="Recent payments" value={payments.length} />
        <MetricCard label="Failed logins" value={attemptsResponse.count ?? 0} />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
        <QuickAction href="/platform/businesses" label="Businesses" icon={<Building2 size={18} />} />
        <QuickAction href="/platform/pricing" label="Pricing" icon={<Tags size={18} />} />
        <QuickAction href="/platform/payments" label="M-Pesa" icon={<CreditCard size={18} />} />
        <QuickAction href="/platform/dormant" label="Dormancy" icon={<Moon size={18} />} />
        <QuickAction href="/platform/login-attempts" label="Security" icon={<ShieldAlert size={18} />} />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card padding="md">
          <CardHeader title="Newest businesses" action={<Link href="/platform/businesses" className="btn-outline" style={{ padding: '6px 12px', borderRadius: 8 }}>View all</Link>} />
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderSpacing: 0 }}>
              <tbody>
                {businesses.map((business) => {
                  const subscription = subscriptionByBusinessId.get(business.id)
                  return (
                    <tr key={business.id}>
                      <td style={{ padding: 12, color: 'var(--color-text-primary)', fontWeight: 700 }}>{business.name}</td>
                      <td style={{ padding: 12 }}><Badge variant={statusVariant(business.subscription_status)}>{business.subscription_status}</Badge></td>
                      <td style={{ padding: 12, color: 'var(--color-text-muted)' }}>{formatMoney(Number(subscription?.monthly_amount ?? 0), subscription?.currency ?? 'KES')}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>

        <Card padding="md">
          <CardHeader title="Recent subscription payments" />
          <div className="flex flex-col gap-3">
            {payments.length === 0 ? (
              <p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: 14 }}>No subscription payments yet.</p>
            ) : payments.map((payment) => (
              <div key={payment.id} className="flex items-start justify-between gap-3 rounded-xl" style={{ border: '1px solid var(--color-border)', padding: 12 }}>
                <div>
                  <p style={{ margin: 0, fontWeight: 800, color: 'var(--color-text-primary)' }}>{normalizeJoin(payment.businesses)?.name ?? 'Unknown business'}</p>
                  <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--color-text-muted)' }}>{payment.reference_code} - {payment.payment_method}</p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <p style={{ margin: 0, fontWeight: 800, color: 'var(--color-text-primary)' }}>{formatMoney(Number(payment.amount), payment.currency)}</p>
                  <Badge variant={statusVariant(payment.status)}>{payment.status}</Badge>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  )
}

function MetricCard({ label, value }: { label: string; value: string | number }) {
  return (
    <Card padding="md">
      <p style={{ margin: 0, fontSize: 11, color: 'var(--color-text-muted)', fontWeight: 850, textTransform: 'uppercase' }}>{label}</p>
      <p style={{ margin: '8px 0 0', fontSize: 28, fontWeight: 950, color: 'var(--color-text-primary)', letterSpacing: '-0.04em' }}>{value}</p>
    </Card>
  )
}

function QuickAction({ href, label, icon }: { href: string; label: string; icon: ReactNode }) {
  return (
    <Link
      href={href}
      className="flex items-center justify-between rounded-2xl"
      style={{
        backgroundColor: 'rgba(255,255,255,0.72)',
        border: '1px solid rgba(31,45,39,0.1)',
        color: '#24332c',
        fontSize: 13,
        fontWeight: 850,
        padding: '14px 16px',
        textDecoration: 'none',
        boxShadow: '0 12px 34px rgba(31,45,39,0.08)',
      }}
    >
      {label}
      {icon}
    </Link>
  )
}
