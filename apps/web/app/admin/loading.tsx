/**
 * Admin public route loading boundary.
 */

import PageLoadingSkeleton from '../../components/ui/PageLoadingSkeleton'

export default function AdminPublicLoading() {
  return <PageLoadingSkeleton title="Loading admin portal" cards={2} rows={3} />
}
