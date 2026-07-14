/**
 * Login screen for Retivox mobile.
 *
 * Authenticates with Supabase, loads the user's profile, and lets RootNavigator
 * route the session to the correct role dashboard.
 */

import { useState } from 'react'
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { Input } from '../../components/ui/Input'
import { Toast } from '../../components/ui/Toast'
import { useAuth } from '../../hooks/useAuth'
import { useTheme } from '../../hooks/useTheme'
import { getErrorMessage } from '../../utils/errorHandler'

/**
 * Renders the login form.
 *
 * @returns Login screen.
 */
export default function LoginScreen() {
  const { theme } = useTheme()
  const auth = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)

  /**
   * Submits login details.
   *
   * @returns Promise that resolves after login attempt.
   */
  async function submitLogin(): Promise<void> {
    setError(null)

    try {
      await auth.login(email, password)
    } catch (caughtError) {
      setError(getErrorMessage(caughtError))
    }
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.colors.background }]}>
      {error ? <Toast message={error} type="error" onDismiss={() => setError(null)} /> : null}
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.keyboard}>
        <View style={styles.hero}>
          <Text style={[styles.brand, { color: theme.colors.primary }]}>Retivox</Text>
          <Text style={[styles.tagline, { color: theme.colors.textMuted }]}>Run every store. From anywhere.</Text>
        </View>
        <Card style={styles.card}>
          <Text style={[styles.title, { color: theme.colors.textPrimary }]}>Welcome back</Text>
          <Text style={[styles.subtitle, { color: theme.colors.textMuted }]}>Sign in to access your mobile dashboard.</Text>
          <View style={styles.form}>
            <Input label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
            <Input label="Password" value={password} onChangeText={setPassword} secureTextEntry />
            <Button label="Sign in" loading={auth.isLoading} onPress={submitLogin} fullWidth />
          </View>
        </Card>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  brand: {
    fontSize: 34,
    fontWeight: '800',
    letterSpacing: -0.8,
  },
  card: {
    gap: 12,
    width: '100%',
  },
  form: {
    gap: 14,
    marginTop: 10,
  },
  hero: {
    alignItems: 'center',
    gap: 6,
    marginBottom: 28,
  },
  keyboard: {
    flex: 1,
    justifyContent: 'center',
    padding: 20,
  },
  safeArea: {
    flex: 1,
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
  },
  tagline: {
    fontSize: 14,
    fontWeight: '500',
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
  },
})
