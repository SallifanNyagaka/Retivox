/**
 * Owner branches screen backed by the web dashboard.
 */

import { WebDashboardScreen } from '../../components/web/WebDashboardScreen'

/**
 * Renders owner branches.
 *
 * @returns Web-backed branches screen.
 */
export default function OwnerBranchesScreen() {
  return <WebDashboardScreen title="Branches" subtitle="Add and manage stores" path="/dashboard/owner/branches" />
}
