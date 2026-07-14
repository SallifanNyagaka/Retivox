/**
 * Runtime environment configuration for Retivox mobile.
 *
 * Expo only exposes public environment variables prefixed with EXPO_PUBLIC_.
 * The NEXT_PUBLIC_ fallbacks make local sharing with the web app easier when
 * Metro is configured to load them, but EXPO_PUBLIC_ remains the mobile source
 * of truth.
 */

export const SUPABASE_URL =
  process.env.EXPO_PUBLIC_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''

export const SUPABASE_ANON_KEY =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''

export const WEB_APP_URL = process.env.EXPO_PUBLIC_WEB_APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? ''

export const isSupabaseConfigured = SUPABASE_URL.length > 0 && SUPABASE_ANON_KEY.length > 0

/**
 * Returns the missing mobile environment keys.
 *
 * @returns List of missing Expo public env keys.
 */
export function getMissingEnvironmentKeys(): string[] {
  const missingKeys: string[] = []

  if (!SUPABASE_URL) {
    missingKeys.push('EXPO_PUBLIC_SUPABASE_URL')
  }

  if (!SUPABASE_ANON_KEY) {
    missingKeys.push('EXPO_PUBLIC_SUPABASE_ANON_KEY')
  }

  return missingKeys
}
