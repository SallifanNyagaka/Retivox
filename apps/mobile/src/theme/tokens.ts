/**
 * Design tokens for the Retivox mobile app.
 *
 * This file translates the web dashboard CSS variables into typed React Native
 * constants so every mobile screen and component can share one visual system.
 */

export type ThemeColorScheme = 'light' | 'dark'

export type ThemeColors = {
  primary: string
  primaryDark: string
  primaryLight: string
  primaryForeground: string
  accent: string
  accentLight: string
  danger: string
  dangerLight: string
  success: string
  successLight: string
  background: string
  surface: string
  textPrimary: string
  textMuted: string
  border: string
  info: string
  infoLight: string
  overlay: string
  shadow: string
}

export type ThemeSpacing = {
  xs: number
  sm: number
  md: number
  lg: number
  xl: number
  '2xl': number
  '3xl': number
}

export type ThemeTypography = {
  fontFamily: string
  sizes: {
    xs: number
    sm: number
    md: number
    lg: number
    xl: number
    '2xl': number
    '3xl': number
  }
  weights: {
    regular: '400'
    medium: '500'
    semibold: '600'
    bold: '700'
    extrabold: '800'
  }
  lineHeights: {
    tight: number
    normal: number
    relaxed: number
  }
}

export type ThemeRadii = {
  card: number
  input: number
  button: number
  badge: number
  sheet: number
}

export type ThemeShadow = {
  shadowColor: string
  shadowOffset: {
    width: number
    height: number
  }
  shadowOpacity: number
  shadowRadius: number
  elevation: number
}

export type ThemeTokens = {
  scheme: ThemeColorScheme
  colors: ThemeColors
  spacing: ThemeSpacing
  typography: ThemeTypography
  radii: ThemeRadii
  shadows: {
    card: ThemeShadow
    raised: ThemeShadow
  }
}

export const lightColors: ThemeColors = {
  primary: '#0F7B5A',
  primaryDark: '#0A5C42',
  primaryLight: '#D1FAE5',
  primaryForeground: '#FFFFFF',
  accent: '#F59E0B',
  accentLight: '#FEF3C7',
  danger: '#EF4444',
  dangerLight: '#FEE2E2',
  success: '#10B981',
  successLight: '#D1FAE5',
  background: '#F8FAFC',
  surface: '#FFFFFF',
  textPrimary: '#0F172A',
  textMuted: '#64748B',
  border: '#E2E8F0',
  info: '#378ADD',
  infoLight: 'rgba(55, 138, 221, 0.12)',
  overlay: 'rgba(15, 23, 42, 0.42)',
  shadow: 'rgba(0, 0, 0, 0.08)',
}

export const darkColors: ThemeColors = {
  primary: '#1DB37A',
  primaryDark: '#0F7B5A',
  primaryLight: '#064E3B',
  primaryForeground: '#FFFFFF',
  accent: '#F59E0B',
  accentLight: '#78350F',
  danger: '#F87171',
  dangerLight: '#7F1D1D',
  success: '#34D399',
  successLight: '#064E3B',
  background: '#0F172A',
  surface: '#1E293B',
  textPrimary: '#F8FAFC',
  textMuted: '#94A3B8',
  border: '#334155',
  info: '#60A5FA',
  infoLight: 'rgba(96, 165, 250, 0.16)',
  overlay: 'rgba(2, 6, 23, 0.62)',
  shadow: 'rgba(0, 0, 0, 0.32)',
}

export const spacing: ThemeSpacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  '2xl': 32,
  '3xl': 40,
}

export const typography: ThemeTypography = {
  fontFamily: 'System',
  sizes: {
    xs: 11,
    sm: 12,
    md: 14,
    lg: 16,
    xl: 18,
    '2xl': 24,
    '3xl': 30,
  },
  weights: {
    regular: '400',
    medium: '500',
    semibold: '600',
    bold: '700',
    extrabold: '800',
  },
  lineHeights: {
    tight: 1.2,
    normal: 1.45,
    relaxed: 1.65,
  },
}

export const radii: ThemeRadii = {
  card: 12,
  input: 8,
  button: 6,
  badge: 999,
  sheet: 24,
}

/**
 * Creates shadow tokens for the given color palette.
 *
 * @param colors - Active color palette.
 * @returns Card and raised shadow presets.
 */
function createShadows(colors: ThemeColors): ThemeTokens['shadows'] {
  return {
    card: {
      shadowColor: colors.shadow,
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.08,
      shadowRadius: 3,
      elevation: 2,
    },
    raised: {
      shadowColor: colors.shadow,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.12,
      shadowRadius: 8,
      elevation: 3,
    },
  }
}

/**
 * Builds a complete token object for a color scheme.
 *
 * @param scheme - Light or dark color scheme.
 * @returns Complete theme token set.
 */
export function createThemeTokens(scheme: ThemeColorScheme): ThemeTokens {
  const colors = scheme === 'dark' ? darkColors : lightColors

  return {
    scheme,
    colors,
    spacing,
    typography,
    radii,
    shadows: createShadows(colors),
  }
}

export const lightTheme = createThemeTokens('light')
export const darkTheme = createThemeTokens('dark')
