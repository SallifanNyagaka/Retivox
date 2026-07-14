/**
 * Unauthorized route loading boundary.
 */

import PageLoadingSkeleton from '../../components/ui/PageLoadingSkeleton'

export default function UnauthorizedLoading() {
  return <PageLoadingSkeleton title="Loading" cards={2} rows={2} />
}
