/**
 * Reactive branch stock hook backed by WatermelonDB.
 *
 * POS and stock screens use this hook to read local stock snapshots instantly,
 * including while offline.
 */

import { useEffect, useState } from 'react'
import { Q } from '@nozbe/watermelondb'
import { database } from '../lib/watermelon/database'
import { BranchStockModel } from '../lib/watermelon/models/BranchStock'

export type BranchStockSummary = {
  rows: BranchStockModel[]
  lowStockCount: number
  loading: boolean
}

/**
 * Observes branch stock rows.
 *
 * @param branchId - Branch id to scope local stock.
 * @returns Reactive stock summary.
 */
export function useBranchStock(branchId: string | null): BranchStockSummary {
  const [rows, setRows] = useState<BranchStockModel[]>([])
  const [lowStockCount, setLowStockCount] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!branchId) {
      setRows([])
      setLowStockCount(0)
      setLoading(false)
      return
    }

    const query = database.get<BranchStockModel>('branch_stock').query(Q.where('branch_id', branchId))
    const subscription = query.observe().subscribe((nextRows) => {
      setRows(nextRows)
      setLowStockCount(nextRows.filter((row) => row.quantityOnHand <= row.lowStockThreshold).length)
      setLoading(false)
    })

    return () => subscription.unsubscribe()
  }, [branchId])

  return { rows, lowStockCount, loading }
}
