/**
 * @fileoverview This proxy runs on every request before the page renders.
 * It refreshes the Supabase auth session to prevent expiry.
 * It protects routes based on authentication status.
 * Performance note: matcher config is used to skip static files and images
 * so the proxy only runs on necessary routes.
 */

import type { NextRequest } from 'next/server'
import { updateSession } from './lib/supabase/middleware'

/**
 * Main proxy function — runs on every matched request.
 * Route protection and role-based access will be added here in the auth step.
 */
export async function proxy(request: NextRequest) {
  // Refresh the Supabase session on every request to keep auth alive
  return updateSession(request)
}

// Excluding static assets is critical for performance because the proxy
// has overhead on every matched request.
export const config = {
  matcher: [
    /*
     * Match all request paths EXCEPT:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico
     * - Any file with an extension (svg, png, jpg, jpeg, gif, webp)
     */
    '/((?!_next/static|_next/image|favicon.ico|[^?]*\\.(?:svg|png|jpg|jpeg|gif|webp)).*)',
  ],
}