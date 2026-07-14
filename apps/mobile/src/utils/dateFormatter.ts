/**
 * Date formatting utilities for Retivox mobile screens.
 *
 * Keeps human-readable date and relative-time labels consistent across roles.
 */

/**
 * Formats an ISO timestamp as a readable date and time.
 *
 * @param isoDate - ISO date string.
 * @returns Readable date label.
 */
export function formatDateTime(isoDate: string): string {
  return new Date(isoDate).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Formats an ISO timestamp as a short relative label.
 *
 * @param isoDate - ISO date string or null.
 * @returns Human-friendly relative label.
 */
export function formatRelativeTime(isoDate: string | null): string {
  if (!isoDate) {
    return 'Never'
  }

  const diffMs = Date.now() - new Date(isoDate).getTime()
  const diffMinutes = Math.max(0, Math.floor(diffMs / 60000))

  if (diffMinutes < 1) return 'Just now'
  if (diffMinutes < 60) return `${diffMinutes}m ago`

  const diffHours = Math.floor(diffMinutes / 60)
  if (diffHours < 24) return `${diffHours}h ago`

  return `${Math.floor(diffHours / 24)}d ago`
}
