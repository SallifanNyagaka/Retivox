/**
 * Supabase service-role client for trusted server-only workflows.
 *
 * Use this only from Server Actions, Server Components, and Route Handlers
 * where RLS must be bypassed intentionally, such as platform admin auth or
 * payment-provider callbacks.
 */

import { createClient } from '@supabase/supabase-js'

export function createServiceRoleClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Supabase service role configuration is missing')
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}
