/**
 * WatermelonDB database instance for Retivox mobile.
 *
 * Provides typed local persistence for POS data, stock snapshots, price
 * snapshots, and sync queue records.
 */

import { Database } from '@nozbe/watermelondb'
import SQLiteAdapter from '@nozbe/watermelondb/adapters/sqlite'
import { watermelonSchema } from './schema'
import { BranchProductPriceModel } from './models/BranchProductPrice'
import { BranchStockModel } from './models/BranchStock'
import { PaymentModel } from './models/Payment'
import { ProductModel } from './models/Product'
import { SyncQueueModel } from './models/SyncQueue'
import { TransactionModel } from './models/Transaction'
import { TransactionItemModel } from './models/TransactionItem'

const adapter = new SQLiteAdapter({
  schema: watermelonSchema,
  dbName: 'retivox_mobile',
  jsi: true,
  onSetUpError: (error) => {
    console.error('[Retivox mobile] WatermelonDB setup failed', error)
  },
})

export const database = new Database({
  adapter,
  modelClasses: [
    TransactionModel,
    TransactionItemModel,
    PaymentModel,
    BranchStockModel,
    ProductModel,
    BranchProductPriceModel,
    SyncQueueModel,
  ],
})
