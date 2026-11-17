import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Checks the normalized global Retivox user directory using a service client.
 * The database unique index remains the final guard against concurrent writes.
 */
export async function isRetivoxEmailInUse(client: SupabaseClient, email: string): Promise<boolean> {
  const { data, error } = await client.rpc('retivox_account_email_in_use', {
    p_email: email.trim().toLowerCase(),
  })
  if (error) throw new Error('We could not verify this email right now. Please try again shortly.')
  return data === true
}

export async function findRetivoxEmailsInUse(client: SupabaseClient, emails: string[]): Promise<string[]> {
  const normalized = [...new Set(emails.map((email) => email.trim().toLowerCase()).filter(Boolean))]
  const matches: string[] = []
  for (let index = 0; index < normalized.length; index += 20) {
    const batch = normalized.slice(index, index + 20)
    const results = await Promise.all(batch.map(async (email) => ({ email, used: await isRetivoxEmailInUse(client, email) })))
    matches.push(...results.filter((result) => result.used).map((result) => result.email))
  }
  return matches
}

export const RETIVOX_EMAIL_IN_USE_MESSAGE =
  'This email is already linked to a Retivox account. Use another email, or ask an authorized owner/admin to close the existing account before reusing it.'
