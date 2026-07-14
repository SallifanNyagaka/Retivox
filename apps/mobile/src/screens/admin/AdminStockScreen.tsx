/**
 * Admin stock screen backed by the web dashboard.
 */

import { WebDashboardScreen } from '../../components/web/WebDashboardScreen'

/**
 * Renders admin stock.
 *
 * @returns Web-backed stock screen.
 */
export default function AdminStockScreen() {
  return <WebDashboardScreen title="Stock" subtitle="Managed stores" path="/dashboard/admin/stock" />
}
