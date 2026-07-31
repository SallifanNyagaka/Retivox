/**
 * Small cache for owner/admin dashboard summaries.
 */

import { readMobileCache, writeMobileCache } from '../watermelon/cache'
import AsyncStorage from '@react-native-async-storage/async-storage'

function key(role: 'owner' | 'admin', businessId: string): string {
  return `role-dashboard:${role}:${businessId}`
}

export async function readRoleDashboardSnapshot<T>(role: 'owner' | 'admin', businessId: string): Promise<T | null> {
  const cached = await readMobileCache<T>(key(role, businessId))
  if (cached) return cached

  try {
    const legacyValue = await AsyncStorage.getItem(`retivox:${role}-dashboard:${businessId}`)
    if (!legacyValue) return null
    const legacySnapshot = JSON.parse(legacyValue) as T
    await writeRoleDashboardSnapshot(role, businessId, legacySnapshot)
    return legacySnapshot
  } catch {
    return null
  }
}

export async function writeRoleDashboardSnapshot<T>(role: 'owner' | 'admin', businessId: string, value: T): Promise<void> {
  try {
    await writeMobileCache(key(role, businessId), value)
  } catch {
    // Dashboard caching is best-effort.
  }
}
