/**
 * Owner employees screen backed by the web dashboard.
 */

import { WebDashboardScreen } from '../../components/web/WebDashboardScreen'

/**
 * Renders owner employees.
 *
 * @returns Web-backed employees screen.
 */
export default function OwnerEmployeesScreen() {
  return <WebDashboardScreen title="Employees" subtitle="Manage branch staff" path="/dashboard/owner/employees" />
}
