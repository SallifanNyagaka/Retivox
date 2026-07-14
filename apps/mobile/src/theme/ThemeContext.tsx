/**
 * Theme provider for the Retivox mobile app.
 *
 * The provider resolves system, light, and dark modes and exposes typed design
 * tokens through context so UI components never hardcode app colors.
 */

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { useColorScheme, type ColorSchemeName } from 'react-native'
import { createThemeTokens, type ThemeColorScheme, type ThemeTokens } from './tokens'

export type ThemeMode = 'system' | ThemeColorScheme

export type ThemeContextValue = {
  mode: ThemeMode
  scheme: ThemeColorScheme
  isDark: boolean
  theme: ThemeTokens
  setMode: (mode: ThemeMode) => void
}

type ThemeProviderProps = {
  children: ReactNode
  initialMode?: ThemeMode
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

/**
 * Resolves the active theme scheme from the selected app mode.
 *
 * @param mode - Explicit light/dark mode or system mode.
 * @param systemScheme - Current device color scheme.
 * @returns The resolved light or dark scheme.
 */
function resolveThemeScheme(mode: ThemeMode, systemScheme: ColorSchemeName): ThemeColorScheme {
  if (mode === 'light' || mode === 'dark') {
    return mode
  }

  return systemScheme === 'dark' ? 'dark' : 'light'
}

/**
 * Provides Retivox theme tokens to the mobile component tree.
 *
 * @param props - Provider props.
 * @returns Theme context provider.
 */
export function ThemeProvider({ children, initialMode = 'system' }: ThemeProviderProps) {
  const systemScheme = useColorScheme()
  const [mode, setMode] = useState<ThemeMode>(initialMode)
  const scheme = resolveThemeScheme(mode, systemScheme)
  const theme = useMemo(() => createThemeTokens(scheme), [scheme])

  const value = useMemo<ThemeContextValue>(
    () => ({
      mode,
      scheme,
      isDark: scheme === 'dark',
      theme,
      setMode,
    }),
    [mode, scheme, theme],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

/**
 * Reads the Retivox theme context.
 *
 * @returns Active theme context value.
 */
export function useThemeContext(): ThemeContextValue {
  const context = useContext(ThemeContext)

  if (!context) {
    throw new Error('useThemeContext must be used within ThemeProvider')
  }

  return context
}
