import { Badge } from '../../../../components/ui/Badge'
import { Card, CardHeader } from '../../../../components/ui/Card'
import { createServiceRoleClient } from '../../../../lib/supabase/admin'
import { reviewIntegrationSetupRequest, setBusinessIntegrationSetupFeeOverride } from '../actions'

export const dynamic = 'force-dynamic'

export default async function PlatformIntegrationRequestsPage() {
  const client = createServiceRoleClient()
  const { data, error } = await client.from('integration_setup_requests')
    .select('id,business_id,provider,status,quoted_fee,currency,request_notes,admin_notes,setup_payment_status,setup_payment_reference,created_at,businesses(name)')
    .order('created_at', { ascending: false }).limit(200)
  if (error) throw new Error(error.message)
  const businessIds = Array.from(new Set((data ?? []).map((request) => request.business_id)))
  const [{ data: feeOverrides }, { data: setupConfig }] = await Promise.all([
    businessIds.length ? client.from('platform_business_setup_fee_overrides').select('business_id,fee,currency,reason').in('business_id', businessIds) : Promise.resolve({ data: [] }),
    client.from('platform_integration_setup_config').select('default_setup_fee,currency').eq('id', true).maybeSingle(),
  ])
  const overrideByBusiness = new Map((feeOverrides ?? []).map((override) => [override.business_id, override]))
  return <div className="flex flex-col gap-6">
    <div><h1 style={{ margin: 0, fontSize: 26, fontWeight: 900, color: 'var(--color-text-primary)' }}>Integration setup service</h1><p style={{ margin: '6px 0 0', color: 'var(--color-text-muted)', fontSize: 14 }}>Triage assisted setup requests. Never ask businesses to paste secret credentials into notes.</p></div>
    <Card padding="md"><CardHeader title="Request queue" />
      <div className="flex flex-col gap-4">
        {(data ?? []).map((request) => {
          const business = Array.isArray(request.businesses) ? request.businesses[0] : request.businesses
          const override = overrideByBusiness.get(request.business_id)
          return <section key={request.id} style={{ border: '1px solid var(--color-border)', borderRadius: 12, padding: 15 }}>
            <div className="flex flex-wrap items-center justify-between gap-3"><div><strong>{business?.name ?? request.business_id}</strong><p style={{ margin: '4px 0', color: 'var(--color-text-muted)', fontSize: 12, textTransform: 'capitalize' }}>{request.provider.replaceAll('_',' ')} · {new Date(request.created_at).toLocaleString()}</p><p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: 11 }}>Business ID: {request.business_id}</p></div><div className="flex flex-wrap gap-2"><Badge variant={request.status === 'completed' ? 'success' : request.status === 'cancelled' ? 'danger' : 'warning'}>{request.status.replaceAll('_',' ')}</Badge><Badge variant={request.setup_payment_status === 'paid' || request.setup_payment_status === 'waived' ? 'success' : request.setup_payment_status === 'refunded' ? 'danger' : 'warning'}>Setup {request.setup_payment_status}</Badge></div></div>
            <p style={{ margin: '8px 0 12px', fontSize: 13, color: 'var(--color-text-primary)' }}>{request.request_notes || 'No setup details provided.'}</p>
            <form action={reviewIntegrationSetupRequest} className="grid grid-cols-1 gap-2 md:grid-cols-3 md:items-end">
              <input type="hidden" name="requestId" value={request.id} />
              <label style={labelStyle}>Status<select name="status" defaultValue={request.status} style={inputStyle}><option value="quoted">Quoted</option><option value="awaiting_payment">Awaiting payment</option><option value="in_progress">In progress</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></select></label>
              <label style={labelStyle}>Quote ({request.currency})<input name="quotedFee" type="number" min="0" step="0.01" defaultValue={request.quoted_fee} style={inputStyle} /></label>
              <label style={labelStyle}>Setup payment<select name="setupPaymentStatus" defaultValue={request.setup_payment_status} style={inputStyle}><option value="unpaid">Unpaid</option><option value="pending">Pending</option><option value="paid">Paid</option><option value="waived">Waived</option><option value="refunded">Refunded</option></select></label>
              <label style={labelStyle}>Payment reference<input name="setupPaymentReference" maxLength={120} defaultValue={request.setup_payment_reference ?? ''} placeholder="Required when marked paid" style={inputStyle} /></label>
              <label className="md:col-span-2" style={labelStyle}>Admin notes<textarea name="adminNotes" rows={2} defaultValue={request.admin_notes} style={{ ...inputStyle, height: 'auto', padding: 9 }} /></label>
              <button type="submit" className="btn-primary" style={{ justifySelf: 'start', borderRadius: 8, padding: '8px 13px' }}>Save request</button>
            </form>
            <details style={{ marginTop: 12 }}>
              <summary style={{ cursor: 'pointer', color: 'var(--color-text-primary)', fontSize: 12, fontWeight: 750 }}>Business assisted setup fee override</summary>
              <form action={setBusinessIntegrationSetupFeeOverride} className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-4 md:items-end">
                <input type="hidden" name="businessId" value={request.business_id} />
                <label style={labelStyle}>Pricing<select name="overrideMode" defaultValue={override ? 'custom' : 'standard'} style={inputStyle}><option value="standard">Use platform standard</option><option value="custom">Set custom fee</option></select></label>
                <label style={labelStyle}>Custom fee<input name="overrideFee" type="number" min="0" step="0.01" defaultValue={override?.fee ?? request.quoted_fee ?? setupConfig?.default_setup_fee ?? 0} style={inputStyle} /></label>
                <label style={labelStyle}>Currency<input name="overrideCurrency" minLength={3} maxLength={3} defaultValue={override?.currency ?? request.currency ?? setupConfig?.currency ?? 'KES'} style={inputStyle} /></label>
                <label style={labelStyle}>Reason<input name="overrideReason" minLength={3} maxLength={500} defaultValue={override?.reason ?? ''} placeholder="Required for a custom fee" style={inputStyle} /></label>
                <button type="submit" className="btn-outline" style={{ justifySelf: 'start', borderRadius: 8, padding: '8px 13px' }}>Save fee rule</button>
              </form>
              <p style={{ margin: '7px 0 0', color: 'var(--color-text-muted)', fontSize: 11 }}>{override ? `Current custom fee: ${override.currency} ${Number(override.fee).toFixed(2)} · ${override.reason}` : 'No override. New requests use the platform standard fee.'}</p>
            </details>
          </section>
        })}
        {(data ?? []).length === 0 && <p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: 13 }}>No businesses have requested assisted integration help.</p>}
      </div>
    </Card>
  </div>
}

const labelStyle = { display: 'grid', gap: 6, color: 'var(--color-text-primary)', fontSize: 13, fontWeight: 700 } as const
const inputStyle = { width: '100%', minHeight: 38, border: '1px solid var(--color-border)', borderRadius: 8, padding: '0 9px', background: 'var(--color-background)', color: 'var(--color-text-primary)', fontSize: 12 }
