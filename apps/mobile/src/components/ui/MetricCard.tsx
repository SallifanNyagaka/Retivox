/**
 * Reusable KPI card for Retivox mobile dashboards.
 *
 * Displays a metric value, label, optional delta, and optional icon inside the
 * shared card surface.
 */

import { type ReactNode } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useTheme } from '../../hooks/useTheme'
import { Card } from './Card'

export type MetricDeltaTone = 'success' | 'danger' | 'muted'

export type MetricCardProps = {
  value: string
  label: string
  delta?: string
  deltaTone?: MetricDeltaTone
  icon?: ReactNode
}

/**
 * Returns the color for a metric delta.
 *
 * @param colors - Active theme colors.
 * @param tone - Delta tone.
 * @returns Color string.
 */
function getDeltaColor(colors: ReturnType<typeof useTheme>['theme']['colors'], tone: MetricDeltaTone): string {
  if (tone === 'success') return colors.success
  if (tone === 'danger') return colors.danger
  return colors.textMuted
}

/**
 * Renders a themed metric card.
 *
 * @param props - Metric card props.
 * @returns Metric card element.
 */
export function MetricCard({ value, label, delta, deltaTone = 'muted', icon }: MetricCardProps) {
  const { theme } = useTheme()

  return (
    <Card padding="md">
      <View style={styles.headerRow}>
        <View style={styles.metricText}>
          <Text style={[styles.value, { color: theme.colors.textPrimary, fontSize: theme.typography.sizes['2xl'] }]}>{value}</Text>
          <Text style={[styles.label, { color: theme.colors.textMuted, fontSize: theme.typography.sizes.sm }]}>{label}</Text>
        </View>
        {icon ? <View style={[styles.iconShell, { backgroundColor: theme.colors.primaryLight }]}>{icon}</View> : null}
      </View>
      {delta ? <Text style={[styles.delta, { color: getDeltaColor(theme.colors, deltaTone) }]}>{delta}</Text> : null}
    </Card>
  )
}

const styles = StyleSheet.create({
  delta: {
    fontSize: 12,
    fontWeight: '500',
    marginTop: 10,
  },
  headerRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  iconShell: {
    alignItems: 'center',
    borderRadius: 999,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  label: {
    fontWeight: '500',
    marginTop: 4,
  },
  metricText: {
    flex: 1,
  },
  value: {
    fontWeight: '700',
  },
})
