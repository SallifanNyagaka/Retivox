/**
 * Employee profile and settings screen for Retivox mobile.
 *
 * Displays identity, branch assignment, sync summary, and logout access.
 */

import { StyleSheet, Text, View } from 'react-native'
import { useAuth } from '../../hooks/useAuth'
import { useSync } from '../../hooks/useSync'
import { useTheme } from '../../hooks/useTheme'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { formatRelativeTime } from '../../utils/dateFormatter'
import { DashboardScaffold } from '../shared/DashboardScaffold'

/**
 * Renders employee profile.
 *
 * @returns Employee profile screen.
 */
export default function EmployeeProfileScreen() {
  const { user, logout } = useAuth()
  const sync = useSync()
  const { theme } = useTheme()

  return (
    <DashboardScaffold title="Profile" subtitle="Account and sync settings">
      <Card>
        <View style={styles.identity}>
          <View style={[styles.avatar, { backgroundColor: theme.colors.primaryLight }]}>
            <Text style={[styles.initials, { color: theme.colors.primary }]}>{user?.name.slice(0, 2).toUpperCase() ?? 'RT'}</Text>
          </View>
          <View style={styles.profileText}>
            <Text style={[styles.name, { color: theme.colors.textPrimary }]}>{user?.name ?? 'Employee'}</Text>
            <Text style={[styles.email, { color: theme.colors.textMuted }]}>{user?.email ?? 'No email'}</Text>
            <Badge label="Employee" variant="info" />
          </View>
        </View>
      </Card>

      <Card style={styles.section}>
        <Text style={[styles.sectionTitle, { color: theme.colors.textPrimary }]}>Sync</Text>
        <Text style={[styles.sectionText, { color: theme.colors.textMuted }]}>Last synced: {formatRelativeTime(sync.lastSyncedAt?.toISOString() ?? null)}</Text>
        <Text style={[styles.sectionText, { color: theme.colors.textMuted }]}>{sync.pendingCount} pending, {sync.failedCount} failed</Text>
        <Button label={sync.isSyncing ? 'Syncing...' : 'Manual sync'} loading={sync.isSyncing} onPress={sync.triggerSync} />
      </Card>

      <Card style={styles.section}>
        <Text style={[styles.sectionTitle, { color: theme.colors.danger }]}>Danger zone</Text>
        <Button label="Log out" variant="danger" onPress={logout} />
      </Card>
    </DashboardScaffold>
  )
}

const styles = StyleSheet.create({
  avatar: {
    alignItems: 'center',
    borderRadius: 999,
    height: 58,
    justifyContent: 'center',
    width: 58,
  },
  email: {
    fontSize: 13,
    marginBottom: 8,
  },
  identity: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 14,
  },
  initials: {
    fontSize: 18,
    fontWeight: '800',
  },
  name: {
    fontSize: 18,
    fontWeight: '700',
  },
  profileText: {
    flex: 1,
  },
  section: {
    marginTop: 14,
  },
  sectionText: {
    fontSize: 13,
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 8,
  },
})
