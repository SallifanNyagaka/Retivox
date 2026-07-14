/**
 * WatermelonDB payment model for offline transaction payment records.
 */

import { Model } from '@nozbe/watermelondb'
import { field, text } from '@nozbe/watermelondb/decorators'

export class PaymentModel extends Model {
  static table = 'payments'

  @text('server_id') serverId?: string
  @text('transaction_id') transactionId!: string
  @text('payment_method') paymentMethod!: string
  @field('amount') amount!: number
  @text('status') status!: string
  @text('mpesa_ref_code') mpesaRefCode?: string
  @text('cash_deposit_code') cashDepositCode?: string
  @text('account_reference') accountReference?: string
  @text('sync_status') localSyncStatus!: string
}
