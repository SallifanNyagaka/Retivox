/**
 * Owner analytics screen backed by the web dashboard.
 */

import { WebDashboardScreen } from '../../components/web/WebDashboardScreen'

/**
 * Renders owner analytics.
 *
 * @returns Web-backed analytics screen.
 */
export default function OwnerAnalyticsScreen() {
  return <WebDashboardScreen title="Analytics" subtitle="Owner dashboard" path="/dashboard/owner/analytics" />
}
