/**
 * Owner audit screen backed by the web dashboard.
 */

import { WebDashboardScreen } from '../../components/web/WebDashboardScreen'

/**
 * Renders owner audit log.
 *
 * @returns Web-backed audit screen.
 */
export default function OwnerAuditScreen() {
  return <WebDashboardScreen title="Audit Log" subtitle="System activity" path="/dashboard/owner/audit" />
}
