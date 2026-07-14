/**
 * WatermelonDB branch stock model for local stock snapshots.
 */

import { Model } from '@nozbe/watermelondb'
import { date, field, text } from '@nozbe/watermelondb/decorators'

export class BranchStockModel extends Model {
  static table = 'branch_stock'

  @text('server_id') serverId?: string
  @text('branch_id') branchId!: string
  @text('product_id') productId!: string
  @field('quantity_on_hand') quantityOnHand!: number
  @field('quantity_reserved') quantityReserved!: number
  @field('low_stock_threshold') lowStockThreshold!: number
  @date('last_synced_at') lastSyncedAt?: Date
}
