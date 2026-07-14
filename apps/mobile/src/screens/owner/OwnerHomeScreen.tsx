/**
 * Owner home screen for Retivox mobile.
 *
 * Presents live business-wide metrics from Supabase.
 */

import { useCallback, useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { Building2, Package, ShieldAlert } from 'lucide-react-native'
import { Card } from '../../components/ui/Card'
import { useTheme } from '../../hooks/useTheme'
import { fetchOwnerDashboardSummary, formatDashboardMoney, type OwnerDashboardSummary } from '../../lib/dashboard/roleDashboardApi'
import { useAuthStore } from '../../store/authStore'
import { handleError } from '../../utils/errorHandler'
import { DashboardScaffold } from '../shared/DashboardScaffold'

/**
 * Renders owner home.
 *
 * @returns Owner home screen.
 */
export default function OwnerHomeScreen() {
  const { theme } = useTheme()
  const user = useAuthStore((state) => state.user)
  const [summary, setSummary] = useState<OwnerDashboardSummary | null>(null)
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
      setSummary(await fetchOwnerDashboardSummary(user.businessId))
    } catch (loadError) {
      const handled = handleError('OwnerHome.loadSummary', loadError)
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
      title="Owner Home"
      subtitle="All branches overview"
      loading={loading}
      error={error}
      onRefresh={loadSummary}
      metrics={[
        { label: "Today's revenue", value: formatDashboardMoney(summary?.todayRevenue ?? 0, summary?.currency ?? 'KES'), delta: 'Business-wide' },
        { label: 'Transactions', value: String(summary?.todayTransactions ?? 0), delta: 'Today' },
        { label: 'Branches', value: String(summary?.activeBranches ?? 0), delta: 'Active stores' },
        { label: 'Pending approvals', value: String(summary?.pendingDamageReports ?? 0), delta: 'Damage reports' },
      ]}
      actions={[
        { title: 'Analytics', description: 'Review trends and branch performance from the Analytics tab.' },
        { title: 'People', description: 'Manage admins and employees from the More menu.' },
      ]}
    >
      <View style={styles.cards}>
        <Card style={styles.infoCard}>
          <Building2 color={theme.colors.primary} size={22} />
          <Text style={[styles.infoTitle, { color: theme.colors.textPrimary }]}>Branches</Text>
          <Text style={[styles.infoText, { color: theme.colors.textMuted }]}>Active stores: {summary?.activeBranches ?? 0}</Text>
        </Card>
        <Card style={styles.infoCard}>
          <Package color={theme.colors.primary} size={22} />
          <Text style={[styles.infoTitle, { color: theme.colors.textPrimary }]}>Products</Text>
          <Text style={[styles.infoText, { color: theme.colors.textMuted }]}>Active products: {summary?.activeProducts ?? 0}</Text>
        </Card>
        <Card style={styles.infoCard}>
          <ShieldAlert color={theme.colors.accent} size={22} />
          <Text style={[styles.infoTitle, { color: theme.colors.textPrimary }]}>Approvals</Text>
          <Text style={[styles.infoText, { color: theme.colors.textMuted }]}>Pending damage reports: {summary?.pendingDamageReports ?? 0}</Text>
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
