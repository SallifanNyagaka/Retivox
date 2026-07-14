/**
 * Auth route loading boundary.
 */

import PageLoadingSkeleton from '../../components/ui/PageLoadingSkeleton'

export default function AuthLoading() {
  return <PageLoadingSkeleton title="Loading authentication" cards={2} rows={3} />
}
