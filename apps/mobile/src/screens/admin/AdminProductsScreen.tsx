/**
 * Admin products screen backed by the web dashboard.
 */

import { WebDashboardScreen } from '../../components/web/WebDashboardScreen'

/**
 * Renders admin products.
 *
 * @returns Web-backed products screen.
 */
export default function AdminProductsScreen() {
  return <WebDashboardScreen title="Products" subtitle="Managed product view" path="/dashboard/admin/products" />
}
