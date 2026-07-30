/**
 * Employee transactions screen for Retivox mobile.
 *
 * Displays employee-scoped transactions from Supabase, matching the web portal.
 */

import { useCallback, useEffect, useState } from 'react'
import { FlatList, StyleSheet, Text, View } from 'react-native'
import { ReceiptText, RefreshCcw } from 'lucide-react-native'
import { Badge, type BadgeVariant } from '../../components/ui/Badge'
import { Card } from '../../components/ui/Card'
import { EmptyState } from '../../components/ui/EmptyState'
import { useOnlineAutoRefresh } from '../../hooks/useOnlineAutoRefresh'
import { useTheme } from '../../hooks/useTheme'
import { resolveEmployeeBranchAssignment } from '../../lib/employee/branchAssignment'
import { fetchEmployeeDashboardData, fetchEmployeeTransactions, type EmployeeTransaction } from '../../lib/employee/employeeApi'
import { formatMoney, formatStatusLabel } from '../../lib/employee/pricing'
import { useAuthStore } from '../../store/authStore'
import { formatDateTime } from '../../utils/dateFormatter'
import { handleError } from '../../utils/errorHandler'
import { DashboardScaffold } from '../shared/DashboardScaffold'

type LoadOptions = {
  silent?: boolean
}

/**
 * Returns badge variant for a transaction status.
 *
 * @param status - Transaction status.
 * @returns Badge variant.
 */
function getStatusVariant(status: string): BadgeVariant {
  if (status === 'verified' || status === 'synced') return 'success'
  if (status === 'rejected' || status === 'flagged') return 'danger'
  if (status === 'pending_verify' || status === 'pending_sync') return 'warning'
  return 'muted'
}

/**
 * Renders employee transaction history.
 *
 * @returns Employee transactions screen.
 */
export default function EmployeeTransactionsScreen() {
  const { theme } = useTheme()
  const user = useAuthStore((state) => state.user)
  const setUser = useAuthStore((state) => state.setUser)
  const [transactions, setTransactions] = useState<EmployeeTransaction[]>([])
  const [currency, setCurrency] = useState('KES')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadTransactions = useCallback(async (options: LoadOptions = {}) => {
    if (!options.silent) {
      setLoading(true)
    }
    setError(null)

    try {
      const assignedUser = await resolveEmployeeBranchAssignment(user, setUser)
      const [dashboardData, transactionRows] = await Promise.all([
        fetchEmployeeDashboardData(assignedUser.businessId, assignedUser.branchId, assignedUser.id),
        fetchEmployeeTransactions(assignedUser.businessId, assignedUser.branchId, assignedUser.id),
      ])
      setCurrency(dashboardData.currency)
      setTransactions(transactionRows)
    } catch (loadError) {
      const handled = handleError('EmployeeTransactions.loadTransactions', loadError)
      setError(handled.message)
    } finally {
      if (!options.silent) {
        setLoading(false)
      }
    }
  }, [setUser, user])

  useEffect(() => {
    void loadTransactions()
  }, [loadTransactions])
  useOnlineAutoRefresh(() => loadTransactions({ silent: true }), { label: 'EmployeeTransactions.autoRefresh' })

  return (
    <DashboardScaffold
      title="Transactions"
      subtitle="My employee sales"
      loading={loading}
      error={error}
      onRefresh={loadTransactions}
      actions={[{ title: 'Refresh transactions', description: 'Pull to refresh or tap the refresh icon in this list.' }]}
    >
      {transactions.length === 0 ? (
        <EmptyState heading="No transactions yet" subtitle="New sales recorded from mobile or web will appear here." />
      ) : (
        <FlatList
          data={transactions}
          keyExtractor={(item) => item.id}
          scrollEnabled={false}
          renderItem={({ item }) => (
            <Card style={styles.row}>
              <View style={styles.rowHeader}>
                <View style={styles.titleGroup}>
                  <ReceiptText color={theme.colors.primary} size={18} />
                  <Text style={[styles.title, { color: theme.colors.textPrimary }]}>{formatMoney(item.totalAmount, currency)}</Text>
                </View>
                <Badge label={formatStatusLabel(item.status)} variant={getStatusVariant(item.status)} />
              </View>
              <Text style={[styles.subtitle, { color: theme.colors.textMuted }]}>{formatDateTime(item.recordedAt)}</Text>
            </Card>
          )}
          ListFooterComponent={
            <View style={styles.footer}>
              <RefreshCcw color={theme.colors.textMuted} size={14} />
              <Text style={[styles.footerText, { color: theme.colors.textMuted }]}>Pull down to refresh</Text>
            </View>
          }
        />
      )}
    </DashboardScaffold>
  )
}

const styles = StyleSheet.create({
  footer: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
    paddingVertical: 14,
  },
  footerText: {
    fontSize: 12,
    fontWeight: '600',
  },
  row: {
    marginBottom: 10,
  },
  rowHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  subtitle: {
    fontSize: 12,
    marginTop: 6,
  },
  title: {
    fontSize: 16,
    fontWeight: '800',
  },
  titleGroup: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
})
