/**
 * Expo entry component for the Retivox mobile app.
 *
 * Wraps navigation with the theme provider and safe-area provider.
 */

import 'react-native-gesture-handler'
import { Suspense, lazy } from 'react'
import { StatusBar } from 'expo-status-bar'
import { StyleSheet, Text, View } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { LoadingSpinner } from './src/components/ui/LoadingSpinner'
import { getMissingEnvironmentKeys, isSupabaseConfigured } from './src/lib/config/env'
import { useTheme } from './src/hooks/useTheme'
import { ThemeProvider } from './src/theme/ThemeContext'

const RootNavigator = lazy(async () => {
  const module = await import('./src/navigation/RootNavigator')
  return { default: module.RootNavigator }
})

/**
 * Renders the mobile app root.
 *
 * @returns Expo app component.
 */
export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <StatusBar style="auto" />
        {isSupabaseConfigured ? (
          <Suspense fallback={<LoadingSpinner label="Opening Retivox..." />}>
            <RootNavigator />
          </Suspense>
        ) : (
          <MissingConfigurationScreen />
        )}
      </ThemeProvider>
    </SafeAreaProvider>
  )
}

/**
 * Explains missing local setup without crashing Expo Go.
 *
 * @returns Setup guidance screen.
 */
function MissingConfigurationScreen() {
  const { theme } = useTheme()
  const missingKeys = getMissingEnvironmentKeys()

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <View style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
        <Text style={[styles.eyebrow, { color: theme.colors.primary }]}>Setup needed</Text>
        <Text style={[styles.title, { color: theme.colors.textPrimary }]}>Supabase is not configured</Text>
        <Text style={[styles.body, { color: theme.colors.textMuted }]}>
          Create an <Text style={styles.inlineCode}>apps/mobile/.env</Text> file and add these keys, then restart Expo with cache clear.
        </Text>
        <View style={[styles.codeBlock, { backgroundColor: theme.colors.background }]}>
          {missingKeys.map((key) => (
            <Text key={key} style={[styles.codeLine, { color: theme.colors.textPrimary }]}>
              {key}=...
            </Text>
          ))}
        </View>
        <Text style={[styles.body, { color: theme.colors.textMuted }]}>
          Use <Text style={styles.inlineCode}>apps/mobile/.env.example</Text> as the template.
        </Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  body: {
    fontSize: 15,
    lineHeight: 22,
    marginTop: 12,
  },
  card: {
    borderRadius: 24,
    borderWidth: 1,
    padding: 22,
    width: '100%',
  },
  codeBlock: {
    borderRadius: 16,
    marginTop: 16,
    padding: 14,
  },
  codeLine: {
    fontFamily: 'monospace',
    fontSize: 13,
    lineHeight: 20,
  },
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: 20,
  },
  eyebrow: {
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  inlineCode: {
    fontFamily: 'monospace',
    fontWeight: '700',
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    marginTop: 8,
  },
})
