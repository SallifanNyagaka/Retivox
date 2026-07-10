/**
 * Admin transfers dashboard page.
 *
 * Reuses the shared owner transfer UI while scoping transfers to branches where
 * the current user has at least admin-level effective access.
 */

import { GlobalRole } from '@smartretail/shared'
import { requireRole } from '../../../../lib/auth/helpers'
import { TransfersDashboardContent } from '../../owner/transfers/page'

/**
 * Admin transfers page server component.
 */
export default async function AdminTransfersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; transfer?: string }>
}) {
  const profile = await requireRole([GlobalRole.Admin])

  return (
    <TransfersDashboardContent
      searchParams={searchParams}
      profile={profile}
      basePath="/dashboard/admin/transfers"
      subtitle="Move stock between branches you manage and track every transfer from initiation to receipt."
    />
  )
}
