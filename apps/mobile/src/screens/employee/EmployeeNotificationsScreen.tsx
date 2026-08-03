/**
 * Employee notifications screen for Retivox mobile.
 *
 * Shows an empty-state-ready notification inbox shell for assigned employee
 * alerts, sync conflicts, and account messages.
 */

import { NotificationsScreen } from '../shared/NotificationsScreen'

/**
 * Renders employee notifications.
 *
 * @returns Employee notifications screen.
 */
export default function EmployeeNotificationsScreen() {
  return <NotificationsScreen title="Notifications" subtitle="Employee alerts" />
}
