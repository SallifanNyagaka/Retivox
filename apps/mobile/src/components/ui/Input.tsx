/**
 * Reusable Retivox mobile text input component.
 *
 * Provides label, helper/error text, focus styling, icon slots, and web-matched
 * behavior where the left icon disappears once the user has entered text.
 */

import { useState, type ReactNode } from 'react'
import {
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native'
import { useTheme } from '../../hooks/useTheme'
import type { ThemeTokens } from '../../theme/tokens'

export type InputProps = TextInputProps & {
  label: string
  error?: string | null
  helperText?: string
  leftIcon?: ReactNode
  rightIcon?: ReactNode
  containerStyle?: StyleProp<ViewStyle>
}

/**
 * Builds the dynamic input wrapper style.
 *
 * @param theme - Active theme tokens.
 * @param focused - Whether the input is focused.
 * @param hasError - Whether the input has an error.
 * @returns Style object for the input wrapper.
 */
function getInputWrapperStyle(theme: ThemeTokens, focused: boolean, hasError: boolean): StyleProp<ViewStyle> {
  const borderColor = hasError ? theme.colors.danger : focused ? theme.colors.primary : theme.colors.border

  return [
    styles.inputWrapper,
    {
      backgroundColor: theme.colors.background,
      borderColor,
      borderRadius: theme.radii.input,
    },
  ]
}

/**
 * Builds the dynamic text input style.
 *
 * @param theme - Active theme tokens.
 * @returns Style object for TextInput.
 */
function getTextInputStyle(theme: ThemeTokens): StyleProp<TextStyle> {
  return [
    styles.input,
    {
      color: theme.colors.textPrimary,
      fontSize: theme.typography.sizes.md,
    },
  ]
}

/**
 * Renders a themed text input.
 *
 * @param props - Input props.
 * @returns Labelled text input element.
 */
export function Input({
  label,
  error,
  helperText,
  leftIcon,
  rightIcon,
  containerStyle,
  value,
  onFocus,
  onBlur,
  placeholderTextColor,
  ...inputProps
}: InputProps) {
  const { theme } = useTheme()
  const [focused, setFocused] = useState(false)
  const hasValue = typeof value === 'string' && value.length > 0
  const hasError = Boolean(error)

  return (
    <View style={[styles.container, containerStyle]}>
      <Text style={[styles.label, { color: theme.colors.textPrimary, fontSize: theme.typography.sizes.md }]}>{label}</Text>
      <View style={getInputWrapperStyle(theme, focused, hasError)}>
        {!hasValue && leftIcon ? <View style={styles.iconSlot}>{leftIcon}</View> : null}
        <TextInput
          {...inputProps}
          onBlur={(event) => {
            setFocused(false)
            onBlur?.(event)
          }}
          onFocus={(event) => {
            setFocused(true)
            onFocus?.(event)
          }}
          placeholderTextColor={placeholderTextColor ?? theme.colors.textMuted}
          style={getTextInputStyle(theme)}
          value={value}
        />
        {rightIcon ? <View style={styles.iconSlot}>{rightIcon}</View> : null}
      </View>
      {error ? (
        <Text style={[styles.supportingText, { color: theme.colors.danger }]}>{error}</Text>
      ) : helperText ? (
        <Text style={[styles.supportingText, { color: theme.colors.textMuted }]}>{helperText}</Text>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    gap: 6,
    width: '100%',
  },
  iconSlot: {
    alignItems: 'center',
    height: 24,
    justifyContent: 'center',
    width: 24,
  },
  input: {
    flex: 1,
    height: 48,
    paddingVertical: 0,
  },
  inputWrapper: {
    alignItems: 'center',
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    minHeight: 48,
    paddingHorizontal: 12,
  },
  label: {
    fontWeight: '500',
  },
  supportingText: {
    fontSize: 12,
    lineHeight: 16,
  },
})
