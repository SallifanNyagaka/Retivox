/**
 * WatermelonDB sync queue model for ordered offline writes.
 */

import { Model } from '@nozbe/watermelondb'
import { date, field, text } from '@nozbe/watermelondb/decorators'

export class SyncQueueModel extends Model {
  static table = 'sync_queue'

  @text('entity_type') entityType!: string
  @text('local_id') localId!: string
  @text('payload') payload!: string
  @text('status') status!: string
  @field('retry_count') retryCount!: number
  @text('error_message') errorMessage?: string
  @date('created_locally_at') createdLocallyAt!: Date
  @date('synced_at') syncedAt?: Date
}
