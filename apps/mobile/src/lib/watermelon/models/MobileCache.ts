/**
 * WatermelonDB model for durable, role-scoped UI snapshots.
 */

import { Model } from '@nozbe/watermelondb'
import { date, text } from '@nozbe/watermelondb/decorators'

export class MobileCacheModel extends Model {
  static table = 'mobile_cache'

  @text('cache_key') cacheKey!: string
  @text('payload') payload!: string
  @date('updated_at') updatedAt!: Date
}
