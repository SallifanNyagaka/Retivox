/**
 * Owner audit log dashboard page.
 *
 * Loads immutable audit log entries with URL-backed filters, actor labels,
 * action/entity filter options, and 50-row pagination.
 */

import { z } from 'zod'
import { GlobalRole } from '@smartretail/shared'
import { requireRole } from '../../../../lib/auth/helpers'
import { createClient } from '../../../../lib/supabase/server'
import logger from '../../../../lib/logger'
import { Card } from '../../../../components/ui/Card'
import AuditPageView from './AuditPageView'
import type {
  AuditActorRow,
  AuditFilterOptions,
  AuditFilters,
  AuditLogRow,
  AuditLogView,
  AuditMetrics,
} from './types'

/**
 * Number of immutable audit entries displayed per page.
 */
const PAGE_SIZE = 50

/**
 * Expected search params shape in the Next.js app router.
 */
type AuditSearchParams = Promise<{
  date_from?: string
  date_to?: string
  actor?: string
  action?: string
  entity_type?: string
  page?: string
}>

type AuditOptionsSummary = {
  actions: string[]
  entityTypes: string[]
  actorCount: number
}

/**
 * Reads and trims a single URL search param.
 */
function readParam(value: string | undefined) {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Parses an optional UUID URL value.
 */
function parseOptionalUuid(value: string) {
  if (!value) {
    return ''
  }

  const result = z.string().uuid().safeParse(value)
  return result.success ? result.data : ''
}

/**
 * Parses an optional YYYY-MM-DD date URL value.
 */
function parseOptionalDate(value: string) {
  if (!value) {
    return ''
  }

  const result = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).safeParse(value)
  return result.success ? result.data : ''
}

/**
 * Parses a compact text filter used for action and entity types.
 */
function parseOptionalAuditText(value: string) {
  if (!value) {
    return ''
  }

  const result = z.string().trim().min(1).max(80).regex(/^[a-zA-Z0-9_-]+$/).safeParse(value)
  return result.success ? result.data : ''
}

/**
 * Parses and validates all audit URL filters before querying.
 */
async function parseFilters(searchParams: AuditSearchParams): Promise<AuditFilters> {
  const params = await searchParams
  const rawPage = Number(readParam(params.page))

  return {
    dateFrom: parseOptionalDate(readParam(params.date_from)),
    dateTo: parseOptionalDate(readParam(params.date_to)),
    actor: parseOptionalUuid(readParam(params.actor)),
    action: parseOptionalAuditText(readParam(params.action)),
    entityType: parseOptionalAuditText(readParam(params.entity_type)),
    page: Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1,
  }
}

/**
 * Converts a date input value to the start-of-day ISO timestamp.
 */
function getDateFromIso(dateValue: string) {
  const date = new Date(`${dateValue}T00:00:00.000`)
  return date.toISOString()
}

/**
 * Converts a date input value to the inclusive end-of-day ISO timestamp.
 */
function getDateToIso(dateValue: string) {
  const date = new Date(`${dateValue}T23:59:59.999`)
  return date.toISOString()
}

/**
 * Owner audit log page server component.
 */
export default async function AuditPage({ searchParams }: { searchParams: AuditSearchParams }) {
  const profile = await requireRole([GlobalRole.Owner])
  const businessId = profile.business_id

  if (!businessId) {
    throw new Error('Owner profile missing business ID')
  }

  const filters = await parseFilters(searchParams)
  let logs: AuditLogView[] = []
  let actors: AuditActorRow[] = []
  let options: AuditFilterOptions = { actions: [], entityTypes: [] }
  let metrics: AuditMetrics = {
    totalMatching: 0,
    actorCount: 0,
    actionTypeCount: 0,
    entityTypeCount: 0,
  }
  let totalPages = 1
  let pageError: string | null = null

  try {
    const supabase = await createClient()

    const [actorsResponse, optionsResponse] = await Promise.all([
      supabase.from('users').select('id, name, email').eq('business_id', businessId).order('name'),
      supabase.rpc('owner_audit_filter_options'),
    ])

    if (actorsResponse.error) {
      throw actorsResponse.error
    }

    if (optionsResponse.error) {
      throw optionsResponse.error
    }

    actors = (actorsResponse.data ?? []) as AuditActorRow[]
    const optionsSummary = optionsResponse.data as AuditOptionsSummary | null
    options = {
      actions: Array.from(new Set([...(optionsSummary?.actions ?? []), filters.action].filter(Boolean))).sort(),
      entityTypes: Array.from(new Set([...(optionsSummary?.entityTypes ?? []), filters.entityType].filter(Boolean))).sort(),
    }

    let auditQuery = supabase
      .from('audit_logs')
      .select('id, actor_id, entity_type, entity_id, action, old_value, new_value, created_at', { count: 'exact' })
      .eq('business_id', businessId)
      .order('created_at', { ascending: false })

    if (filters.dateFrom) {
      auditQuery = auditQuery.gte('created_at', getDateFromIso(filters.dateFrom))
    }

    if (filters.dateTo) {
      auditQuery = auditQuery.lte('created_at', getDateToIso(filters.dateTo))
    }

    if (filters.actor) {
      auditQuery = auditQuery.eq('actor_id', filters.actor)
    }

    if (filters.action) {
      auditQuery = auditQuery.eq('action', filters.action)
    }

    if (filters.entityType) {
      auditQuery = auditQuery.eq('entity_type', filters.entityType)
    }

    const pageOffset = (filters.page - 1) * PAGE_SIZE
    const auditResponse = await auditQuery.range(pageOffset, pageOffset + PAGE_SIZE - 1)

    if (auditResponse.error) {
      throw auditResponse.error
    }

    const auditRows = (auditResponse.data ?? []) as AuditLogRow[]
    metrics = {
      totalMatching: auditResponse.count ?? 0,
      actorCount: optionsSummary?.actorCount ?? 0,
      actionTypeCount: options.actions.length,
      entityTypeCount: options.entityTypes.length,
    }
    totalPages = Math.max(1, Math.ceil(metrics.totalMatching / PAGE_SIZE))

    const actorMap: Record<string, AuditActorRow> = {}
    actors.forEach((actor) => {
      actorMap[actor.id] = actor
    })

    logs = auditRows.map((log) => {
      const actor = actorMap[log.actor_id] ?? null

      return {
        ...log,
        actor_name: actor?.name ?? 'Unknown actor',
        actor_email: actor?.email ?? null,
      }
    })
  } catch (error: unknown) {
    logger.error('AuditPage data fetch failed', { businessId, filters, error })
    pageError = error instanceof Error ? error.message : 'Unable to load audit log'
  }

  if (pageError) {
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h1
            className="font-bold"
            style={{
              fontSize: '22px',
              color: 'var(--color-text-primary)',
              letterSpacing: '-0.3px',
            }}
          >
            Audit log
          </h1>
          <p style={{ fontSize: '14px', color: 'var(--color-text-muted)', marginTop: '4px' }}>
            Track who changed what across the business.
          </p>
        </div>

        <Card>
          <p style={{ fontSize: '14px', color: 'var(--color-danger)', margin: 0 }}>
            Failed to load the audit log. Please refresh and try again.
          </p>
        </Card>
      </div>
    )
  }

  return (
    <AuditPageView
      logs={logs}
      actors={actors}
      filters={filters}
      options={options}
      metrics={metrics}
      totalPages={totalPages}
    />
  )
}
