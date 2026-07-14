/**
 * Admin home screen for Retivox mobile.
 *
 * Shows live metrics for the admin's managed store scope.
 */

import { useCallback, useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { Building2, ShieldAlert } from 'lucide-react-native'
import { Card } from '../../components/ui/Card'
import { useTheme } from '../../hooks/useTheme'
import { fetchAdminDashboardSummary, formatDashboardMoney, type AdminDashboardSummary } from '../../lib/dashboard/roleDashboardApi'
import { useAuthStore } from '../../store/authStore'
import { handleError } from '../../utils/errorHandler'
import { DashboardScaffold } from '../shared/DashboardScaffold'

/**
 * Renders admin home.
 *
 * @returns Admin home screen.
 */
export default function AdminHomeScreen() {
  const { theme } = useTheme()
  const user = useAuthStore((state) => state.user)
  const [summary, setSummary] = useState<AdminDashboardSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadSummary = useCallback(async () => {
    if (!user?.businessId) {
      setError('Business profile is missing.')
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)

    try {
      setSummary(await fetchAdminDashboardSummary(user.businessId))
    } catch (loadError) {
      const handled = handleError('AdminHome.loadSummary', loadError)
      setError(handled.message)
    } finally {
      setLoading(false)
    }
  }, [user?.businessId])

  useEffect(() => {
    void loadSummary()
  }, [loadSummary])

  return (
    <DashboardScaffold
      title="Admin Home"
      subtitle="Managed branches"
      loading={loading}
      error={error}
      onRefresh={loadSummary}
      metrics={[
        { label: "Today's revenue", value: formatDashboardMoney(summary?.todayRevenue ?? 0, summary?.currency ?? 'KES'), delta: 'Managed scope' },
        { label: 'Transactions', value: String(summary?.todayTransactions ?? 0), delta: 'Today' },
        { label: 'Managed stores', value: String(summary?.managedBranches ?? 0), delta: 'Admin access' },
        { label: 'Damage reports', value: String(summary?.pendingDamageReports ?? 0), delta: 'Managed stores' },
      ]}
      actions={[
        { title: 'Stock', description: 'Review product availability across managed stores from the Stock tab.' },
        { title: 'Employees', description: 'Manage assigned employees from the More menu.' },
      ]}
    >
      <View style={styles.cards}>
        <Card style={styles.infoCard}>
          <Building2 color={theme.colors.primary} size={22} />
          <Text style={[styles.infoTitle, { color: theme.colors.textPrimary }]}>Managed stores</Text>
          <Text style={[styles.infoText, { color: theme.colors.textMuted }]}>Stores with admin access: {summary?.managedBranches ?? 0}</Text>
        </Card>
        <Card style={styles.infoCard}>
          <ShieldAlert color={theme.colors.accent} size={22} />
          <Text style={[styles.infoTitle, { color: theme.colors.textPrimary }]}>Damage reports</Text>
          <Text style={[styles.infoText, { color: theme.colors.textMuted }]}>Visible reports: {summary?.pendingDamageReports ?? 0}</Text>
        </Card>
      </View>
    </DashboardScaffold>
  )
}

const styles = StyleSheet.create({
  cards: {
    gap: 12,
    marginTop: 16,
  },
  infoCard: {
    gap: 6,
  },
  infoText: {
    fontSize: 13,
    lineHeight: 20,
  },
  infoTitle: {
    fontSize: 16,
    fontWeight: '900',
  },
})
