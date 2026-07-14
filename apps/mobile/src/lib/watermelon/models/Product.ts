/**
 * WatermelonDB product model for POS product search and display.
 */

import { Model } from '@nozbe/watermelondb'
import { date, field, text } from '@nozbe/watermelondb/decorators'

export class ProductModel extends Model {
  static table = 'products'

  @text('server_id') serverId?: string
  @text('name') name!: string
  @text('sku') sku!: string
  @text('category') category!: string
  @text('unit') unit!: string
  @field('is_active') isActive!: boolean
  @date('last_synced_at') lastSyncedAt?: Date
}
