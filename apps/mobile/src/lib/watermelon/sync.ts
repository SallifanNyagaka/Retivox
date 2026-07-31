/**
 * Mobile synchronization coordinator.
 *
 * Supabase remains authoritative. When online we first submit every durable
 * local write, then refresh the logged-in user's Watermelon-backed snapshot.
 */

import { GlobalRole } from '@smartretail/shared'
import type { UserProfile } from '../../store/authStore'
import { fetchAdminDashboardSummary, fetchOwnerDashboardSummary } from '../dashboard/roleDashboardApi'
import { fetchEmployeeDashboardData } from '../employee/employeeApi'
import { processSyncQueue, type SyncProcessResult } from '../sync/processor'

/**
 * Synchronizes staged writes and the current user's cached UI data.
 */
export async function runWatermelonSync(profile: UserProfile): Promise<SyncProcessResult> {
  const result = await processSyncQueue()

  if (profile.globalRole === GlobalRole.Employee && profile.branchId) {
    await fetchEmployeeDashboardData(profile.businessId, profile.branchId, profile.id)
  } else if (profile.globalRole === GlobalRole.Owner) {
    await fetchOwnerDashboardSummary(profile.businessId)
  } else if (profile.globalRole === GlobalRole.Admin) {
    await fetchAdminDashboardSummary(profile.businessId)
  }

  return result
}
