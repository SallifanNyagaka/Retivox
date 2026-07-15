import { redirect } from 'next/navigation'
import { Card } from '../../../components/ui/Card'
import { getPlatformUser } from '../../../lib/platform/auth'
import PlatformLoginForm from './PlatformLoginForm'

export const dynamic = 'force-dynamic'

export default async function PlatformLoginPage() {
  const user = await getPlatformUser()

  if (user) {
    redirect('/platform')
  }

  return (
    <main className="min-h-screen grid place-items-center px-4 py-10" style={{ backgroundColor: 'var(--color-background)' }}>
      <div className="w-full max-w-md">
        <Card padding="lg">
          <div style={{ marginBottom: 24, textAlign: 'center' }}>
            <p style={{ margin: 0, color: 'var(--color-primary)', fontWeight: 900, letterSpacing: '-0.3px', fontSize: 24 }}>
              Retivox Platform
            </p>
            <h1 style={{ margin: '12px 0 0', color: 'var(--color-text-primary)', fontSize: 22, fontWeight: 800 }}>
              Developer console login
            </h1>
            <p style={{ margin: '8px 0 0', color: 'var(--color-text-muted)', fontSize: 14 }}>
              Separate access for operating subscriptions, businesses, payments, and security logs.
            </p>
          </div>

          <PlatformLoginForm />
        </Card>
      </div>
    </main>
  )
}
