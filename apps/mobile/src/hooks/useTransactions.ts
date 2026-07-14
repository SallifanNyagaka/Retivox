/**
 * Reactive transaction hook backed by WatermelonDB.
 *
 * Transaction screens use this hook for local-first rendering and instant
 * updates when offline sales are recorded.
 */

import { useEffect, useState } from 'react'
import { Q } from '@nozbe/watermelondb'
import { database } from '../lib/watermelon/database'
import { TransactionModel } from '../lib/watermelon/models/Transaction'

export type TransactionSummary = {
  rows: TransactionModel[]
  count: number
  loading: boolean
}

/**
 * Observes transactions for a branch.
 *
 * @param branchId - Branch id to scope local transactions.
 * @returns Reactive transaction summary.
 */
export function useTransactions(branchId: string | null): TransactionSummary {
  const [rows, setRows] = useState<TransactionModel[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!branchId) {
      setRows([])
      setLoading(false)
      return
    }

    const query = database
      .get<TransactionModel>('transactions')
      .query(Q.where('branch_id', branchId), Q.sortBy('recorded_at', Q.desc))
    const subscription = query.observe().subscribe((nextRows) => {
      setRows(nextRows)
      setLoading(false)
    })

    return () => subscription.unsubscribe()
  }, [branchId])

  return { rows, count: rows.length, loading }
}
