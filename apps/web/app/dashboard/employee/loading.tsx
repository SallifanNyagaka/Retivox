/**
 * Employee dashboard loading boundary.
 */

import PageLoadingSkeleton from '../../../components/ui/PageLoadingSkeleton'

export default function EmployeeDashboardLoading() {
  return <PageLoadingSkeleton title="Loading employee dashboard" cards={2} rows={5} />
}
