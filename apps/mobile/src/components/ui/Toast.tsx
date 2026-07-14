/**
 * Reusable Retivox toast notification.
 *
 * Slides in from the top, respects safe area insets, auto-dismisses, and can be
 * dismissed manually by tapping.
 */

import { useEffect, useRef } from 'react'
import { Animated, Pressable, StyleSheet, Text } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '../../hooks/useTheme'
import type { ThemeTokens } from '../../theme/tokens'

export type ToastType = 'success' | 'error' | 'warning' | 'info'

export type ToastProps = {
  message: string
  type?: ToastType
  visible?: boolean
  duration?: number
  onDismiss: () => void
}

/**
 * Returns toast colors for the active type.
 *
 * @param theme - Active theme tokens.
 * @param type - Toast type.
 * @returns Toast color pair.
 */
function getToastColors(theme: ThemeTokens, type: ToastType) {
  if (type === 'success') return { backgroundColor: theme.colors.successLight, color: theme.colors.success }
  if (type === 'error') return { backgroundColor: theme.colors.dangerLight, color: theme.colors.danger }
  if (type === 'warning') return { backgroundColor: theme.colors.accentLight, color: theme.colors.accent }
  return { backgroundColor: theme.colors.infoLight, color: theme.colors.info }
}

/**
 * Renders an animated toast.
 *
 * @param props - Toast props.
 * @returns Toast element or null.
 */
export function Toast({ message, type = 'info', visible = true, duration = 3000, onDismiss }: ToastProps) {
  const { theme } = useTheme()
  const insets = useSafeAreaInsets()
  const translateY = useRef(new Animated.Value(-120)).current
  const colors = getToastColors(theme, type)

  useEffect(() => {
    if (!visible) return

    Animated.timing(translateY, {
      toValue: 0,
      duration: 180,
      useNativeDriver: true,
    }).start()

    const timer = setTimeout(() => {
      onDismiss()
    }, duration)

    return () => clearTimeout(timer)
  }, [duration, onDismiss, translateY, visible])

  if (!visible) {
    return null
  }

  return (
    <Animated.View style={[styles.container, { paddingTop: insets.top + 10, transform: [{ translateY }] }]}>
      <Pressable
        accessibilityRole="button"
        onPress={onDismiss}
        style={[styles.toast, theme.shadows.card, { backgroundColor: colors.backgroundColor, borderColor: colors.color }]}
      >
        <Text style={[styles.message, { color: colors.color }]}>{message}</Text>
      </Pressable>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  container: {
    left: 16,
    position: 'absolute',
    right: 16,
    top: 0,
    zIndex: 100,
  },
  message: {
    fontSize: 14,
    fontWeight: '600',
  },
  toast: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
})
