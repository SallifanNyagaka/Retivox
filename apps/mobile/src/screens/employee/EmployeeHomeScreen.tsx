/**
 * Employee home screen for Retivox mobile.
 *
 * Shows the same employee-scoped dashboard data as the web portal.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { ReceiptText, ShieldAlert, ShoppingCart } from 'lucide-react-native'
import { Badge } from '../../components/ui/Badge'
import { Card } from '../../components/ui/Card'
import { EmptyState } from '../../components/ui/EmptyState'
import { useTheme } from '../../hooks/useTheme'
import { fetchEmployeeDashboardData, type EmployeeDashboardData } from '../../lib/employee/employeeApi'
import { formatMoney, formatStatusLabel } from '../../lib/employee/pricing'
import { useAuthStore } from '../../store/authStore'
import { formatDateTime } from '../../utils/dateFormatter'
import { handleError } from '../../utils/errorHandler'
import { DashboardScaffold } from '../shared/DashboardScaffold'

/**
 * Returns a greeting based on local time.
 *
 * @returns Greeting text.
 */
function getGreeting(): string {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 16) return 'Good afternoon'
  return 'Good evening'
}

/**
 * Renders the employee home dashboard.
 *
 * @returns Employee home screen.
 */
export default function EmployeeHomeScreen() {
  const { theme } = useTheme()
  const user = useAuthStore((state) => state.user)
  const [data, setData] = useState<EmployeeDashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadDashboard = useCallback(async () => {
    if (!user?.branchId) {
      setError('Your branch assignment is missing.')
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)

    try {
      setData(await fetchEmployeeDashboardData(user.businessId, user.branchId, user.id))
    } catch (loadError) {
      const handled = handleError('EmployeeHome.loadDashboard', loadError)
      setError(handled.message)
    } finally {
      setLoading(false)
    }
  }, [user?.branchId, user?.businessId, user?.id])

  useEffect(() => {
    void loadDashboard()
  }, [loadDashboard])

  const todayTotal = useMemo(
    () => data?.todayTransactions.reduce((sum, transaction) => sum + transaction.totalAmount, 0) ?? 0,
    [data?.todayTransactions],
  )
  const damagedCount = data?.products.filter((product) => product.stockSource === 'recovery').length ?? 0
  const normalCount = data?.products.filter((product) => product.stockSource === 'normal').length ?? 0

  return (
    <DashboardScaffold
      title={`${getGreeting()}, ${user?.name?.split(' ')[0] ?? 'there'}`}
      subtitle={user?.branchName ?? 'Assigned branch'}
      loading={loading}
      error={error}
      onRefresh={loadDashboard}
      metrics={[
        { label: 'My sales today', value: String(data?.todayTransactions.length ?? 0), delta: 'Employee scoped' },
        { label: 'My processed total', value: formatMoney(todayTotal, data?.currency ?? 'KES'), delta: 'Today only' },
        { label: 'Damaged sale items', value: String(damagedCount), delta: damagedCount > 0 ? 'Available' : 'None approved' },
        { label: 'Normal sale items', value: String(normalCount), delta: 'Available now' },
      ]}
      actions={[
        { title: 'Record transaction', description: 'Sell normal or owner-approved damaged stock from the New Sale tab.' },
        { title: 'Report damaged stock', description: 'Use More > Report damaged stock when items break, spoil, or go missing.' },
      ]}
    >
      <Card style={styles.section}>
        <View style={styles.sectionHeader}>
          <ReceiptText color={theme.colors.primary} size={20} />
          <Text style={[styles.sectionTitle, { color: theme.colors.textPrimary }]}>Recent transactions</Text>
        </View>
        {!data || data.recentTransactions.length === 0 ? (
          <EmptyState heading="No transactions yet" subtitle="Sales you record will appear here immediately after submit." />
        ) : (
          <View style={styles.list}>
            {data.recentTransactions.slice(0, 5).map((transaction) => (
              <View key={transaction.id} style={[styles.row, { borderColor: theme.colors.border }]}>
                <View style={styles.rowIcon}>
                  <ShoppingCart color={theme.colors.primary} size={18} />
                </View>
                <View style={styles.rowBody}>
                  <Text style={[styles.rowTitle, { color: theme.colors.textPrimary }]}>
                    {formatMoney(transaction.totalAmount, data.currency)}
                  </Text>
                  <Text style={[styles.rowSubtitle, { color: theme.colors.textMuted }]}>{formatDateTime(transaction.recordedAt)}</Text>
                </View>
                <Badge label={formatStatusLabel(transaction.status)} variant={transaction.status === 'verified' ? 'success' : 'warning'} />
              </View>
            ))}
          </View>
        )}
      </Card>

      {damagedCount > 0 ? (
        <Card style={styles.section}>
          <View style={styles.sectionHeader}>
            <ShieldAlert color={theme.colors.accent} size={20} />
            <Text style={[styles.sectionTitle, { color: theme.colors.textPrimary }]}>Damaged stock is available</Text>
          </View>
          <Text style={[styles.sectionText, { color: theme.colors.textMuted }]}>
            Open New Sale, switch to Damaged stock, and sell only up to the approved remaining quantity.
          </Text>
        </Card>
      ) : null}
    </DashboardScaffold>
  )
}

const styles = StyleSheet.create({
  list: {
    gap: 10,
  },
  row: {
    alignItems: 'center',
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 10,
    paddingBottom: 10,
  },
  rowBody: {
    flex: 1,
  },
  rowIcon: {
    width: 24,
  },
  rowSubtitle: {
    fontSize: 12,
    marginTop: 2,
  },
  rowTitle: {
    fontSize: 15,
    fontWeight: '800',
  },
  section: {
    gap: 12,
    marginTop: 16,
  },
  sectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  sectionText: {
    fontSize: 13,
    lineHeight: 20,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '800',
  },
})
