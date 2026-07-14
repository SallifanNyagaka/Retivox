/**
 * Admin employees screen backed by the web dashboard.
 */

import { WebDashboardScreen } from '../../components/web/WebDashboardScreen'

/**
 * Renders admin employees.
 *
 * @returns Web-backed employees screen.
 */
export default function AdminEmployeesScreen() {
  return <WebDashboardScreen title="Employees" subtitle="Managed store staff" path="/dashboard/admin/employees" />
}
