/**
 * Shared WebView wrapper for Retivox mobile dashboard parity.
 *
 * Owner and admin management flows already exist deeply on web. Embedding those
 * routes lets mobile users access the exact same add/edit/delete workflows
 * without duplicating complex forms in React Native.
 */

import AsyncStorage from '@react-native-async-storage/async-storage'
import { useEffect, useMemo, useRef, useState } from 'react'
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
import { supabase } from '../../lib/supabase/client'
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
function buildSessionHandoffUrl(webAppUrl: string | null): string | null {
  if (!webAppUrl) {
    return null
  }

  try {
    return new URL('/api/mobile/session', webAppUrl.endsWith('/') ? webAppUrl : `${webAppUrl}/`).toString()
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
  const [webAppUrl, setWebAppUrl] = useState<string | null>(null)
  const [runtimeConfigLoading, setRuntimeConfigLoading] = useState(true)
  useEffect(() => {
    let mounted = true
    const loadRuntimeUrl = async () => {
      const cacheKey = 'retivox:public-runtime:web-app-url'
      const cachedUrl = await AsyncStorage.getItem(cacheKey).catch(() => null)
      if (mounted && cachedUrl && isAllowedWebAppUrl(cachedUrl)) setWebAppUrl(cachedUrl)

      const { data, error: configError } = await supabase.rpc('public_app_runtime_config')
      const row = Array.isArray(data) ? data[0] as { web_app_url?: string } | undefined : undefined
      const nextUrl = row?.web_app_url ? normalizeWebAppUrl(row.web_app_url) : null
      if (!configError && nextUrl) {
        await AsyncStorage.setItem(cacheKey, nextUrl).catch(() => undefined)
        if (mounted) setWebAppUrl(nextUrl)
      }
      if (mounted) setRuntimeConfigLoading(false)
    }
    void loadRuntimeUrl().catch(() => {
      if (mounted) setRuntimeConfigLoading(false)
    })
    return () => { mounted = false }
  }, [])
  const url = useMemo(() => buildSessionHandoffUrl(webAppUrl), [webAppUrl])
  const showLocalhostHint = Boolean(url && Platform.OS !== 'web' && isLocalhostUrl(url))

  if (runtimeConfigLoading && !url) {
    return (
      <SafeAreaView edges={['bottom']} style={[styles.safeArea, { backgroundColor: theme.colors.background }]}>
        <ScreenHeader title={title} subtitle={subtitle} />
        <View style={styles.center}><LoadingSpinner label="Loading app configuration..." /></View>
      </SafeAreaView>
    )
  }

  if (!url) {
    return (
      <SafeAreaView edges={['bottom']} style={[styles.safeArea, { backgroundColor: theme.colors.background }]}>
        <ScreenHeader title={title} subtitle={subtitle} />
        <View style={styles.center}>
          <EmptyState
            heading="Web app URL is missing"
            subtitle="An administrator needs to set the web app URL under Platform → Runtime settings. This value will be cached for offline launches."
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
            This screen points to localhost. Configure a reachable HTTPS web address under Platform → Runtime settings for phones.
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

function normalizeWebAppUrl(value: string): string | null {
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname))) return null
    if (parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) return null
    return parsed.origin
  } catch {
    return null
  }
}

function isAllowedWebAppUrl(value: string) {
  return normalizeWebAppUrl(value) === value.replace(/\/$/, '')
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
