/**
 * Reusable Retivox mobile badge component.
 *
 * Matches the web badge variants with compact pill styling for statuses, roles,
 * labels, and tags.
 */

import { StyleSheet, Text, type StyleProp, type TextStyle } from 'react-native'
import { useTheme } from '../../hooks/useTheme'
import type { ThemeTokens } from '../../theme/tokens'

export type BadgeVariant = 'success' | 'warning' | 'danger' | 'info' | 'muted'

export type BadgeProps = {
  label: string
  variant?: BadgeVariant
  style?: StyleProp<TextStyle>
}

/**
 * Builds dynamic badge styles.
 *
 * @param theme - Active theme tokens.
 * @param variant - Badge visual variant.
 * @returns Style object for the badge.
 */
function getBadgeStyle(theme: ThemeTokens, variant: BadgeVariant): StyleProp<TextStyle> {
  const variantStyle = {
    success: {
      backgroundColor: theme.colors.successLight,
      color: theme.colors.success,
    },
    warning: {
      backgroundColor: theme.colors.accentLight,
      color: theme.colors.accent,
    },
    danger: {
      backgroundColor: theme.colors.dangerLight,
      color: theme.colors.danger,
    },
    info: {
      backgroundColor: theme.colors.infoLight,
      color: theme.colors.info,
    },
    muted: {
      backgroundColor: theme.colors.border,
      color: theme.colors.textMuted,
    },
  }[variant]

  return [styles.badge, { borderRadius: theme.radii.badge, fontSize: theme.typography.sizes.sm }, variantStyle]
}

/**
 * Renders a status badge.
 *
 * @param props - Badge props.
 * @returns Badge text element.
 */
export function Badge({ label, variant = 'muted', style }: BadgeProps) {
  const { theme } = useTheme()

  return <Text style={[getBadgeStyle(theme, variant), style]}>{label}</Text>
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    fontWeight: '500',
    overflow: 'hidden',
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
})
