/**
 * WatermelonDB migrations for Retivox mobile.
 */

import { createTable, schemaMigrations } from '@nozbe/watermelondb/Schema/migrations'

export const watermelonMigrations = schemaMigrations({
  migrations: [
    {
      toVersion: 2,
      steps: [
        createTable({
          name: 'mobile_cache',
          columns: [
            { name: 'cache_key', type: 'string', isIndexed: true },
            { name: 'payload', type: 'string' },
            { name: 'updated_at', type: 'number' },
          ],
        }),
      ],
    },
  ],
})
