'use server'

import { timingSafeEqual } from 'node:crypto'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import {
  bootstrapPlatformUserIfNeeded,
  createPlatformSession,
  hashPlatformPassword,
  isPlatformLoginRateLimited,
  recordLoginAttempt,
} from '../../../lib/platform/auth'
import { createServiceRoleClient } from '../../../lib/supabase/admin'

export type PlatformLoginState = {
  success: boolean
  error: string | null
}

const platformLoginSchema = z.object({
  email: z.string().email('Enter a valid email').transform((value) => value.trim().toLowerCase()),
  password: z.string().min(1, 'Password is required'),
})

function getString(formData: FormData, key: string) {
  const value = formData.get(key)
  return typeof value === 'string' ? value.trim() : ''
}

export async function loginPlatformUser(_prevState: PlatformLoginState, formData: FormData): Promise<PlatformLoginState> {
  const validation = platformLoginSchema.safeParse({
    email: getString(formData, 'email'),
    password: getString(formData, 'password'),
  })

  if (!validation.success) {
    return { success: false, error: validation.error.errors[0]?.message ?? 'Invalid login details' }
  }

  const { email, password } = validation.data

  try {
    if (await isPlatformLoginRateLimited(email)) {
      return { success: false, error: 'Invalid platform email or password' }
    }

    const serviceClient = createServiceRoleClient()
    const { data: platformUser, error } = await serviceClient
      .from('platform_users')
      .select('id, name, email, role, password_salt, password_hash, is_active')
      .eq('email', email)
      .maybeSingle()

    if (error) {
      throw new Error(error.message)
    }

    let user = platformUser
    if (!user) {
      user = await bootstrapPlatformUserIfNeeded(email, password)
    }

    if (!user || user.is_active === false) {
      await recordLoginAttempt({
        email,
        surface: 'platform',
        success: false,
        failureReason: 'Platform account not found or inactive',
      })
      return { success: false, error: 'Invalid platform email or password' }
    }

    const passwordHash = await hashPlatformPassword(password, user.password_salt)

    const candidateHash = Buffer.from(passwordHash, 'hex')
    const storedHash = Buffer.from(user.password_hash, 'hex')
    const passwordMatches = candidateHash.length === storedHash.length && timingSafeEqual(candidateHash, storedHash)

    if (!passwordMatches) {
      await recordLoginAttempt({
        email,
        platformUserId: user.id,
        attemptedRole: user.role,
        surface: 'platform',
        success: false,
        failureReason: 'Invalid password',
      })
      return { success: false, error: 'Invalid platform email or password' }
    }

    await createPlatformSession(user.id)
    await serviceClient.from('platform_users').update({ last_login_at: new Date().toISOString() }).eq('id', user.id)
    await recordLoginAttempt({
      email,
      platformUserId: user.id,
      attemptedRole: user.role,
      surface: 'platform',
      success: true,
    })
  } catch (error: unknown) {
    await recordLoginAttempt({
      email,
      surface: 'platform',
      success: false,
      failureReason: error instanceof Error ? error.message : 'Platform login failed',
    })
    return { success: false, error: error instanceof Error ? error.message : 'Unable to sign in' }
  }

  redirect('/platform')
}
