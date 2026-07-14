/**
 * Reusable Retivox mobile card component.
 *
 * Provides themed surface, border, radius, shadow, and optional press handling
 * for tappable dashboard cards.
 */

import { type ReactNode } from 'react'
import { Platform, Pressable, StyleSheet, View, type GestureResponderEvent, type StyleProp, type ViewStyle } from 'react-native'
import { useTheme } from '../../hooks/useTheme'
import type { ThemeTokens } from '../../theme/tokens'

export type CardPadding = 'sm' | 'md' | 'lg'

export type CardProps = {
  children: ReactNode
  padding?: CardPadding
  onPress?: (event: GestureResponderEvent) => void
  style?: StyleProp<ViewStyle>
  accessibilityLabel?: string
}

/**
 * Builds dynamic card styles.
 *
 * @param theme - Active theme tokens.
 * @param padding - Card padding size.
 * @returns Style object for the card.
 */
function getCardStyle(theme: ThemeTokens, padding: CardPadding): StyleProp<ViewStyle> {
  const paddingValue = padding === 'sm' ? theme.spacing.md : padding === 'lg' ? theme.spacing.xl : theme.spacing.lg

  return [
    styles.card,
    theme.shadows.card,
    {
      backgroundColor: theme.colors.surface,
      borderColor: theme.colors.border,
      borderRadius: theme.radii.card,
      padding: paddingValue,
    },
  ]
}

/**
 * Renders a themed card container.
 *
 * @param props - Card props.
 * @returns Card element.
 */
export function Card({ children, padding = 'md', onPress, style, accessibilityLabel }: CardProps) {
  const { theme } = useTheme()
  const cardStyle = [getCardStyle(theme, padding), style]

  if (onPress) {
    return (
      <Pressable
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="button"
        android_ripple={Platform.OS === 'android' ? { color: theme.colors.primaryLight } : undefined}
        onPress={onPress}
        style={({ pressed }) => [cardStyle, pressed ? styles.pressed : null]}
      >
        {children}
      </Pressable>
    )
  }

  return <View style={cardStyle}>{children}</View>
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
  },
  pressed: {
    opacity: 0.88,
  },
})
