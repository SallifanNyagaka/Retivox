/**
 * Authentication navigator for Retivox mobile.
 *
 * Contains the login screen shown when no valid Supabase session exists.
 */

import { createNativeStackNavigator } from '@react-navigation/native-stack'
import LoginScreen from '../screens/auth/LoginScreen'
import type { AuthStackParamList } from '../types/navigation'

const Stack = createNativeStackNavigator<AuthStackParamList>()

/**
 * Renders the auth stack.
 *
 * @returns Auth navigator.
 */
export function AuthNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Login" component={LoginScreen} />
    </Stack.Navigator>
  )
}
