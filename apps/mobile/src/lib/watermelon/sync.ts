/**
 * WatermelonDB sync engine for Retivox mobile.
 *
 * Pulls branch-scoped products, stock, and prices from Supabase and processes
 * queued local transaction writes when online.
 */

import { synchronize } from '@nozbe/watermelondb/sync'
import { database } from './database'
import { supabase } from '../supabase/client'
import type { UserProfile } from '../../store/authStore'
import { processSyncQueue } from '../sync/processor'

type ChangeSet = {
  created: Record<string, unknown>[]
  updated: Record<string, unknown>[]
  deleted: string[]
}

type PullChanges = {
  products: ChangeSet
  branch_stock: ChangeSet
  branch_product_prices: ChangeSet
}

/**
 * Builds an empty WatermelonDB table change set.
 *
 * @returns Empty change set.
 */
function emptyChangeSet(): ChangeSet {
  return { created: [], updated: [], deleted: [] }
}

/**
 * Pulls branch-scoped changes from Supabase.
 *
 * @param profile - Current user profile.
 * @param lastPulledAt - Last sync timestamp.
 * @returns Pull changes in WatermelonDB format.
 */
async function pullBranchChanges(profile: UserProfile, lastPulledAt: number | null): Promise<{ changes: PullChanges; timestamp: number }> {
  const since = lastPulledAt ? new Date(lastPulledAt).toISOString() : new Date(0).toISOString()
  const branchId = profile.branchId
  const businessId = profile.businessId

  if (!branchId) {
    return {
      changes: {
        products: emptyChangeSet(),
        branch_stock: emptyChangeSet(),
        branch_product_prices: emptyChangeSet(),
      },
      timestamp: Date.now(),
    }
  }

  const [productsResponse, stockResponse, pricesResponse] = await Promise.all([
    supabase
      .from('products')
      .select('id, name, sku, category, unit, is_active, updated_at')
      .eq('business_id', businessId)
      .gte('updated_at', since),
    supabase
      .from('branch_stock')
      .select('id, branch_id, product_id, quantity_on_hand, quantity_reserved, low_stock_threshold, last_updated_at')
      .eq('branch_id', branchId)
      .eq('business_id', businessId)
      .gte('last_updated_at', since),
    supabase
      .from('branch_product_prices')
      .select('id, product_id, branch_id, selling_price, status, updated_at')
      .eq('branch_id', branchId)
      .eq('business_id', businessId)
      .gte('updated_at', since),
  ])

  if (productsResponse.error) throw productsResponse.error
  if (stockResponse.error) throw stockResponse.error
  if (pricesResponse.error) throw pricesResponse.error

  return {
    changes: {
      products: { created: [], updated: (productsResponse.data ?? []) as Record<string, unknown>[], deleted: [] },
      branch_stock: { created: [], updated: (stockResponse.data ?? []) as Record<string, unknown>[], deleted: [] },
      branch_product_prices: { created: [], updated: (pricesResponse.data ?? []) as Record<string, unknown>[], deleted: [] },
    },
    timestamp: Date.now(),
  }
}

/**
 * Runs a full mobile sync pass.
 *
 * @param profile - Current user profile.
 * @returns Promise that resolves after sync.
 */
export async function runWatermelonSync(profile: UserProfile): Promise<void> {
  await synchronize({
    database,
    pullChanges: async ({ lastPulledAt }) => pullBranchChanges(profile, lastPulledAt ?? null),
    pushChanges: async () => {
      await processSyncQueue()
    },
  })
}
