/**
 * WatermelonDB schema for Retivox mobile offline data.
 *
 * Mirrors the Supabase tables needed for offline sales, local stock snapshots,
 * local prices, and sync queue processing.
 */

import { appSchema, tableSchema } from '@nozbe/watermelondb'

export const watermelonSchema = appSchema({
  version: 1,
  tables: [
    tableSchema({
      name: 'transactions',
      columns: [
        { name: 'server_id', type: 'string', isOptional: true },
        { name: 'branch_id', type: 'string' },
        { name: 'employee_id', type: 'string' },
        { name: 'business_id', type: 'string' },
        { name: 'status', type: 'string' },
        { name: 'subtotal', type: 'number' },
        { name: 'discount_amount', type: 'number' },
        { name: 'total_amount', type: 'number' },
        { name: 'origin', type: 'string' },
        { name: 'sync_status', type: 'string' },
        { name: 'local_id', type: 'string', isIndexed: true },
        { name: 'recorded_at', type: 'number' },
        { name: 'synced_at', type: 'number', isOptional: true },
        { name: 'created_at', type: 'number' },
      ],
    }),
    tableSchema({
      name: 'transaction_items',
      columns: [
        { name: 'server_id', type: 'string', isOptional: true },
        { name: 'transaction_id', type: 'string', isIndexed: true },
        { name: 'product_id', type: 'string', isIndexed: true },
        { name: 'quantity', type: 'number' },
        { name: 'unit_price_at_sale', type: 'number' },
        { name: 'line_total', type: 'number' },
        { name: 'stock_status', type: 'string' },
        { name: 'sync_status', type: 'string' },
      ],
    }),
    tableSchema({
      name: 'payments',
      columns: [
        { name: 'server_id', type: 'string', isOptional: true },
        { name: 'transaction_id', type: 'string', isIndexed: true },
        { name: 'payment_method', type: 'string' },
        { name: 'amount', type: 'number' },
        { name: 'status', type: 'string' },
        { name: 'mpesa_ref_code', type: 'string', isOptional: true },
        { name: 'cash_deposit_code', type: 'string', isOptional: true },
        { name: 'account_reference', type: 'string', isOptional: true },
        { name: 'sync_status', type: 'string' },
      ],
    }),
    tableSchema({
      name: 'branch_stock',
      columns: [
        { name: 'server_id', type: 'string', isOptional: true },
        { name: 'branch_id', type: 'string', isIndexed: true },
        { name: 'product_id', type: 'string', isIndexed: true },
        { name: 'quantity_on_hand', type: 'number' },
        { name: 'quantity_reserved', type: 'number' },
        { name: 'low_stock_threshold', type: 'number' },
        { name: 'last_synced_at', type: 'number', isOptional: true },
      ],
    }),
    tableSchema({
      name: 'products',
      columns: [
        { name: 'server_id', type: 'string', isOptional: true },
        { name: 'name', type: 'string', isIndexed: true },
        { name: 'sku', type: 'string' },
        { name: 'category', type: 'string' },
        { name: 'unit', type: 'string' },
        { name: 'is_active', type: 'boolean' },
        { name: 'last_synced_at', type: 'number', isOptional: true },
      ],
    }),
    tableSchema({
      name: 'branch_product_prices',
      columns: [
        { name: 'server_id', type: 'string', isOptional: true },
        { name: 'product_id', type: 'string', isIndexed: true },
        { name: 'branch_id', type: 'string', isIndexed: true },
        { name: 'selling_price', type: 'number' },
        { name: 'status', type: 'string' },
        { name: 'last_synced_at', type: 'number', isOptional: true },
      ],
    }),
    tableSchema({
      name: 'sync_queue',
      columns: [
        { name: 'entity_type', type: 'string' },
        { name: 'local_id', type: 'string', isIndexed: true },
        { name: 'payload', type: 'string' },
        { name: 'status', type: 'string' },
        { name: 'retry_count', type: 'number' },
        { name: 'error_message', type: 'string', isOptional: true },
        { name: 'created_locally_at', type: 'number' },
        { name: 'synced_at', type: 'number', isOptional: true },
      ],
    }),
  ],
})
