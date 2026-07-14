/**
 * Owner admins screen backed by the web dashboard.
 */

import { WebDashboardScreen } from '../../components/web/WebDashboardScreen'

/**
 * Renders owner admins.
 *
 * @returns Web-backed admins screen.
 */
export default function OwnerAdminsScreen() {
  return <WebDashboardScreen title="Admins" subtitle="Manage branch admins" path="/dashboard/owner/admins" />
}
