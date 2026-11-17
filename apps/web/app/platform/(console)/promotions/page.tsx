import { Badge } from '../../../../components/ui/Badge'
import { Card, CardHeader } from '../../../../components/ui/Card'
import { createServiceRoleClient } from '../../../../lib/supabase/admin'
import { createSubscriptionPromotion, setSubscriptionPromotionActive, updatePlatformOperationalSettings } from '../actions'

export const dynamic = 'force-dynamic'

export default async function PlatformPromotionsPage() {
  const client = createServiceRoleClient()
  const [promotions, setup, retention] = await Promise.all([
    client.from('subscription_promotions').select('id,code,description,discount_type,discount_value,usage_limit,usage_count,expires_at,is_active,setup_fee_discount,business_id,eligible_plan_keys,eligible_intervals').order('created_at', { ascending: false }).limit(100),
    client.from('platform_integration_setup_config').select('default_setup_fee,currency').eq('id', true).maybeSingle(),
    client.from('platform_retention_settings').select('retention_months').eq('id', true).maybeSingle(),
  ])
  if (promotions.error || setup.error || retention.error) throw new Error(promotions.error?.message ?? setup.error?.message ?? retention.error?.message)

  return <div className="flex flex-col gap-6">
    <section style={{ borderRadius: 24, padding: 26, color: '#fff8ec', background: 'linear-gradient(135deg,#1f2d27,#395143)' }}>
      <p style={{ margin: 0, fontSize: 12, fontWeight: 800, textTransform: 'uppercase', opacity: .75 }}>Commercial controls</p>
      <h1 style={{ margin: '8px 0', fontSize: 30, fontWeight: 900 }}>Promotions & service settings</h1>
      <p style={{ margin: 0, maxWidth: 720, fontSize: 14, lineHeight: 1.6, opacity: .82 }}>Configure server validated discounts, assisted integration fees, and how long inactive business data stays available.</p>
    </section>

    <Card padding="md">
      <CardHeader title="New promotion" />
      <form action={createSubscriptionPromotion} className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <label style={labelStyle}>Code<input name="code" required minLength={3} maxLength={40} placeholder="WELCOME10" style={inputStyle} /></label>
        <label style={labelStyle}>Discount type<select name="discountType" style={inputStyle}><option value="percentage">Percentage</option><option value="fixed">Fixed amount</option></select></label>
        <label style={labelStyle}>Discount value<input name="discountValue" type="number" min="0.01" step="0.01" required style={inputStyle} /></label>
        <label style={labelStyle}>Usage limit<input name="usageLimit" type="number" min="1" placeholder="Unlimited" style={inputStyle} /></label>
        <label style={labelStyle}>Expires at<input name="expiresAt" type="datetime-local" style={inputStyle} /></label>
        <label style={labelStyle}>Business ID (optional)<input name="businessId" placeholder="Limit to one business" style={inputStyle} /></label>
        <label style={labelStyle}>Eligible plan keys<input name="planKeys" placeholder="starter,growth (blank = all)" style={inputStyle} /></label>
        <label style={labelStyle}>Eligible periods<input name="intervals" placeholder="monthly,yearly,lifetime (blank = all)" style={inputStyle} /></label>
        <label style={labelStyle}>Setup fee discount<input name="setupFeeDiscount" type="number" min="0" step="0.01" defaultValue="0" style={inputStyle} /></label>
        <label className="md:col-span-3" style={labelStyle}>Description<textarea name="description" rows={2} style={{ ...inputStyle, height: 'auto', padding: 10 }} /></label>
        <button className="btn-primary" type="submit" style={{ justifySelf: 'start', borderRadius: 9, padding: '10px 15px' }}>Create promotion</button>
      </form>
    </Card>

    <Card padding="md">
      <CardHeader title="Setup and data retention" />
      <form action={updatePlatformOperationalSettings} className="grid grid-cols-1 gap-3 md:grid-cols-3 md:items-end">
        <label style={labelStyle}>Standard assisted setup fee<input name="setupFee" type="number" min="0" step="0.01" defaultValue={setup.data?.default_setup_fee ?? 0} required style={inputStyle} /></label>
        <label style={labelStyle}>Currency<input name="currency" maxLength={3} defaultValue={setup.data?.currency ?? 'KES'} required style={inputStyle} /></label>
        <label style={labelStyle}>Retention after access ends (months)<input name="retentionMonths" type="number" min="1" max="120" defaultValue={retention.data?.retention_months ?? 12} required style={inputStyle} /></label>
        <button className="btn-primary" type="submit" style={{ justifySelf: 'start', borderRadius: 9, padding: '10px 15px' }}>Save operational settings</button>
      </form>
    </Card>

    <Card padding="md">
      <CardHeader title="Promotional campaigns" />
      <div className="flex flex-col gap-3">
        {(promotions.data ?? []).map((promotion) => <div key={promotion.id} className="flex flex-wrap items-center justify-between gap-3" style={{ border: '1px solid var(--color-border)', borderRadius: 12, padding: 14 }}>
          <div>
            <div className="flex flex-wrap items-center gap-2"><strong>{promotion.code}</strong><Badge variant={promotion.is_active ? 'success' : 'muted'}>{promotion.is_active ? 'Active' : 'Disabled'}</Badge></div>
            <p style={{ margin: '5px 0 0', color: 'var(--color-text-muted)', fontSize: 12 }}>{promotion.description || 'No description'} · {promotion.discount_type === 'percentage' ? `${promotion.discount_value}%` : `${promotion.discount_value} fixed`} · used {promotion.usage_count}{promotion.usage_limit ? ` / ${promotion.usage_limit}` : ''}{promotion.expires_at ? ` · expires ${new Date(promotion.expires_at).toLocaleString()}` : ''}</p>
            {(promotion.setup_fee_discount > 0 || promotion.business_id) && <p style={{ margin: '3px 0 0', color: 'var(--color-text-muted)', fontSize: 11 }}>{promotion.setup_fee_discount > 0 ? `Setup fee discount ${promotion.setup_fee_discount}` : ''}{promotion.business_id ? ` · business ${promotion.business_id}` : ''}</p>}
          </div>
          <form action={setSubscriptionPromotionActive}>
            <input type="hidden" name="promotionId" value={promotion.id} />
            <input type="hidden" name="isActive" value={promotion.is_active ? 'false' : 'true'} />
            <button className={promotion.is_active ? 'btn-outline' : 'btn-primary'} style={{ borderRadius: 8, padding: '8px 12px' }}>{promotion.is_active ? 'Disable' : 'Enable'}</button>
          </form>
        </div>)}
        {(promotions.data ?? []).length === 0 && <p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: 13 }}>No promotional campaigns yet.</p>}
      </div>
    </Card>
  </div>
}

const labelStyle = { display: 'grid', gap: 6, color: 'var(--color-text-primary)', fontSize: 13, fontWeight: 700 } as const
const inputStyle = { width: '100%', minHeight: 40, border: '1px solid var(--color-border)', borderRadius: 9, padding: '0 10px', background: 'var(--color-background)', color: 'var(--color-text-primary)', fontSize: 13 }
