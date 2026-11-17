/**
 * Resolve the status users should see from persisted subscription state.
 * The database write-window trigger already blocks writes after the period
 * ends; the lifecycle job eventually persists past_due/expired, but the date
 * check keeps screens correct between scheduled runs.
 */
export function effectiveSubscriptionStatus(
  status: string | null | undefined,
  currentPeriodEnd: string | null | undefined,
  now = Date.now(),
  options: { isTrial?: boolean; cancelledAt?: string | null } = {},
): string {
  const normalizedStatus = status?.trim().toLowerCase() || 'unknown'
  if (!['active', 'trial'].includes(normalizedStatus) || !currentPeriodEnd) {
    return normalizedStatus
  }

  const periodEndTime = Date.parse(currentPeriodEnd)
  if (Number.isFinite(periodEndTime) && periodEndTime <= now) {
    if (options.isTrial || options.cancelledAt || normalizedStatus === 'trial' || normalizedStatus === 'cancelled') {
      return 'expired'
    }
    return periodEndTime + 7 * 24 * 60 * 60 * 1000 > now ? 'past_due' : 'expired'
  }
  return normalizedStatus
}
