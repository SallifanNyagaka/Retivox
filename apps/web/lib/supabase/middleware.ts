/**
 * @fileoverview This middleware client is specifically for use in Next.js middleware (middleware.ts).
 * It refreshes the user session on every request to prevent auth expiry.
 * It updates request and response cookies to keep the session alive.
 * Performance note: this runs on every request so it must be lightweight.
 */

import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import type { CookieOptions } from '@supabase/ssr'

/**
 * Updates the Supabase session in middleware by refreshing the auth token.
 * This function runs on every request to ensure users stay authenticated.
 * Performance is critical here - keep this function minimal and fast.
 */
export async function updateSession(request: NextRequest) {
  // Create a response that passes through the original request headers
  // This ensures middleware doesn't break existing headers
  const response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  })

  // Supabase project URL - shared with other clients
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!

  // Supabase anon/public key - used for session refresh operations
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

  // Create server client for middleware - handles cookie-based auth
  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      // Read cookies from the incoming request
      get(name: string) {
        return request.cookies.get(name)?.value
      },

      // Write cookies to the response only
      // Request cookies are read-only in Next.js middleware
      // Response cookies are sent back to the browser for future requests
      set(name: string, value: string, options: CookieOptions) {
        response.cookies.set({ name, value, ...options })
      },

      // Remove cookies from the response
      // Setting maxAge to 0 expires the cookie immediately in the browser
      remove(name: string, options: CookieOptions) {
        response.cookies.set({ name, value: '', ...options, maxAge: 0 })
      },
    },
  })

  // Refresh the user session - key performance-sensitive call
  // getUser() is used instead of getSession() because:
  // - getUser() only validates and refreshes the token — lightweight
  // - getSession() fetches full session data — heavier
  // Since middleware runs on every request, minimal overhead is critical
  await supabase.auth.getUser()

  // Return the response with updated session cookies
  return response
}