/**
 * Owner products screen backed by the web dashboard.
 */

import { WebDashboardScreen } from '../../components/web/WebDashboardScreen'

/**
 * Renders owner products.
 *
 * @returns Web-backed products screen.
 */
export default function OwnerProductsScreen() {
  return <WebDashboardScreen title="Products" subtitle="Catalog and pricing" path="/dashboard/owner/products" />
}
