/**
 * Admin role navigator for Retivox mobile.
 */

import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import { TabBar } from '../components/layout/TabBar'
import { useAuth } from '../hooks/useAuth'
import AdminDamagedStockScreen from '../screens/admin/AdminDamagedStockScreen'
import AdminEmployeesScreen from '../screens/admin/AdminEmployeesScreen'
import AdminHomeScreen from '../screens/admin/AdminHomeScreen'
import AdminNotificationsScreen from '../screens/admin/AdminNotificationsScreen'
import AdminProductsScreen from '../screens/admin/AdminProductsScreen'
import AdminSettingsScreen from '../screens/admin/AdminSettingsScreen'
import AdminStockScreen from '../screens/admin/AdminStockScreen'
import AdminTransactionsScreen from '../screens/admin/AdminTransactionsScreen'
import AdminTransfersScreen from '../screens/admin/AdminTransfersScreen'
import type { AdminTabParamList } from '../types/navigation'

const Tab = createBottomTabNavigator<AdminTabParamList>()

/**
 * Renders admin tabs.
 *
 * @returns Admin tab navigator.
 */
export function AdminNavigator() {
  const { logout } = useAuth()

  return (
    <Tab.Navigator screenOptions={{ headerShown: false }} tabBar={(props) => <TabBar {...props} role="admin" onLogout={logout} />}>
      <Tab.Screen name="AdminHome" component={AdminHomeScreen} options={{ title: 'Home' }} />
      <Tab.Screen name="AdminStock" component={AdminStockScreen} options={{ title: 'Stock' }} />
      <Tab.Screen name="AdminTransactions" component={AdminTransactionsScreen} options={{ title: 'Transactions' }} />
      <Tab.Screen name="AdminMore" component={AdminHomeScreen} options={{ title: 'More' }} />
      <Tab.Screen name="AdminTransfers" component={AdminTransfersScreen} options={{ title: 'Transfers' }} />
      <Tab.Screen name="AdminProducts" component={AdminProductsScreen} options={{ title: 'Products' }} />
      <Tab.Screen name="AdminDamagedStock" component={AdminDamagedStockScreen} options={{ title: 'Damaged' }} />
      <Tab.Screen name="AdminEmployees" component={AdminEmployeesScreen} options={{ title: 'Employees' }} />
      <Tab.Screen name="AdminSettings" component={AdminSettingsScreen} options={{ title: 'Settings' }} />
      <Tab.Screen name="AdminNotifications" component={AdminNotificationsScreen} options={{ title: 'Notifications' }} />
    </Tab.Navigator>
  )
}
