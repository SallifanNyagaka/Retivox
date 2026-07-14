/**
 * Reusable empty state for Retivox mobile lists and dashboards.
 *
 * Shows an optional icon, heading, subtitle, and call-to-action button.
 */

import { type ReactNode } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useTheme } from '../../hooks/useTheme'
import { Button } from './Button'

export type EmptyStateProps = {
  icon?: ReactNode
  heading: string
  subtitle?: string
  actionLabel?: string
  onActionPress?: () => void
}

/**
 * Renders an empty state block.
 *
 * @param props - Empty state props.
 * @returns Empty state element.
 */
export function EmptyState({ icon, heading, subtitle, actionLabel, onActionPress }: EmptyStateProps) {
  const { theme } = useTheme()

  return (
    <View style={styles.container}>
      {icon ? <View style={[styles.iconShell, { backgroundColor: theme.colors.primaryLight }]}>{icon}</View> : null}
      <Text style={[styles.heading, { color: theme.colors.textPrimary, fontSize: theme.typography.sizes.xl }]}>{heading}</Text>
      {subtitle ? <Text style={[styles.subtitle, { color: theme.colors.textMuted }]}>{subtitle}</Text> : null}
      {actionLabel && onActionPress ? (
        <View style={styles.action}>
          <Button label={actionLabel} onPress={onActionPress} />
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  action: {
    marginTop: 6,
  },
  container: {
    alignItems: 'center',
    gap: 10,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 40,
  },
  heading: {
    fontWeight: '700',
    textAlign: 'center',
  },
  iconShell: {
    alignItems: 'center',
    borderRadius: 999,
    height: 56,
    justifyContent: 'center',
    marginBottom: 4,
    width: 56,
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
})
