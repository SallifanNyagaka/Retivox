/**
 * Owner notifications screen for Retivox mobile.
 */

import { DashboardScaffold } from '../shared/DashboardScaffold'

/**
 * Renders owner notifications.
 *
 * @returns Owner notifications screen.
 */
export default function OwnerNotificationsScreen() {
  return (
    <DashboardScaffold
      title="Notifications"
      subtitle="Owner alerts"
      emptyTitle="No notifications"
      emptySubtitle="Approvals, sync conflicts, and branch alerts will appear here."
    />
  )
}
