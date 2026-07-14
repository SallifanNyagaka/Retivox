/**
 * WatermelonDB transaction item model for offline sale lines.
 */

import { Model } from '@nozbe/watermelondb'
import { field, text } from '@nozbe/watermelondb/decorators'

export class TransactionItemModel extends Model {
  static table = 'transaction_items'

  @text('server_id') serverId?: string
  @text('transaction_id') transactionId!: string
  @text('product_id') productId!: string
  @field('quantity') quantity!: number
  @field('unit_price_at_sale') unitPriceAtSale!: number
  @field('line_total') lineTotal!: number
  @text('stock_status') stockStatus!: string
  @text('sync_status') localSyncStatus!: string
}
