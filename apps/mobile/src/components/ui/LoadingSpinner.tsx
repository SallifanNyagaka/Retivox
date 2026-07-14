/**
 * Reusable Retivox loading spinner.
 *
 * Displays a themed ActivityIndicator with optional loading text.
 */

import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { useTheme } from '../../hooks/useTheme'

export type LoadingSpinnerProps = {
  label?: string
  size?: 'small' | 'large'
}

/**
 * Renders a loading spinner.
 *
 * @param props - Loading spinner props.
 * @returns Loading indicator element.
 */
export function LoadingSpinner({ label = 'Loading...', size = 'large' }: LoadingSpinnerProps) {
  const { theme } = useTheme()

  return (
    <View style={styles.container}>
      <ActivityIndicator color={theme.colors.primary} size={size} />
      {label ? <Text style={[styles.label, { color: theme.colors.textMuted }]}>{label}</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: 10,
    justifyContent: 'center',
    padding: 24,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
  },
})
