import { Badge } from '../../../../components/ui/Badge'
import { Card, CardHeader } from '../../../../components/ui/Card'
import { createServiceRoleClient } from '../../../../lib/supabase/admin'
import { createSubscriptionPlan, updateSubscriptionPlan } from '../actions'

export const dynamic = 'force-dynamic'

type PlanRow = {
  id: string
  plan_key: string
  name: string
  description: string
  monthly_amount: number
  annual_discount_percent: number
  yearly_amount: number
  lifetime_amount: number | null
  monthly_enabled: boolean
  yearly_enabled: boolean
  lifetime_enabled: boolean
  trial_days: number
  features: Record<string, unknown>
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
    .select('id, plan_key, name, description, monthly_amount, annual_discount_percent, yearly_amount, lifetime_amount, monthly_enabled, yearly_enabled, lifetime_enabled, trial_days, features, currency, branch_limit, is_active, sort_order, updated_at')
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
          Configure package limits and monthly, annual, and lifetime prices. New purchase prices apply immediately; existing subscribers get 30 days&apos; notice before price increases take effect at renewal.
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
              {plan.monthly_enabled ? `${formatMoney(Number(plan.monthly_amount), plan.currency)} monthly` : 'Monthly disabled'}; {plan.yearly_enabled ? `${formatMoney(Number(plan.yearly_amount), plan.currency)} yearly` : 'Yearly disabled'}; {plan.lifetime_enabled ? `${formatMoney(Number(plan.lifetime_amount ?? 0), plan.currency)} lifetime` : 'Lifetime disabled'}; {plan.branch_limit ? `${plan.branch_limit} branches` : 'unlimited branches'}.
            </p>

            <form action={updateSubscriptionPlan} className="grid grid-cols-1 gap-3">
              <input type="hidden" name="planKey" value={plan.plan_key} />

              <label style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text-primary)' }}>
                Package name
                  <input name="name" defaultValue={plan.name} required readOnly={plan.plan_key === 'trial'} style={inputStyle} />
              </label>

              <label style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text-primary)' }}>
                Description
                <textarea name="description" defaultValue={plan.description} rows={3} style={{ ...inputStyle, height: 'auto', paddingTop: 10, resize: 'vertical' }} />
              </label>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                <label style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text-primary)' }}>
                  Monthly amount
                  <input name="monthlyAmount" type="number" min="0" step="0.01" defaultValue={plan.monthly_amount} required readOnly={plan.plan_key === 'trial'} style={inputStyle} />
                </label>
                <label style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text-primary)' }}>
                  Currency
                  <input name="currency" maxLength={3} defaultValue={plan.currency} required style={inputStyle} />
                </label>
                <label style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text-primary)' }}>
                  Annual discount (%)
                  <input name="annualDiscountPercent" type="number" min="0" max="100" step="0.01" defaultValue={plan.annual_discount_percent} required readOnly={plan.plan_key === 'trial'} style={inputStyle} />
                </label>
                <label style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text-primary)' }}>
                  Branch limit
                  <input name="branchLimit" type="number" min="1" defaultValue={plan.branch_limit ?? ''} placeholder="Unlimited" style={inputStyle} />
                </label>
                <label style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text-primary)' }}>
                  Lifetime price
                  <input name="lifetimeAmount" type="number" min="0.01" step="0.01" defaultValue={plan.lifetime_amount ?? ''} placeholder="Disabled" style={inputStyle} />
                </label>
              </div>

              <div className="flex flex-wrap gap-x-5 gap-y-2">
                {plan.plan_key !== 'trial' ? <>
                  <label className="flex items-center gap-2" style={{ color: 'var(--color-text-primary)', fontSize: 13 }}>
                    <input name="monthlyEnabled" type="checkbox" defaultChecked={plan.monthly_enabled} /> Monthly billing
                  </label>
                  <label className="flex items-center gap-2" style={{ color: 'var(--color-text-primary)', fontSize: 13 }}>
                    <input name="yearlyEnabled" type="checkbox" defaultChecked={plan.yearly_enabled} /> Yearly billing
                  </label>
                  <label className="flex items-center gap-2" style={{ color: 'var(--color-text-primary)', fontSize: 13 }}>
                    <input name="lifetimeEnabled" type="checkbox" defaultChecked={plan.lifetime_enabled} /> Lifetime license
                  </label>
                </> : <>
                  <input type="hidden" name="monthlyEnabled" value="on" />
                  <input type="hidden" name="yearlyEnabled" value="off" />
                  <input type="hidden" name="lifetimeEnabled" value="off" />
                </>}
              </div>

              {plan.plan_key === 'trial' ? (
                <label style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text-primary)' }}>
                  Trial duration in days
                  <input name="trialDays" type="number" min="0" max="90" defaultValue={plan.trial_days} required style={inputStyle} />
                </label>
              ) : <input type="hidden" name="trialDays" value="30" />}

              <label style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text-primary)' }}>
                Feature entitlements (JSON)
                <textarea name="featuresJson" defaultValue={JSON.stringify(plan.features ?? {}, null, 2)} rows={3} style={{ ...inputStyle, height: 'auto', paddingTop: 10, resize: 'vertical', fontFamily: 'monospace' }} />
                <small style={{ fontWeight: 400, lineHeight: 1.5, color: 'var(--color-text-muted)' }}>Online payment options are controlled by <code>payment_methods</code>, e.g. <code>{'{"payment_methods":["daraja_stk","pesapal_hosted"]}'}</code>. Cash and Mobile manual are included on every plan.</small>
              </label>

              <label className="flex items-center gap-2" style={{ color: 'var(--color-text-primary)', fontSize: 13, fontWeight: 750 }}>
                {plan.plan_key === 'trial' && <input type="hidden" name="isActive" value="on" />}
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

      <Card padding="md">
        <CardHeader title="Add a package" />
        <form action={createSubscriptionPlan} className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <label style={fieldLabelStyle}>Plan key<input name="planKey" placeholder="pro_plus" pattern="[a-z][a-z0-9_]{1,39}" required style={inputStyle} /></label>
          <label style={fieldLabelStyle}>Package name<input name="name" required style={inputStyle} /></label>
          <label style={fieldLabelStyle}>Description<textarea name="description" rows={2} style={{ ...inputStyle, height: 'auto', paddingTop: 10 }} /></label>
          <label style={fieldLabelStyle}>Currency<input name="currency" maxLength={3} defaultValue="KES" required style={inputStyle} /></label>
          <label style={fieldLabelStyle}>Monthly price<input name="monthlyAmount" type="number" min="0.01" step="0.01" required style={inputStyle} /></label>
          <label style={fieldLabelStyle}>Annual discount (%)<input name="annualDiscountPercent" type="number" min="0" max="100" step="0.01" defaultValue="0" required style={inputStyle} /></label>
          <label style={fieldLabelStyle}>Branch limit<input name="branchLimit" type="number" min="1" placeholder="Unlimited" style={inputStyle} /></label>
          <label style={fieldLabelStyle}>Lifetime price<input name="lifetimeAmount" type="number" min="0.01" step="0.01" style={inputStyle} /></label>
          <label style={fieldLabelStyle}>Feature entitlements (JSON)<textarea name="featuresJson" defaultValue="{}" rows={3} style={{ ...inputStyle, height: 'auto', paddingTop: 10, fontFamily: 'monospace' }} /><small style={{ fontWeight: 400, lineHeight: 1.5, color: 'var(--color-text-muted)' }}>Online payment options: <code>payment_methods</code> may contain <code>daraja_stk</code> and/or <code>pesapal_hosted</code>. Cash and Mobile manual are included on every plan.</small></label>
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2" style={{ fontSize: 13 }}><input name="monthlyEnabled" type="checkbox" defaultChecked /> Monthly</label>
            <label className="flex items-center gap-2" style={{ fontSize: 13 }}><input name="yearlyEnabled" type="checkbox" defaultChecked /> Yearly</label>
            <label className="flex items-center gap-2" style={{ fontSize: 13 }}><input name="lifetimeEnabled" type="checkbox" /> Lifetime</label>
          </div>
          <button type="submit" className="btn-primary" style={{ borderRadius: 10, padding: '10px 16px', justifySelf: 'start' }}>Create package</button>
        </form>
      </Card>
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

const fieldLabelStyle = { display: 'grid', gap: 6, color: 'var(--color-text-primary)', fontSize: 13, fontWeight: 700 } as const
