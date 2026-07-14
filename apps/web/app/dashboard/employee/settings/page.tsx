/**
 * Employee settings page.
 *
 * Employees can view their account and branch context, adjust local appearance,
 * and sign out from the web portal.
 */

import { redirect } from 'next/navigation'
import { Card } from '../../../../components/ui/Card'
import { requireAuth } from '../../../../lib/auth/helpers'
import { getEmployeeProfile } from '../../../../lib/employee/auth'
import logger from '../../../../lib/logger'
import { createClient } from '../../../../lib/supabase/server'
import EmployeeSettingsClient from './EmployeeSettingsClient'

type BusinessRow = {
  name: string
}

export default async function EmployeeSettingsPage() {
  const user = await requireAuth()
  const profile = await getEmployeeProfile(user.id)

  if (!profile) {
    redirect('/unauthorized')
  }

  if (!profile.isActive) {
    redirect('/account/deactivated')
  }

  let businessName = 'Retivox'
  let pageError = false

  try {
    const supabase = await createClient()
    const { data, error } = await supabase
      .from('businesses')
      .select('name')
      .eq('id', profile.businessId)
      .maybeSingle()

    if (error) {
      throw error
    }

    businessName = ((data ?? null) as BusinessRow | null)?.name ?? businessName
  } catch (error: unknown) {
    pageError = true
    logger.error('EmployeeSettingsPage data fetch failed', {
      userId: profile.id,
      businessId: profile.businessId,
      error,
    })
  }

  if (pageError) {
    return (
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 text-center">
        <div>
          <h1 className="font-bold" style={{ fontSize: 22, color: 'var(--color-text-primary)', letterSpacing: '-0.3px' }}>
            Settings
          </h1>
          <p style={{ fontSize: 14, color: 'var(--color-text-muted)', marginTop: 4 }}>
            Manage your employee workspace preferences.
          </p>
        </div>

        <Card padding="md">
          <p style={{ fontSize: 14, color: 'var(--color-danger)', margin: 0 }}>
            Failed to load employee settings. Please refresh and try again.
          </p>
        </Card>
      </div>
    )
  }

  return (
    <EmployeeSettingsClient
      profile={{
        id: profile.id,
        name: profile.name,
        email: profile.email,
        phone: profile.phone,
        branchName: profile.branchName,
        businessName,
      }}
    />
  )
}
