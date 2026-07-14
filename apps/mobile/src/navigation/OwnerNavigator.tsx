/**
 * Owner role navigator for Retivox mobile.
 */

import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import { TabBar } from '../components/layout/TabBar'
import { useAuth } from '../hooks/useAuth'
import OwnerAdminsScreen from '../screens/owner/OwnerAdminsScreen'
import OwnerAnalyticsScreen from '../screens/owner/OwnerAnalyticsScreen'
import OwnerAuditScreen from '../screens/owner/OwnerAuditScreen'
import OwnerBranchesScreen from '../screens/owner/OwnerBranchesScreen'
import OwnerEmployeesScreen from '../screens/owner/OwnerEmployeesScreen'
import OwnerFinancesScreen from '../screens/owner/OwnerFinancesScreen'
import OwnerHomeScreen from '../screens/owner/OwnerHomeScreen'
import OwnerNotificationsScreen from '../screens/owner/OwnerNotificationsScreen'
import OwnerProductsScreen from '../screens/owner/OwnerProductsScreen'
import OwnerSettingsScreen from '../screens/owner/OwnerSettingsScreen'
import OwnerStockScreen from '../screens/owner/OwnerStockScreen'
import OwnerTransactionsScreen from '../screens/owner/OwnerTransactionsScreen'
import OwnerTransfersScreen from '../screens/owner/OwnerTransfersScreen'
import type { OwnerTabParamList } from '../types/navigation'

const Tab = createBottomTabNavigator<OwnerTabParamList>()

/**
 * Renders owner tabs.
 *
 * @returns Owner tab navigator.
 */
export function OwnerNavigator() {
  const { logout } = useAuth()

  return (
    <Tab.Navigator screenOptions={{ headerShown: false }} tabBar={(props) => <TabBar {...props} role="owner" onLogout={logout} />}>
      <Tab.Screen name="OwnerHome" component={OwnerHomeScreen} options={{ title: 'Home' }} />
      <Tab.Screen name="OwnerAnalytics" component={OwnerAnalyticsScreen} options={{ title: 'Analytics' }} />
      <Tab.Screen name="OwnerTransactions" component={OwnerTransactionsScreen} options={{ title: 'Transactions' }} />
      <Tab.Screen name="OwnerMore" component={OwnerHomeScreen} options={{ title: 'More' }} />
      <Tab.Screen name="OwnerBranches" component={OwnerBranchesScreen} options={{ title: 'Branches' }} />
      <Tab.Screen name="OwnerStock" component={OwnerStockScreen} options={{ title: 'Stock' }} />
      <Tab.Screen name="OwnerTransfers" component={OwnerTransfersScreen} options={{ title: 'Transfers' }} />
      <Tab.Screen name="OwnerProducts" component={OwnerProductsScreen} options={{ title: 'Products' }} />
      <Tab.Screen name="OwnerFinances" component={OwnerFinancesScreen} options={{ title: 'Finances' }} />
      <Tab.Screen name="OwnerEmployees" component={OwnerEmployeesScreen} options={{ title: 'Employees' }} />
      <Tab.Screen name="OwnerAdmins" component={OwnerAdminsScreen} options={{ title: 'Admins' }} />
      <Tab.Screen name="OwnerAudit" component={OwnerAuditScreen} options={{ title: 'Audit' }} />
      <Tab.Screen name="OwnerSettings" component={OwnerSettingsScreen} options={{ title: 'Settings' }} />
      <Tab.Screen name="OwnerNotifications" component={OwnerNotificationsScreen} options={{ title: 'Notifications' }} />
    </Tab.Navigator>
  )
}
