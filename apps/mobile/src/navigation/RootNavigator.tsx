/**
 * Root navigator for Retivox mobile.
 *
 * Bootstraps stored auth, validates the Supabase session, and routes users to
 * the correct role navigator.
 */

import { Suspense, lazy, useEffect } from 'react'
import { NavigationContainer } from '@react-navigation/native'
import { GlobalRole } from '@smartretail/shared'
import { LoadingSpinner } from '../components/ui/LoadingSpinner'
import { useAuth } from '../hooks/useAuth'
import { useAutoSync } from '../hooks/useAutoSync'
import { AuthNavigator } from './AuthNavigator'

const OwnerNavigator = lazy(async () => {
  const module = await import('./OwnerNavigator')
  return { default: module.OwnerNavigator }
})

const AdminNavigator = lazy(async () => {
  const module = await import('./AdminNavigator')
  return { default: module.AdminNavigator }
})

const EmployeeNavigator = lazy(async () => {
  const module = await import('./EmployeeNavigator')
  return { default: module.EmployeeNavigator }
})

/**
 * Renders the role-aware root navigator.
 *
 * @returns Navigation tree.
 */
export function RootNavigator() {
  const { user, isLoading, bootstrap } = useAuth()
  useAutoSync()

  useEffect(() => {
    bootstrap()
  }, [bootstrap])

  if (isLoading) {
    return <LoadingSpinner label="Opening Retivox..." />
  }

  return (
    <NavigationContainer>
      <Suspense fallback={<LoadingSpinner label="Loading dashboard..." />}>
        {!user ? (
          <AuthNavigator />
        ) : user.globalRole === GlobalRole.Owner ? (
          <OwnerNavigator />
        ) : user.globalRole === GlobalRole.Admin ? (
          <AdminNavigator />
        ) : (
          <EmployeeNavigator />
        )}
      </Suspense>
    </NavigationContainer>
  )
}
