/**
 * Shared WebView wrapper for Retivox mobile dashboard parity.
 *
 * Owner and admin management flows already exist deeply on web. Embedding those
 * routes lets mobile users access the exact same add/edit/delete workflows
 * without duplicating complex forms in React Native.
 */

import { useMemo, useRef, useState } from 'react'
import { Platform, StyleSheet, Text, View } from 'react-native'
import { RefreshCcw } from 'lucide-react-native'
import { WebView } from 'react-native-webview'
import type { WebView as WebViewType } from 'react-native-webview'
import { SafeAreaView } from 'react-native-safe-area-context'
import { ScreenHeader } from '../layout/ScreenHeader'
import { Button } from '../ui/Button'
import { EmptyState } from '../ui/EmptyState'
import { LoadingSpinner } from '../ui/LoadingSpinner'
import { useTheme } from '../../hooks/useTheme'
import { WEB_APP_URL } from '../../lib/config/env'
import { useAuthStore } from '../../store/authStore'

export type WebDashboardScreenProps = {
  title: string
  subtitle: string
  path: string
}

/**
 * Builds an absolute web dashboard URL.
 *
 * @param path - Dashboard path.
 * @returns Absolute URL or null.
 */
function buildSessionHandoffUrl(): string | null {
  if (!WEB_APP_URL) {
    return null
  }

  try {
    return new URL('/api/mobile/session', WEB_APP_URL.endsWith('/') ? WEB_APP_URL : `${WEB_APP_URL}/`).toString()
  } catch {
    return null
  }
}

/**
 * Returns whether a URL is probably unreachable from a physical phone.
 *
 * @param url - Web app URL.
 * @returns Whether the URL is localhost-like.
 */
function isLocalhostUrl(url: string): boolean {
  return /\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(url)
}

/**
 * Renders an embedded web dashboard route.
 *
 * @param props - Screen props.
 * @returns Web-backed dashboard screen.
 */
export function WebDashboardScreen({ title, subtitle, path }: WebDashboardScreenProps) {
  const { theme } = useTheme()
  const session = useAuthStore((state) => state.session)
  const webViewRef = useRef<WebViewType>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const url = useMemo(() => buildSessionHandoffUrl(), [])
  const showLocalhostHint = Boolean(url && Platform.OS !== 'web' && isLocalhostUrl(url))

  if (!url) {
    return (
      <SafeAreaView edges={['bottom']} style={[styles.safeArea, { backgroundColor: theme.colors.background }]}>
        <ScreenHeader title={title} subtitle={subtitle} />
        <View style={styles.center}>
          <EmptyState
            heading="Web app URL is missing"
            subtitle="Set EXPO_PUBLIC_WEB_APP_URL in apps/mobile/.env to your Vercel URL or your computer LAN URL."
          />
        </View>
      </SafeAreaView>
    )
  }

  if (!session?.access_token || !session.refresh_token) {
    return (
      <SafeAreaView edges={['bottom']} style={[styles.safeArea, { backgroundColor: theme.colors.background }]}>
        <ScreenHeader title={title} subtitle={subtitle} />
        <View style={styles.center}>
          <EmptyState
            heading="Reconnect to open this section"
            subtitle="Management pages need an active connection. Once online, Retivox will securely open this dashboard without asking you to sign in again."
          />
        </View>
      </SafeAreaView>
    )
  }

  const source = useMemo(() => ({
    uri: url,
    method: 'POST' as const,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      accessToken: session.access_token,
      refreshToken: session.refresh_token,
      path,
    }),
  }), [path, session.access_token, session.refresh_token, url])

  return (
    <SafeAreaView edges={['bottom']} style={[styles.safeArea, { backgroundColor: theme.colors.background }]}>
      <ScreenHeader
        title={title}
        subtitle={subtitle}
        rightAction={{
          label: 'Reload',
          icon: <RefreshCcw color={theme.colors.primary} size={16} />,
          onPress: () => {
            setError(null)
            setLoading(true)
            webViewRef.current?.reload()
          },
        }}
      />
      {showLocalhostHint ? (
        <View style={[styles.hint, { backgroundColor: theme.colors.accentLight }]}>
          <Text style={[styles.hintText, { color: theme.colors.accent }]}>
            This screen points to localhost. On a phone, set EXPO_PUBLIC_WEB_APP_URL to your Vercel URL or LAN IP.
          </Text>
        </View>
      ) : null}
      <View style={styles.webContainer}>
        {loading ? <LoadingSpinner label="Loading web dashboard..." /> : null}
        {error ? (
          <View style={styles.errorOverlay}>
            <EmptyState heading="Unable to load web dashboard" subtitle={error} />
            <Button
              label="Try again"
              onPress={() => {
                setError(null)
                setLoading(true)
                webViewRef.current?.reload()
              }}
            />
          </View>
        ) : null}
        <WebView
          ref={webViewRef}
          key={`${path}-${session.user.id}-${session.access_token.slice(-12)}`}
          source={source}
          onLoadEnd={() => setLoading(false)}
          onError={(event) => {
            setLoading(false)
            setError(event.nativeEvent.description || 'The web app could not be reached.')
          }}
          onHttpError={(event) => {
            setLoading(false)
            setError(`The dashboard could not be opened (HTTP ${event.nativeEvent.statusCode}).`)
          }}
          sharedCookiesEnabled
          thirdPartyCookiesEnabled
          startInLoadingState
          style={styles.webView}
        />
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    justifyContent: 'center',
    padding: 16,
  },
  errorOverlay: {
    bottom: 0,
    gap: 12,
    justifyContent: 'center',
    left: 0,
    padding: 16,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 2,
  },
  hint: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  hintText: {
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 18,
    textAlign: 'center',
  },
  safeArea: {
    flex: 1,
  },
  webContainer: {
    flex: 1,
  },
  webView: {
    flex: 1,
  },
})
