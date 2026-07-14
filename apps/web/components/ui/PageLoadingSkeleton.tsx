/**
 * Shared page loading skeleton for Retivox.
 *
 * Used by Next.js route loading boundaries so every endpoint transition shows
 * shimmering placeholders that match the dashboard structure.
 */

export type PageLoadingSkeletonProps = {
  title?: string
  cards?: number
  rows?: number
  showSidebar?: boolean
}

/**
 * Renders metric-card and table-like loading placeholders.
 *
 * @param props - Skeleton configuration.
 * @returns Loading skeleton UI.
 */
export default function PageLoadingSkeleton({
  title = 'Loading',
  cards = 4,
  rows = 6,
  showSidebar = false,
}: PageLoadingSkeletonProps) {
  return (
    <div className="retivox-skeleton-page" aria-label={title} aria-busy="true">
      {showSidebar ? (
        <aside className="retivox-skeleton-sidebar">
          <div className="retivox-skeleton-block retivox-skeleton-logo" />
          {Array.from({ length: 8 }).map((_, index) => (
            <div key={`sidebar-${index}`} className="retivox-skeleton-nav-row">
              <div className="retivox-skeleton-block retivox-skeleton-dot" />
              <div className="retivox-skeleton-block retivox-skeleton-nav-label" />
            </div>
          ))}
        </aside>
      ) : null}

      <section className="retivox-skeleton-main">
        <div className="retivox-skeleton-header">
          <div>
            <div className="retivox-skeleton-block retivox-skeleton-title" />
            <div className="retivox-skeleton-block retivox-skeleton-subtitle" />
          </div>
          <div className="retivox-skeleton-block retivox-skeleton-button" />
        </div>

        <div className="retivox-skeleton-grid">
          {Array.from({ length: cards }).map((_, index) => (
            <div key={`card-${index}`} className="retivox-skeleton-card">
              <div className="retivox-skeleton-block retivox-skeleton-card-label" />
              <div className="retivox-skeleton-block retivox-skeleton-card-value" />
              <div className="retivox-skeleton-block retivox-skeleton-card-note" />
            </div>
          ))}
        </div>

        <div className="retivox-skeleton-table">
          <div className="retivox-skeleton-table-header">
            <div className="retivox-skeleton-block retivox-skeleton-table-title" />
            <div className="retivox-skeleton-block retivox-skeleton-table-action" />
          </div>
          {Array.from({ length: rows }).map((_, index) => (
            <div key={`row-${index}`} className="retivox-skeleton-table-row">
              <div className="retivox-skeleton-block retivox-skeleton-row-primary" />
              <div className="retivox-skeleton-block retivox-skeleton-row-secondary" />
              <div className="retivox-skeleton-block retivox-skeleton-row-badge" />
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
