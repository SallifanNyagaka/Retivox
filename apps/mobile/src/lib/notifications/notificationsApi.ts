import { getConnectivityState } from '../network/connectivity'
import { readMobileCache, writeMobileCache } from '../watermelon/cache'
import { supabase } from '../supabase/client'

export type MobileNotification = {
  id: string
  type: string
  title: string
  body: string
  isRead: boolean
  createdAt: string
}

type NotificationRow = {
  id: string
  type: string
  title: string
  body: string
  is_read: boolean
  created_at: string
}

function cacheKey(userId: string): string {
  return `notifications:${userId}`
}

function mapNotification(row: NotificationRow): MobileNotification {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    isRead: row.is_read,
    createdAt: row.created_at,
  }
}

/**
 * Loads the signed-in user's notification inbox and retains the last result
 * locally so important review and sync messages remain visible offline.
 */
export async function fetchMobileNotifications(userId: string): Promise<MobileNotification[]> {
  const cached = await readMobileCache<MobileNotification[]>(cacheKey(userId))
  const connectivity = await getConnectivityState().catch(() => ({ isOnline: false, connectionType: null }))

  if (!connectivity.isOnline) return cached ?? []

  try {
    const { data, error } = await supabase
      .from('notifications')
      .select('id, type, title, body, is_read, created_at')
      .eq('recipient_id', userId)
      .order('created_at', { ascending: false })
      .range(0, 49)

    if (error) throw error

    const notifications = ((data ?? []) as NotificationRow[]).map(mapNotification)
    await writeMobileCache(cacheKey(userId), notifications)
    return notifications
  } catch (error) {
    if (cached) return cached
    throw error
  }
}

/**
 * Marks a notification as read. A failed offline request intentionally leaves
 * the local state unchanged so the unread alert is not silently lost.
 */
export async function markMobileNotificationRead(userId: string, notificationId: string): Promise<void> {
  const { error } = await supabase
    .from('notifications')
    .update({ is_read: true })
    .eq('id', notificationId)
    .eq('recipient_id', userId)

  if (error) throw error

  const cached = await readMobileCache<MobileNotification[]>(cacheKey(userId))
  if (cached) {
    await writeMobileCache(
      cacheKey(userId),
      cached.map((notification) => notification.id === notificationId ? { ...notification, isRead: true } : notification),
    )
  }
}
