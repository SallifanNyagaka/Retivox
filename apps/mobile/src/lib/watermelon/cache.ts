/**
 * Small typed facade over WatermelonDB's durable UI snapshot store.
 */

import { Q } from '@nozbe/watermelondb'
import { database } from './database'
import { MobileCacheModel } from './models/MobileCache'

/**
 * Reads a serialized cache value without making a network request.
 */
export async function readMobileCache<T>(cacheKey: string): Promise<T | null> {
  try {
    const records = await database.get<MobileCacheModel>('mobile_cache').query(Q.where('cache_key', cacheKey)).fetch()
    const record = records[0]
    return record ? (JSON.parse(record.payload) as T) : null
  } catch {
    return null
  }
}

/**
 * Stores a cache value in WatermelonDB. A cache key always has one current row.
 */
export async function writeMobileCache<T>(cacheKey: string, value: T): Promise<void> {
  await database.write(async () => {
    const collection = database.get<MobileCacheModel>('mobile_cache')
    const records = await collection.query(Q.where('cache_key', cacheKey)).fetch()
    const payload = JSON.stringify(value)

    if (records[0]) {
      await records[0].update((record) => {
        record.payload = payload
        record.updatedAt = new Date()
      })
      return
    }

    await collection.create((record) => {
      record.cacheKey = cacheKey
      record.payload = payload
      record.updatedAt = new Date()
    })
  })
}

/**
 * Reads every durable snapshot. This is only used for local branch fallback,
 * where the device has a very small number of signed-in employee profiles.
 */
export async function readAllMobileCache<T>(): Promise<Array<{ cacheKey: string; value: T }>> {
  try {
    const records = await database.get<MobileCacheModel>('mobile_cache').query().fetch()
    return records.flatMap((record) => {
      try {
        return [{ cacheKey: record.cacheKey, value: JSON.parse(record.payload) as T }]
      } catch {
        return []
      }
    })
  } catch {
    return []
  }
}
