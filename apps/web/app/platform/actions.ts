'use server'

import { redirect } from 'next/navigation'
import { clearPlatformSession } from '../../lib/platform/auth'

export async function logoutPlatformUser(): Promise<void> {
  await clearPlatformSession()
  redirect('/platform/login')
}
