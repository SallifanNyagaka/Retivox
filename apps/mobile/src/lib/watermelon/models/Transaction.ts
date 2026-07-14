/**
 * WatermelonDB transaction model for offline Retivox sales.
 */

import { Model } from '@nozbe/watermelondb'
import { date, field, readonly, text } from '@nozbe/watermelondb/decorators'

export class TransactionModel extends Model {
  static table = 'transactions'

  @text('server_id') serverId?: string
  @text('branch_id') branchId!: string
  @text('employee_id') employeeId!: string
  @text('business_id') businessId!: string
  @text('status') status!: string
  @field('subtotal') subtotal!: number
  @field('discount_amount') discountAmount!: number
  @field('total_amount') totalAmount!: number
  @text('origin') origin!: string
  @text('sync_status') localSyncStatus!: string
  @text('local_id') localId!: string
  @date('recorded_at') recordedAt!: Date
  @date('synced_at') syncedAt?: Date
  @readonly @date('created_at') createdAt!: Date
}
