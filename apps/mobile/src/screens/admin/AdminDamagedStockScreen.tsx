/**
 * Admin damaged stock screen backed by the web dashboard.
 */

import { WebDashboardScreen } from '../../components/web/WebDashboardScreen'

/**
 * Renders admin damaged stock workflow.
 *
 * @returns Web-backed damaged stock screen.
 */
export default function AdminDamagedStockScreen() {
  return <WebDashboardScreen title="Damaged Stock" subtitle="Report store damage" path="/dashboard/admin/damaged-stock" />
}
