/**
 * Employee notifications screen for Retivox mobile.
 *
 * Shows an empty-state-ready notification inbox shell for assigned employee
 * alerts, sync conflicts, and account messages.
 */

import { DashboardScaffold } from '../shared/DashboardScaffold'

/**
 * Renders employee notifications.
 *
 * @returns Employee notifications screen.
 */
export default function EmployeeNotificationsScreen() {
  return (
    <DashboardScaffold
      title="Notifications"
      subtitle="Employee alerts"
      emptyTitle="No notifications"
      emptySubtitle="Sale reviews, sync conflicts, and manager messages will appear here."
    />
  )
}
