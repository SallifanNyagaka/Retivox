/**
 * Small cache for owner/admin dashboard summaries.
 */

import AsyncStorage from '@react-native-async-storage/async-storage'

function key(role: 'owner' | 'admin', businessId: string): string {
  return `retivox:${role}-dashboard:${businessId}`
}

export async function readRoleDashboardSnapshot<T>(role: 'owner' | 'admin', businessId: string): Promise<T | null> {
  try {
    const value = await AsyncStorage.getItem(key(role, businessId))
    return value ? (JSON.parse(value) as T) : null
  } catch {
    return null
  }
}

export async function writeRoleDashboardSnapshot<T>(role: 'owner' | 'admin', businessId: string, value: T): Promise<void> {
  try {
    await AsyncStorage.setItem(key(role, businessId), JSON.stringify(value))
  } catch {
    // Dashboard caching is best-effort.
  }
}

