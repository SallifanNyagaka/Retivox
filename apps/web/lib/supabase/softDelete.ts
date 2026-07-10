/**
 * Helpers for soft-delete-aware Supabase queries.
 *
 * These helpers keep owner dashboard pages compatible while the soft-delete
 * migration is being rolled out. Queries use `deleted_at IS NULL` when the
 * column exists, and safely retry without it when older databases do not have
 * the column yet.
 */

import logger from '../logger'

/**
 * Minimal shape returned by Supabase list queries.
 */
export type SoftDeleteQueryResult<Row> = {
  data: Row[] | null
  error: SoftDeleteQueryError | null
  count?: number | null
}

/**
 * Minimal Supabase/PostgREST error shape needed for fallback checks.
 */
type SoftDeleteQueryError = {
  code?: string
  message?: string
  details?: string | null
  hint?: string | null
}

/**
 * Context logged when a soft-delete fallback is used.
 */
type SoftDeleteFallbackContext = {
  table: string
  businessId?: string
  page?: string
}

/**
 * Supabase query builders are thenables, so accepting PromiseLike keeps the
 * helper compatible with PostgREST builders without losing row typing.
 */
type SoftDeleteQueryFactory<Row> = () => PromiseLike<SoftDeleteQueryResult<Row>>

/**
 * Detects the Postgres missing-column error for `deleted_at`.
 */
export function isMissingDeletedAtColumn(error: SoftDeleteQueryError | null) {
  return error?.code === '42703' && Boolean(error.message?.includes('deleted_at'))
}

/**
 * Runs a list query with soft-delete filtering, retrying without the filter
 * only when the database has not received the soft-delete migration yet.
 */
export async function runSoftDeleteAwareQuery<Row>(
  queryWithDeletedAtFilter: SoftDeleteQueryFactory<Row>,
  fallbackQuery: SoftDeleteQueryFactory<Row>,
  context: SoftDeleteFallbackContext
) {
  const response = await queryWithDeletedAtFilter()

  if (!isMissingDeletedAtColumn(response.error)) {
    return response
  }

  logger.warn('Soft-delete column missing; retrying query without deleted_at filter', {
    ...context,
    error: response.error,
  })

  return fallbackQuery()
}
