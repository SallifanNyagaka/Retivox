/**
 * @fileoverview This is the server-side Supabase client for the SmartRetail Next.js app.
 * It uses Next.js cookies() to manage auth sessions on the server.
 * It must only be used in Server Components, Server Actions, and Route Handlers.
 * Never use this in client components.
 */

import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type { CookieOptions } from '@supabase/ssr'

/**
 * Creates a Supabase server client for use in server-side code.
 * This client manages authentication sessions using HTTP cookies,
 * which is essential for server-side rendering and API routes.
 *
 * Unlike the browser client, this version can access and modify
 * cookies to persist auth state across requests.
 */
export async function createClient() {
  // Await the cookies() call to get the cookie store for this request
  const cookieStore = await cookies()

  // Supabase project URL - shared with browser client
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!

  // Supabase anon/public key - same as browser client, used for initial auth
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      // Get a cookie by name from the request
      get(name: string) {
        return cookieStore.get(name)?.value
      },

      // Set a cookie in the response - used for auth session management
      // Cookies are needed because the server cannot access browser localStorage
      set(name: string, value: string, options: CookieOptions) {
        try {
          cookieStore.set({ name, value, ...options })
        } catch {
          // Called from a Server Component — cannot set cookies directly
          // Middleware handles session refresh in that case
        }
      },

      // Remove a cookie by setting it with maxAge 0
      remove(name: string, options: CookieOptions) {
        try {
          cookieStore.set({ name, value: '', ...options, maxAge: 0 })
        } catch {
          // Called from a Server Component — cannot remove cookies directly
          // Middleware handles session refresh in that case
        }
      },
    },
  })
}