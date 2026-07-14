/**
 * Owner finances screen backed by the web dashboard.
 */

import { WebDashboardScreen } from '../../components/web/WebDashboardScreen'

/**
 * Renders owner finances.
 *
 * @returns Web-backed finances screen.
 */
export default function OwnerFinancesScreen() {
  return <WebDashboardScreen title="Finances" subtitle="Expenses and approvals" path="/dashboard/owner/finances" />
}
