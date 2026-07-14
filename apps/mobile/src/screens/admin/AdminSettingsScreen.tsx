/**
 * Admin settings screen backed by the web dashboard.
 */

import { WebDashboardScreen } from '../../components/web/WebDashboardScreen'

/**
 * Renders admin settings.
 *
 * @returns Web-backed settings screen.
 */
export default function AdminSettingsScreen() {
  return <WebDashboardScreen title="Settings" subtitle="Admin preferences" path="/dashboard/admin/settings" />
}
