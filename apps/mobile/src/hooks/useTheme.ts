/**
 * Public theme hook for Retivox mobile screens and components.
 *
 * This hook intentionally wraps ThemeContext so future persistence or analytics
 * can be added without changing component imports.
 */

import { useThemeContext, type ThemeContextValue } from '../theme/ThemeContext'

/**
 * Returns active theme tokens and theme controls.
 *
 * @returns Current theme context value.
 */
export function useTheme(): ThemeContextValue {
  return useThemeContext()
}
