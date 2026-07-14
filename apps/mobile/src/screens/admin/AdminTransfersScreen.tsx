/**
 * Admin transfers screen backed by the web dashboard.
 */

import { WebDashboardScreen } from '../../components/web/WebDashboardScreen'

/**
 * Renders admin transfers.
 *
 * @returns Web-backed transfers screen.
 */
export default function AdminTransfersScreen() {
  return <WebDashboardScreen title="Transfers" subtitle="Managed stores" path="/dashboard/admin/transfers" />
}
