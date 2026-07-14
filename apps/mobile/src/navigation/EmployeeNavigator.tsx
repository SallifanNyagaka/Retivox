/**
 * Employee role navigator for Retivox mobile.
 */

import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import { TabBar } from '../components/layout/TabBar'
import { useAuth } from '../hooks/useAuth'
import EmployeeHomeScreen from '../screens/employee/EmployeeHomeScreen'
import EmployeeDamagedStockScreen from '../screens/employee/EmployeeDamagedStockScreen'
import EmployeeNotificationsScreen from '../screens/employee/EmployeeNotificationsScreen'
import EmployeePOSScreen from '../screens/employee/EmployeePOSScreen'
import EmployeeProfileScreen from '../screens/employee/EmployeeProfileScreen'
import EmployeeStockScreen from '../screens/employee/EmployeeStockScreen'
import EmployeeTransactionsScreen from '../screens/employee/EmployeeTransactionsScreen'
import type { EmployeeTabParamList } from '../types/navigation'

const Tab = createBottomTabNavigator<EmployeeTabParamList>()

/**
 * Renders employee tabs.
 *
 * @returns Employee tab navigator.
 */
export function EmployeeNavigator() {
  const { logout } = useAuth()

  return (
    <Tab.Navigator screenOptions={{ headerShown: false }} tabBar={(props) => <TabBar {...props} role="employee" onLogout={logout} />}>
      <Tab.Screen name="EmployeeHome" component={EmployeeHomeScreen} options={{ title: 'Home' }} />
      <Tab.Screen name="EmployeePOS" component={EmployeePOSScreen} options={{ title: 'New Sale' }} />
      <Tab.Screen name="EmployeeTransactions" component={EmployeeTransactionsScreen} options={{ title: 'Transactions' }} />
      <Tab.Screen name="EmployeeMore" component={EmployeeHomeScreen} options={{ title: 'More' }} />
      <Tab.Screen name="EmployeeStock" component={EmployeeStockScreen} options={{ title: 'Stock' }} />
      <Tab.Screen name="EmployeeDamagedStock" component={EmployeeDamagedStockScreen} options={{ title: 'Damaged' }} />
      <Tab.Screen name="EmployeeProfile" component={EmployeeProfileScreen} options={{ title: 'Profile' }} />
      <Tab.Screen name="EmployeeNotifications" component={EmployeeNotificationsScreen} options={{ title: 'Notifications' }} />
    </Tab.Navigator>
  )
}
