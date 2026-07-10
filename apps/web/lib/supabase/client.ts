/**
 * @fileoverview This is the browser-side Supabase client for the SmartRetail web app.
 * It uses the anon/public key and is safe to use in React components and client-side code.
 * It should never be used in server-side code or API routes.
 */

import { createBrowserClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'

// TODO: Replace 'any' with generated Database type from Supabase schema
// Database type will be generated from Supabase schema in a later step
// For now we use a placeholder that will be replaced with the generated Database type
export function createClient(): SupabaseClient {
  // Supabase project URL - must be public and accessible from the browser
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  // Supabase anon/public key - safe for client-side use, enables read/write operations based on RLS policies
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

  return createBrowserClient(supabaseUrl, supabaseAnonKey)
}