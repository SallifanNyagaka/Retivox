/**
 * WatermelonDB branch product price model for offline sale pricing snapshots.
 */

import { Model } from '@nozbe/watermelondb'
import { date, field, text } from '@nozbe/watermelondb/decorators'

export class BranchProductPriceModel extends Model {
  static table = 'branch_product_prices'

  @text('server_id') serverId?: string
  @text('product_id') productId!: string
  @text('branch_id') branchId!: string
  @field('selling_price') sellingPrice!: number
  @text('status') status!: string
  @date('last_synced_at') lastSyncedAt?: Date
}
