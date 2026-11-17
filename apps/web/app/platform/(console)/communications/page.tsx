import { Badge } from '../../../../components/ui/Badge'
import { Card, CardHeader } from '../../../../components/ui/Card'
import { createServiceRoleClient } from '../../../../lib/supabase/admin'
import { updatePlatformEmailSettings } from '../actions'

export const dynamic = 'force-dynamic'

type EmailSettings = {
  from_email: string
  api_key_set: boolean
  is_active: boolean
  updated_at: string
}

const labelStyle = {
  display: 'grid',
  gap: 7,
  color: 'var(--color-text-primary)',
  fontSize: 13,
  fontWeight: 700,
} as const

const inputStyle = {
  width: '100%',
  border: '1px solid var(--color-border)',
  borderRadius: 10,
  background: 'var(--color-background)',
  color: 'var(--color-text-primary)',
  padding: '10px 12px',
} as const

export default async function PlatformCommunicationsPage() {
  const serviceClient = createServiceRoleClient()
  const { data, error } = await serviceClient.rpc('platform_get_email_settings')
  const settings = Array.isArray(data) ? (data[0] as EmailSettings | undefined) ?? null : null

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 style={{ margin: 0, color: 'var(--color-text-primary)', fontSize: 26, fontWeight: 900 }}>Email delivery</h1>
        <p style={{ margin: '6px 0 0', color: 'var(--color-text-muted)', fontSize: 14 }}>
          Configure Retivox platform email delivery. Provider credentials stay server-side in Supabase Vault.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <Card padding="md">
          <CardHeader title="Resend configuration" />
          {error ? (
            <p style={{ margin: 0, color: 'var(--color-danger)', fontSize: 13 }}>
              Email settings are unavailable. Apply migration 072 before configuring this provider.
            </p>
          ) : (
            <form action={updatePlatformEmailSettings} className="grid grid-cols-1 gap-4">
              <label style={labelStyle}>
                Verified sender email
                <input name="fromEmail" type="email" autoComplete="email" defaultValue={settings?.from_email ?? ''} placeholder="notifications@example.com" required style={inputStyle} />
                <span style={{ color: 'var(--color-text-muted)', fontSize: 12, fontWeight: 400 }}>
                  Use a sender domain verified in Resend.
                </span>
              </label>
              <label style={labelStyle}>
                Resend API key
                <input name="apiKey" type="password" autoComplete="new-password" placeholder={settings?.api_key_set ? 'Saved securely; enter only to replace' : 'Enter API key for first setup'} style={inputStyle} />
                <span style={{ color: 'var(--color-text-muted)', fontSize: 12, fontWeight: 400 }}>
                  The key is never returned to the form after saving. Leave blank to keep the saved key.
                </span>
              </label>
              <button type="submit" className="btn-primary" style={{ justifySelf: 'start', borderRadius: 10, padding: '10px 16px' }}>
                Save email settings
              </button>
            </form>
          )}
        </Card>

        <Card padding="md">
          <CardHeader
            title="Delivery status"
            action={<Badge variant={settings?.is_active && settings?.api_key_set ? 'success' : 'warning'}>{settings?.is_active && settings?.api_key_set ? 'Ready' : 'Setup needed'}</Badge>}
          />
          <div className="flex flex-col gap-3" style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>
            <p style={{ margin: 0 }}>Provider: Resend</p>
            <p style={{ margin: 0 }}>Sender: {settings?.from_email ?? 'Not configured'}</p>
            <p style={{ margin: 0 }}>API key: {settings?.api_key_set ? 'Saved in Vault' : 'Not configured'}</p>
            {settings?.updated_at ? <p style={{ margin: 0 }}>Last updated: {new Date(settings.updated_at).toLocaleString()}</p> : null}
          </div>
        </Card>
      </div>
    </div>
  )
}
