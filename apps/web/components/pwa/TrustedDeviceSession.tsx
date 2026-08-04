'use client'

import { useLayoutEffect } from 'react'
import { saveTrustedDeviceSession, type TrustedDashboardRole } from '../../lib/pwa/trustedDevice'

type Props = {
  userId: string
  role: TrustedDashboardRole
}

/**
 * Persists only a safe account marker after server-side authentication has
 * already succeeded. This lets the PWA restore the right cached dashboard
 * without ever storing a password locally.
 */
export default function TrustedDeviceSession({ userId, role }: Props) {
  useLayoutEffect(() => {
    saveTrustedDeviceSession(userId, role)
  }, [role, userId])

  return null
}
