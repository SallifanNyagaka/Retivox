/**
 * Supabase client configured for Retivox React Native.
 *
 * Auth session data is persisted with Expo SecureStore so JWT material is not
 * stored in plain AsyncStorage on shared shop devices.
 */

import AsyncStorage from '@react-native-async-storage/async-storage'
import { createClient, type SupportedStorage } from '@supabase/supabase-js'
import * as SecureStore from 'expo-secure-store'
import { SUPABASE_ANON_KEY, SUPABASE_URL, isSupabaseConfigured } from '../config/env'

const SESSION_METADATA_KEY = 'retivox:supabase-session-metadata'

if (!isSupabaseConfigured) {
  console.warn('Retivox mobile Supabase environment variables are missing.')
}

const secureStorageAdapter: SupportedStorage = {
  /**
   * Reads a persisted value from SecureStore.
   *
   * @param key - Storage key.
   * @returns Stored value or null.
   */
  async getItem(key: string): Promise<string | null> {
    return SecureStore.getItemAsync(key)
  },

  /**
   * Writes a persisted value to SecureStore and records the key in AsyncStorage
   * for troubleshooting metadata only.
   *
   * @param key - Storage key.
   * @param value - Storage value.
   * @returns Void.
   */
  async setItem(key: string, value: string): Promise<void> {
    await SecureStore.setItemAsync(key, value)
    await AsyncStorage.setItem(SESSION_METADATA_KEY, JSON.stringify({ authStorageKey: key, updatedAt: new Date().toISOString() }))
  },

  /**
   * Removes a persisted value from SecureStore.
   *
   * @param key - Storage key.
   * @returns Void.
   */
  async removeItem(key: string): Promise<void> {
    await SecureStore.deleteItemAsync(key)
    await AsyncStorage.removeItem(SESSION_METADATA_KEY)
  },
}

export const supabase = createClient(
  isSupabaseConfigured ? SUPABASE_URL : 'https://placeholder.supabase.co',
  isSupabaseConfigured ? SUPABASE_ANON_KEY : 'placeholder-anon-key',
  {
  auth: {
    autoRefreshToken: true,
    detectSessionInUrl: false,
    persistSession: true,
    storage: secureStorageAdapter,
  },
  },
)

/**
 * Clears all mobile session storage.
 *
 * @returns Promise that resolves after storage is cleared.
 */
export async function clearSupabaseStorage(): Promise<void> {
  const metadataValue = await AsyncStorage.getItem(SESSION_METADATA_KEY)
  const metadata = typeof metadataValue === 'string' ? safeParseMetadata(metadataValue) : null

  if (metadata?.authStorageKey) {
    await SecureStore.deleteItemAsync(metadata.authStorageKey)
  }

  await AsyncStorage.removeItem(SESSION_METADATA_KEY)
}

/**
 * Safely parses session storage metadata.
 *
 * @param value - Serialized metadata.
 * @returns Parsed metadata or null.
 */
function safeParseMetadata(value: string): { authStorageKey?: string } | null {
  try {
    const parsed = JSON.parse(value) as unknown

    if (parsed && typeof parsed === 'object' && 'authStorageKey' in parsed) {
      const authStorageKey = (parsed as { authStorageKey?: unknown }).authStorageKey
      return typeof authStorageKey === 'string' ? { authStorageKey } : null
    }

    return null
  } catch {
    return null
  }
}
