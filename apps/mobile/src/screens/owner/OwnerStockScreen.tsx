/**
 * Owner stock screen backed by the web dashboard.
 */

import { WebDashboardScreen } from '../../components/web/WebDashboardScreen'

/**
 * Renders owner stock.
 *
 * @returns Web-backed stock screen.
 */
export default function OwnerStockScreen() {
  return <WebDashboardScreen title="Stock" subtitle="Deliveries and inventory" path="/dashboard/owner/stock" />
}
