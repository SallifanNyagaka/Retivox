/**
 * Employee public route loading boundary.
 */

import PageLoadingSkeleton from '../../components/ui/PageLoadingSkeleton'

export default function EmployeePublicLoading() {
  return <PageLoadingSkeleton title="Loading employee portal" cards={2} rows={3} />
}
