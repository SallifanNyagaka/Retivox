import { useCallback, useEffect, useMemo, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { Bell, Check } from 'lucide-react-native'
import { Badge } from '../../components/ui/Badge'
import { Card } from '../../components/ui/Card'
import { EmptyState } from '../../components/ui/EmptyState'
import { useOnlineAutoRefresh } from '../../hooks/useOnlineAutoRefresh'
import { useTheme } from '../../hooks/useTheme'
import { fetchMobileNotifications, markMobileNotificationRead, type MobileNotification } from '../../lib/notifications/notificationsApi'
import { useAuthStore } from '../../store/authStore'
import { formatDateTime } from '../../utils/dateFormatter'
import { handleError } from '../../utils/errorHandler'
import { DashboardScaffold } from './DashboardScaffold'

export type NotificationsScreenProps = {
  title: string
  subtitle: string
}

/**
 * Renders the current user's database-backed notification inbox.
 */
export function NotificationsScreen({ title, subtitle }: NotificationsScreenProps) {
  const { theme } = useTheme()
  const user = useAuthStore((state) => state.user)
  const [notifications, setNotifications] = useState<MobileNotification[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadNotifications = useCallback(async () => {
    if (!user?.id) {
      setError('Your account is unavailable.')
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)

    try {
      setNotifications(await fetchMobileNotifications(user.id))
    } catch (loadError) {
      setError(handleError('Notifications.load', loadError).message)
    } finally {
      setLoading(false)
    }
  }, [user?.id])

  useEffect(() => {
    void loadNotifications()
  }, [loadNotifications])
  useOnlineAutoRefresh(loadNotifications, { label: 'Notifications.autoRefresh' })

  const unreadCount = useMemo(() => notifications.filter((notification) => !notification.isRead).length, [notifications])

  const markRead = useCallback(async (notification: MobileNotification) => {
    if (!user?.id || notification.isRead) return

    try {
      await markMobileNotificationRead(user.id, notification.id)
      setNotifications((current) => current.map((item) => item.id === notification.id ? { ...item, isRead: true } : item))
    } catch (markError) {
      setError(handleError('Notifications.markRead', markError).message)
    }
  }, [user?.id])

  return (
    <DashboardScaffold
      title={title}
      subtitle={subtitle}
      loading={loading}
      error={error}
      onRefresh={loadNotifications}
      metrics={[{ label: 'Unread', value: String(unreadCount), delta: unreadCount === 1 ? 'notification' : 'notifications' }]}
    >
      {notifications.length === 0 ? (
        <EmptyState heading="No notifications" subtitle="Approvals, sales reviews, stock alerts, and account updates will appear here." />
      ) : (
        <View style={styles.list}>
          {notifications.map((notification) => (
            <Card key={notification.id} onPress={() => void markRead(notification)} style={notification.isRead ? undefined : { borderColor: theme.colors.primary }}>
              <View style={styles.header}>
                <View style={styles.titleGroup}>
                  <Bell color={notification.isRead ? theme.colors.textMuted : theme.colors.primary} size={18} />
                  <Text style={[styles.title, { color: theme.colors.textPrimary }]}>{notification.title}</Text>
                </View>
                {notification.isRead ? <Check color={theme.colors.success} size={17} /> : <Badge label="New" variant="info" />}
              </View>
              <Text style={[styles.body, { color: theme.colors.textMuted }]}>{notification.body}</Text>
              <Text style={[styles.time, { color: theme.colors.textMuted }]}>{formatDateTime(notification.createdAt)}</Text>
            </Card>
          ))}
        </View>
      )}
    </DashboardScaffold>
  )
}

const styles = StyleSheet.create({
  body: {
    fontSize: 13,
    lineHeight: 19,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'space-between',
  },
  list: {
    gap: 10,
  },
  time: {
    fontSize: 11,
    fontWeight: '600',
    marginTop: 8,
  },
  title: {
    flex: 1,
    fontSize: 15,
    fontWeight: '800',
  },
  titleGroup: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: 8,
  },
})
