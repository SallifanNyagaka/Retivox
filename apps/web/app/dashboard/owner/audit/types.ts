/**
 * Shared types for the owner audit log dashboard.
 *
 * These shapes keep audit log data, filters, and option lists typed without
 * relying on any untyped Supabase result handling.
 */

/**
 * JSON values supported by Supabase JSONB audit columns.
 */
export type JsonValue = string | number | boolean | null | JsonObject | JsonValue[]

/**
 * JSON object shape for audit old_value and new_value columns.
 */
export type JsonObject = {
  [key: string]: JsonValue
}

/**
 * Raw audit log row fetched from Supabase.
 */
export type AuditLogRow = {
  id: string
  actor_id: string
  entity_type: string
  entity_id: string
  action: string
  old_value: JsonValue
  new_value: JsonValue
  created_at: string
}

/**
 * Minimal user row used to hydrate audit actor labels.
 */
export type AuditActorRow = {
  id: string
  name: string
  email: string
}

/**
 * Audit log row with actor labels added for display.
 */
export type AuditLogView = AuditLogRow & {
  actor_name: string
  actor_email: string | null
}

/**
 * URL-backed audit log filters.
 */
export type AuditFilters = {
  dateFrom: string
  dateTo: string
  actor: string
  action: string
  entityType: string
  page: number
}

/**
 * Unique option lists shown in audit filters.
 */
export type AuditFilterOptions = {
  actions: string[]
  entityTypes: string[]
}

/**
 * Summary metrics shown above the audit table.
 */
export type AuditMetrics = {
  totalMatching: number
  actorCount: number
  actionTypeCount: number
  entityTypeCount: number
}
