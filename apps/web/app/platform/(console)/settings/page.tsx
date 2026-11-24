import { Badge } from '../../../../components/ui/Badge'
import { Card, CardHeader } from '../../../../components/ui/Card'
import { requirePlatformUser } from '../../../../lib/platform/auth'
import { createServiceRoleClient } from '../../../../lib/supabase/admin'
import { updatePlatformRuntimeSettings } from '../actions'

export const dynamic = 'force-dynamic'

type RuntimeSettings = { web_app_url: string; account_registration_path: string; updated_at: string }

export default async function PlatformRuntimeSettingsPage() {
  const user = await requirePlatformUser()
  if (user.role !== 'developer') throw new Error('Only platform developers can manage runtime settings.')
  const serviceClient = createServiceRoleClient()
  const { data, error } = await serviceClient.rpc('platform_get_runtime_settings')
  const settings = Array.isArray(data) ? (data[0] as RuntimeSettings | undefined) ?? null : null

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 style={{ margin: 0, color: 'var(--color-text-primary)', fontSize: 26, fontWeight: 900 }}>Runtime settings</h1>
        <p style={{ margin: '6px 0 0', color: 'var(--color-text-muted)', fontSize: 14 }}>
          Configure the canonical web address and the account creation page opened by Retivox desktop and mobile.
        </p>
      </div>
      <Card padding="md">
        <CardHeader
          title="Retivox web app URL"
          action={<Badge variant={settings ? 'success' : 'warning'}>{settings ? 'Configured' : 'Setup needed'}</Badge>}
        />
        {error ? <p role="alert" style={{ margin: 0, color: 'var(--color-danger)', fontSize: 13 }}>Apply migration 136 to configure the account creation link for native apps.</p> : (
          <form action={updatePlatformRuntimeSettings} className="grid max-w-2xl grid-cols-1 gap-4">
            <label className="grid gap-2" style={{ color: 'var(--color-text-primary)', fontSize: 13, fontWeight: 700 }}>
              Canonical HTTPS URL
              <input name="webAppUrl" type="url" defaultValue={settings?.web_app_url ?? ''} placeholder="https://app.example.com" required style={{ width: '100%', border: '1px solid var(--color-border)', borderRadius: 10, background: 'var(--color-background)', color: 'var(--color-text-primary)', padding: '10px 12px' }} />
              <span style={{ color: 'var(--color-text-muted)', fontSize: 12, fontWeight: 400 }}>Enter only the origin, without a path, query, or fragment. Local HTTP is accepted for local development.</span>
            </label>
            <label className="grid gap-2" style={{ color: 'var(--color-text-primary)', fontSize: 13, fontWeight: 700 }}>
              Create account page path
              <input name="accountRegistrationPath" type="text" defaultValue={settings?.account_registration_path ?? '/register'} placeholder="/register" required pattern="/[A-Za-z0-9/_-]*" style={{ width: '100%', border: '1px solid var(--color-border)', borderRadius: 10, background: 'var(--color-background)', color: 'var(--color-text-primary)', padding: '10px 12px' }} />
              <span style={{ color: 'var(--color-text-muted)', fontSize: 12, fontWeight: 400 }}>This must be a path on the canonical website, such as /register. The desktop and mobile apps fetch it from platform settings.</span>
            </label>
            {settings?.updated_at ? <p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: 12 }}>Last updated {new Date(settings.updated_at).toLocaleString()}.</p> : null}
            <button type="submit" className="btn-primary" style={{ justifySelf: 'start', borderRadius: 10, padding: '10px 16px' }}>Save application URL</button>
          </form>
        )}
      </Card>
    </div>
  )
}
