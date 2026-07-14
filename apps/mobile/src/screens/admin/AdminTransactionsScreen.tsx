/**
 * Admin transactions screen backed by the web dashboard.
 */

import { WebDashboardScreen } from '../../components/web/WebDashboardScreen'

/**
 * Renders admin transactions.
 *
 * @returns Web-backed transactions screen.
 */
export default function AdminTransactionsScreen() {
  return <WebDashboardScreen title="Transactions" subtitle="Managed stores" path="/dashboard/admin/transactions" />
}
