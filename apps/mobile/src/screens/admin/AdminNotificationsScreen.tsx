/**
 * Admin notifications screen for Retivox mobile.
 */

import { DashboardScaffold } from '../shared/DashboardScaffold'

/**
 * Renders admin notifications.
 *
 * @returns Admin notifications screen.
 */
export default function AdminNotificationsScreen() {
  return (
    <DashboardScaffold
      title="Notifications"
      subtitle="Admin alerts"
      emptyTitle="No notifications"
      emptySubtitle="Stock alerts, sync conflicts, and transfer updates will appear here."
    />
  )
}
