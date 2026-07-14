/**
 * Owner settings screen backed by the web dashboard.
 */

import { WebDashboardScreen } from '../../components/web/WebDashboardScreen'

/**
 * Renders owner settings.
 *
 * @returns Web-backed settings screen.
 */
export default function OwnerSettingsScreen() {
  return <WebDashboardScreen title="Settings" subtitle="Business configuration" path="/dashboard/owner/settings" />
}
