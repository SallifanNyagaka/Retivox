/**
 * Admin settings page.
 *
 * Loads minimal account and business context before rendering admin-specific
 * preferences such as user-scoped dashboard theme.
 */

import { GlobalRole } from '@smartretail/shared'
import { requireRole } from '../../../../lib/auth/helpers'
import { createClient } from '../../../../lib/supabase/server'
import logger from '../../../../lib/logger'
import { Card } from '../../../../components/ui/Card'
import AdminSettingsClient from './AdminSettingsClient'

/**
 * Admin profile row used by settings.
 */
type AdminProfileRow = {
  id: string
  name: string
  email: string
  phone: string | null
}

/**
 * Business row used by settings.
 */
type BusinessRow = {
  name: string
}

/**
 * Admin settings server component.
 */
export default async function AdminSettingsPage() {
  const profile = await requireRole([GlobalRole.Admin])
  const businessId = profile.business_id

  if (!businessId) {
    throw new Error('Admin profile missing business ID')
  }

  const supabase = await createClient()
  let adminProfile: AdminProfileRow | null = null
  let business: BusinessRow | null = null
  let pageError = false

  try {
    const [profileResponse, businessResponse] = await Promise.all([
      supabase
        .from('users')
        .select('id, name, email, phone')
        .eq('business_id', businessId)
        .eq('id', profile.id)
        .single(),
      supabase.from('businesses').select('name').eq('id', businessId).single(),
    ])

    if (profileResponse.error) {
      throw profileResponse.error
    }

    if (businessResponse.error) {
      throw businessResponse.error
    }

    adminProfile = profileResponse.data as AdminProfileRow
    business = businessResponse.data as BusinessRow
  } catch (error: unknown) {
    pageError = true
    logger.error('AdminSettingsPage data fetch failed', { businessId, userId: profile.id, error })
  }

  if (pageError || !adminProfile || !business) {
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h1
            className="font-bold"
            style={{ fontSize: '22px', color: 'var(--color-text-primary)', letterSpacing: '-0.3px' }}
          >
            Settings
          </h1>
          <p style={{ fontSize: '14px', color: 'var(--color-text-muted)', marginTop: '4px' }}>
            Manage your admin workspace preferences.
          </p>
        </div>

        <Card>
          <p style={{ fontSize: '14px', color: 'var(--color-danger)', margin: 0 }}>
            Failed to load settings. Please refresh and try again.
          </p>
        </Card>
      </div>
    )
  }

  return <AdminSettingsClient profile={adminProfile} businessName={business.name} />
}
