/**
 * Safe-area aware screen header for Retivox mobile screens.
 *
 * Provides title, optional subtitle, optional left action, and optional right
 * action while matching the app-wide surface and border styling.
 */

import { type ReactNode } from 'react'
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useTheme } from '../../hooks/useTheme'

export type HeaderAction = {
  label: string
  icon?: ReactNode
  onPress: () => void
}

export type ScreenHeaderProps = {
  title: string
  subtitle?: string
  leftAction?: HeaderAction
  rightAction?: HeaderAction
}

/**
 * Renders a themed header action.
 *
 * @param action - Header action configuration.
 * @param color - Text/icon color.
 * @param rippleColor - Android ripple color.
 * @returns Pressable action element.
 */
function renderAction(action: HeaderAction | undefined, color: string, rippleColor: string) {
  if (!action) {
    return <View style={styles.actionPlaceholder} />
  }

  return (
    <Pressable
      accessibilityLabel={action.label}
      accessibilityRole="button"
      android_ripple={Platform.OS === 'android' ? { color: rippleColor, borderless: true } : undefined}
      onPress={action.onPress}
      style={({ pressed }) => [styles.action, pressed ? styles.pressed : null]}
    >
      {action.icon}
      <Text style={[styles.actionLabel, { color }]}>{action.label}</Text>
    </Pressable>
  )
}

/**
 * Renders a safe-area-aware screen header.
 *
 * @param props - Screen header props.
 * @returns Header element.
 */
export function ScreenHeader({ title, subtitle, leftAction, rightAction }: ScreenHeaderProps) {
  const { theme } = useTheme()

  return (
    <SafeAreaView edges={['top']} style={[styles.safeArea, { backgroundColor: theme.colors.surface }]}>
      <View style={[styles.container, { borderBottomColor: theme.colors.border }]}>
        {renderAction(leftAction, theme.colors.primary, theme.colors.primaryLight)}
        <View style={styles.titleBlock}>
          <Text style={[styles.title, { color: theme.colors.textPrimary, fontSize: theme.typography.sizes.xl }]} numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? (
            <Text style={[styles.subtitle, { color: theme.colors.textMuted }]} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {renderAction(rightAction, theme.colors.primary, theme.colors.primaryLight)}
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  action: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
    minWidth: 64,
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  actionLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  actionPlaceholder: {
    minWidth: 64,
  },
  container: {
    alignItems: 'center',
    borderBottomWidth: 1,
    flexDirection: 'row',
    minHeight: 56,
    paddingHorizontal: 12,
  },
  pressed: {
    opacity: 0.72,
  },
  safeArea: {
    width: '100%',
  },
  subtitle: {
    fontSize: 12,
    marginTop: 2,
    textAlign: 'center',
  },
  title: {
    fontWeight: '700',
    textAlign: 'center',
  },
  titleBlock: {
    flex: 1,
    paddingHorizontal: 8,
  },
})
