/**
 * Reusable Retivox mobile button component.
 *
 * Supports visual variants, sizes, loading states, disabled states, icon slots,
 * Android ripple feedback, and a subtle press scale animation.
 */

import { useRef, type ReactNode } from 'react'
import {
  ActivityIndicator,
  Animated,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  type GestureResponderEvent,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native'
import { useTheme } from '../../hooks/useTheme'
import type { ThemeTokens } from '../../theme/tokens'

export type ButtonVariant = 'primary' | 'outline' | 'danger' | 'success'
export type ButtonSize = 'sm' | 'md' | 'lg'

export type ButtonProps = {
  label: string
  onPress?: (event: GestureResponderEvent) => void
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  disabled?: boolean
  fullWidth?: boolean
  leftIcon?: ReactNode
  rightIcon?: ReactNode
  accessibilityLabel?: string
}

/**
 * Returns dynamic container styles for button variants and sizes.
 *
 * @param theme - Active theme tokens.
 * @param variant - Button visual variant.
 * @param size - Button size.
 * @param fullWidth - Whether the button should stretch horizontally.
 * @param disabled - Whether the button is disabled.
 * @returns Style object for the button container.
 */
function getContainerStyle(
  theme: ThemeTokens,
  variant: ButtonVariant,
  size: ButtonSize,
  fullWidth: boolean,
  disabled: boolean,
): StyleProp<ViewStyle> {
  const sizeStyle = size === 'sm' ? styles.sizeSm : size === 'lg' ? styles.sizeLg : styles.sizeMd
  const variantStyle = {
    primary: {
      backgroundColor: theme.colors.primary,
      borderColor: theme.colors.primary,
    },
    outline: {
      backgroundColor: 'transparent',
      borderColor: theme.colors.border,
    },
    danger: {
      backgroundColor: theme.colors.danger,
      borderColor: theme.colors.danger,
    },
    success: {
      backgroundColor: theme.colors.successLight,
      borderColor: theme.colors.success,
    },
  }[variant]

  return [
    styles.container,
    sizeStyle,
    variantStyle,
    { borderRadius: theme.radii.button, opacity: disabled ? 0.5 : 1 },
    fullWidth ? styles.fullWidth : null,
  ]
}

/**
 * Returns dynamic text styles for button variants and sizes.
 *
 * @param theme - Active theme tokens.
 * @param variant - Button visual variant.
 * @param size - Button size.
 * @returns Style object for the button text.
 */
function getTextStyle(theme: ThemeTokens, variant: ButtonVariant, size: ButtonSize): StyleProp<TextStyle> {
  const color = {
    primary: theme.colors.primaryForeground,
    outline: theme.colors.textPrimary,
    danger: theme.colors.primaryForeground,
    success: theme.colors.success,
  }[variant]
  const fontSize = size === 'sm' ? theme.typography.sizes.sm : size === 'lg' ? theme.typography.sizes.xl : theme.typography.sizes.lg

  return [styles.label, { color, fontSize }]
}

/**
 * Renders a themed, animated button.
 *
 * @param props - Button props.
 * @returns Pressable button element.
 */
export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  fullWidth = false,
  leftIcon,
  rightIcon,
  accessibilityLabel,
}: ButtonProps) {
  const { theme } = useTheme()
  const scale = useRef(new Animated.Value(1)).current
  const isDisabled = disabled || loading
  const containerStyle = getContainerStyle(theme, variant, size, fullWidth, isDisabled)
  const textStyle = getTextStyle(theme, variant, size)
  const spinnerColor = variant === 'outline' || variant === 'success' ? theme.colors.primary : theme.colors.primaryForeground

  /**
   * Animates the button down on press.
   *
   * @returns Void.
   */
  const handlePressIn = () => {
    Animated.timing(scale, {
      toValue: 0.97,
      duration: 100,
      useNativeDriver: true,
    }).start()
  }

  /**
   * Animates the button back to its default scale.
   *
   * @returns Void.
   */
  const handlePressOut = () => {
    Animated.timing(scale, {
      toValue: 1,
      duration: 100,
      useNativeDriver: true,
    }).start()
  }

  return (
    <Animated.View style={[{ transform: [{ scale }] }, fullWidth ? styles.fullWidth : null]}>
      <Pressable
        accessibilityLabel={accessibilityLabel ?? label}
        accessibilityRole="button"
        android_ripple={Platform.OS === 'android' ? { color: theme.colors.primaryLight } : undefined}
        disabled={isDisabled}
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        style={containerStyle}
      >
        {loading ? <ActivityIndicator color={spinnerColor} size="small" /> : leftIcon}
        <Text style={textStyle}>{label}</Text>
        {!loading ? rightIcon : null}
      </Pressable>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
  },
  fullWidth: {
    width: '100%',
  },
  label: {
    fontWeight: '600',
  },
  sizeLg: {
    minHeight: 52,
    paddingHorizontal: 24,
    paddingVertical: 16,
  },
  sizeMd: {
    minHeight: 44,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  sizeSm: {
    minHeight: 36,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
})
