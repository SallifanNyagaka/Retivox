/**
 * Owner transfers screen backed by the web dashboard.
 */

import { WebDashboardScreen } from '../../components/web/WebDashboardScreen'

/**
 * Renders owner transfers.
 *
 * @returns Web-backed transfers screen.
 */
export default function OwnerTransfersScreen() {
  return <WebDashboardScreen title="Transfers" subtitle="Move stock between stores" path="/dashboard/owner/transfers" />
}
