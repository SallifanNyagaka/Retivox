import { Badge } from '../../../../components/ui/Badge'
import { Card, CardHeader } from '../../../../components/ui/Card'
import { createServiceRoleClient } from '../../../../lib/supabase/admin'
import { updateSubscriptionPlan } from '../actions'

export const dynamic = 'force-dynamic'

type PlanRow = {
  id: string
  plan_key: 'trial' | 'starter' | 'growth' | 'enterprise'
  name: string
  description: string
  monthly_amount: number
  currency: string
  branch_limit: number | null
  is_active: boolean
  sort_order: number
  updated_at: string
}

function formatMoney(amount: number, currency: string) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount)
}

export default async function PlatformPricingPage() {
  const serviceClient = createServiceRoleClient()
  const { data, error } = await serviceClient
    .from('platform_subscription_plans')
    .select('id, plan_key, name, description, monthly_amount, currency, branch_limit, is_active, sort_order, updated_at')
    .order('sort_order', { ascending: true })

  if (error) {
    return (
      <Card padding="md">
        <CardHeader title="Pricing setup needed" />
        <p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: 14 }}>
          Apply migration 049_platform_operations_console.sql to manage pricing packages here.
        </p>
      </Card>
    )
  }

  const plans = (data ?? []) as PlanRow[]

  return (
    <div className="flex flex-col gap-6">
      <section
        className="rounded-3xl"
        style={{
          background: 'linear-gradient(135deg, #1f2d27 0%, #395143 100%)',
          color: '#fff8ec',
          padding: 28,
          boxShadow: '0 24px 60px rgba(31,45,39,0.18)',
        }}
      >
        <p style={{ margin: 0, color: 'rgba(255,248,236,0.72)', fontSize: 12, fontWeight: 850, textTransform: 'uppercase' }}>
          Revenue controls
        </p>
        <h1 style={{ margin: '10px 0 0', fontSize: 32, fontWeight: 950, letterSpacing: '-0.05em' }}>
          Subscription package pricing
        </h1>
        <p style={{ margin: '10px 0 0', maxWidth: 680, color: 'rgba(255,248,236,0.72)', fontSize: 14, lineHeight: 1.7 }}>
          Change package pricing from here. Existing subscriptions on the same package are synced to the new amount and currency.
        </p>
      </section>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        {plans.map((plan) => (
          <Card key={plan.id} padding="md">
            <CardHeader
              title={plan.name}
              action={<Badge variant={plan.is_active ? 'success' : 'muted'}>{plan.is_active ? 'Active' : 'Hidden'}</Badge>}
            />
            <p style={{ margin: '0 0 14px', color: 'var(--color-text-muted)', fontSize: 13, lineHeight: 1.6 }}>
              Currently {formatMoney(Number(plan.monthly_amount), plan.currency)} monthly, {plan.branch_limit ? `${plan.branch_limit} branches` : 'unlimited branches'}.
            </p>

            <form action={updateSubscriptionPlan} className="grid grid-cols-1 gap-3">
              <input type="hidden" name="planKey" value={plan.plan_key} />

              <label style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text-primary)' }}>
                Package name
                <input name="name" defaultValue={plan.name} required style={inputStyle} />
              </label>

              <label style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text-primary)' }}>
                Description
                <textarea name="description" defaultValue={plan.description} rows={3} style={{ ...inputStyle, height: 'auto', paddingTop: 10, resize: 'vertical' }} />
              </label>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <label style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text-primary)' }}>
                  Monthly amount
                  <input name="monthlyAmount" type="number" min="0" step="0.01" defaultValue={plan.monthly_amount} required style={inputStyle} />
                </label>
                <label style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text-primary)' }}>
                  Currency
                  <input name="currency" maxLength={3} defaultValue={plan.currency} required style={inputStyle} />
                </label>
                <label style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text-primary)' }}>
                  Branch limit
                  <input name="branchLimit" type="number" min="1" defaultValue={plan.branch_limit ?? ''} placeholder="Unlimited" style={inputStyle} />
                </label>
              </div>

              <label className="flex items-center gap-2" style={{ color: 'var(--color-text-primary)', fontSize: 13, fontWeight: 750 }}>
                <input name="isActive" type="checkbox" defaultChecked={plan.is_active} />
                Available for billing
              </label>

              <button type="submit" className="btn-primary" style={{ borderRadius: 10, padding: '10px 16px', justifySelf: 'start' }}>
                Save package
              </button>
            </form>
          </Card>
        ))}
      </div>
    </div>
  )
}

const inputStyle = {
  width: '100%',
  minHeight: 42,
  border: '1px solid var(--color-border)',
  borderRadius: 10,
  padding: '0 12px',
  marginTop: 6,
  color: 'var(--color-text-primary)',
  backgroundColor: 'var(--color-background)',
  fontSize: 13,
}
