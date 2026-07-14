/**
 * Account route loading boundary.
 */

import PageLoadingSkeleton from '../../components/ui/PageLoadingSkeleton'

export default function AccountLoading() {
  return <PageLoadingSkeleton title="Loading account" cards={2} rows={3} />
}
