/**
 * Shared dashboard scaffold for Retivox mobile screens.
 *
 * Provides safe-area wrapping, header, online/offline banner, pull-to-refresh,
 * loading/error/success states, metric cards, action cards, and empty states.
 */

import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useTheme } from '../../hooks/useTheme'
import { useOnlineStatus } from '../../hooks/useOnlineStatus'
import { Card } from '../../components/ui/Card'
import { EmptyState } from '../../components/ui/EmptyState'
import { LoadingSpinner } from '../../components/ui/LoadingSpinner'
import { MetricCard } from '../../components/ui/MetricCard'
import { ScreenHeader } from '../../components/layout/ScreenHeader'

export type DashboardMetric = {
  value: string
  label: string
  delta?: string
}

export type DashboardAction = {
  title: string
  description: string
  onPress?: () => void
}

export type DashboardScaffoldProps = {
  title: string
  subtitle: string
  metrics?: DashboardMetric[]
  actions?: DashboardAction[]
  loading?: boolean
  error?: string | null
  emptyTitle?: string
  emptySubtitle?: string
  children?: ReactNode
  onRefresh?: () => Promise<void>
}

/**
 * Renders a dashboard screen with consistent state handling.
 *
 * @param props - Scaffold props.
 * @returns Dashboard screen element.
 */
export function DashboardScaffold({
  title,
  subtitle,
  metrics = [],
  actions = [],
  loading = false,
  error = null,
  emptyTitle = 'Nothing here yet',
  emptySubtitle = 'Pull to refresh or check back after activity is recorded.',
  children,
  onRefresh,
}: DashboardScaffoldProps) {
  const { theme } = useTheme()
  const onlineStatus = useOnlineStatus()
  const [refreshing, setRefreshing] = useState(false)
  const refreshControl = useMemo(
    () => (
      <RefreshControl
        refreshing={refreshing}
        tintColor={theme.colors.primary}
        onRefresh={async () => {
          if (!onRefresh) return
          setRefreshing(true)
          try {
            await onRefresh()
          } finally {
            setRefreshing(false)
          }
        }}
      />
    ),
    [onRefresh, refreshing, theme.colors.primary],
  )

  const retry = useCallback(async () => {
    if (onRefresh) {
      await onRefresh()
    }
  }, [onRefresh])

  return (
    <SafeAreaView edges={['bottom']} style={[styles.safeArea, { backgroundColor: theme.colors.background }]}>
      <ScreenHeader title={title} subtitle={subtitle} />
      {!onlineStatus.isOnline ? (
        <View style={[styles.offlineBanner, { backgroundColor: theme.colors.accentLight }]}>
          <Text style={[styles.offlineText, { color: theme.colors.accent }]}>Offline mode. New activity will sync when online.</Text>
        </View>
      ) : null}
      <ScrollView contentContainerStyle={styles.content} refreshControl={refreshControl}>
        {loading ? (
          <LoadingSpinner label="Loading dashboard..." />
        ) : error ? (
          <EmptyState heading="Unable to load" subtitle={error} actionLabel="Retry" onActionPress={retry} />
        ) : metrics.length === 0 && actions.length === 0 && !children ? (
          <EmptyState heading={emptyTitle} subtitle={emptySubtitle} />
        ) : (
          <>
            {metrics.length > 0 ? (
              <View style={styles.metricsGrid}>
                {metrics.map((metric) => (
                  <View key={`${metric.label}-${metric.value}`} style={styles.metricCell}>
                    <MetricCard value={metric.value} label={metric.label} delta={metric.delta} />
                  </View>
                ))}
              </View>
            ) : null}

            {children}

            {actions.length > 0 ? (
              <View style={styles.actions}>
                {actions.map((action) => (
                  <Card key={action.title} onPress={action.onPress}>
                    <Text style={[styles.actionTitle, { color: theme.colors.textPrimary }]}>{action.title}</Text>
                    <Text style={[styles.actionDescription, { color: theme.colors.textMuted }]}>{action.description}</Text>
                  </Card>
                ))}
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  actionDescription: {
    fontSize: 13,
    lineHeight: 19,
    marginTop: 6,
  },
  actionTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  actions: {
    gap: 12,
    marginTop: 18,
  },
  content: {
    padding: 16,
    paddingBottom: 120,
  },
  metricCell: {
    flexBasis: '48%',
    flexGrow: 1,
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 16,
  },
  offlineBanner: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  offlineText: {
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
  safeArea: {
    flex: 1,
  },
})
