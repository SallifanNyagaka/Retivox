/**
 * Owner transactions screen backed by the web dashboard.
 */

import { WebDashboardScreen } from '../../components/web/WebDashboardScreen'

/**
 * Renders owner transactions.
 *
 * @returns Web-backed transactions screen.
 */
export default function OwnerTransactionsScreen() {
  return <WebDashboardScreen title="Transactions" subtitle="Owner dashboard" path="/dashboard/owner/transactions" />
}
