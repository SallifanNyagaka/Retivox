/**
 * Custom Retivox mobile bottom tab bar.
 *
 * Provides role-aware primary tabs, an emphasized employee New Sale action, and
 * a More bottom sheet for secondary navigation destinations.
 */

import { useState } from 'react'
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs'
import {
  BarChart3,
  Bell,
  Boxes,
  Building2,
  ClipboardList,
  Home,
  Package,
  PackageX,
  ReceiptText,
  Settings,
  ShoppingCart,
  SlidersHorizontal,
  Truck,
  User,
  UserCog,
  Users,
  WalletCards,
  type LucideIcon,
} from 'lucide-react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '../../hooks/useTheme'
import { Modal } from '../ui/Modal'

export type TabBarRole = 'owner' | 'admin' | 'employee'

export type MoreMenuItem = {
  label: string
  routeName?: string
  onPress?: () => void
}

export type MoreMenuSection = {
  label: string
  items: MoreMenuItem[]
}

export type TabBarProps = BottomTabBarProps & {
  role: TabBarRole
  moreSections?: MoreMenuSection[]
  onLogout?: () => void
}

type NavigationLike = {
  navigate: (name: string) => void
}

/**
 * Formats route names into readable tab labels.
 *
 * @param routeName - React Navigation route name.
 * @returns Human-readable route label.
 */
function formatRouteLabel(routeName: string): string {
  return routeName
    .replace(/Screen$/, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^Owner /, '')
    .replace(/^Admin /, '')
    .replace(/^Employee /, '')
}

/**
 * Returns a Lucide icon for a route or menu label.
 *
 * @param routeName - React Navigation route name or menu label.
 * @returns Icon component.
 */
function getRouteIcon(routeName: string): LucideIcon {
  const normalized = routeName.toLowerCase()

  if (normalized.includes('damaged')) return PackageX
  if (normalized.includes('transaction')) return ReceiptText
  if (normalized.includes('analytic')) return BarChart3
  if (normalized.includes('stock')) return Boxes
  if (normalized.includes('transfer')) return Truck
  if (normalized.includes('product')) return Package
  if (normalized.includes('finance')) return WalletCards
  if (normalized.includes('branch')) return Building2
  if (normalized.includes('employee')) return Users
  if (normalized.includes('admin')) return UserCog
  if (normalized.includes('audit')) return ClipboardList
  if (normalized.includes('setting')) return Settings
  if (normalized.includes('notification')) return Bell
  if (normalized.includes('profile')) return User
  if (normalized.includes('more')) return SlidersHorizontal
  if (normalized.includes('sale') || normalized.includes('pos')) return ShoppingCart
  return Home
}

/**
 * Returns true when a route should open the More sheet.
 *
 * @param routeName - React Navigation route name.
 * @returns Whether this route is the More route.
 */
function isMoreRoute(routeName: string): boolean {
  return routeName.toLowerCase().includes('more')
}

/**
 * Returns true when a route is the employee primary New Sale route.
 *
 * @param role - Active user role.
 * @param routeName - React Navigation route name.
 * @returns Whether the route should be visually emphasized.
 */
function isPrimarySaleRoute(role: TabBarRole, routeName: string): boolean {
  const normalized = routeName.toLowerCase()
  return role === 'employee' && (normalized.includes('sale') || normalized.includes('pos'))
}

/**
 * Returns whether a route should be visible in the bottom tab row.
 *
 * @param role - Active user role.
 * @param routeName - React Navigation route name.
 * @returns True when the route is a primary tab.
 */
function isVisibleTabRoute(role: TabBarRole, routeName: string): boolean {
  const normalized = routeName.toLowerCase()

  if (normalized.includes('more')) return true

  if (role === 'employee') {
    return normalized.includes('home') || normalized.includes('pos') || normalized.includes('transaction')
  }

  if (role === 'admin') {
    return normalized.includes('home') || normalized.includes('stock') || normalized.includes('transaction')
  }

  return normalized.includes('home') || normalized.includes('analytic') || normalized.includes('transaction')
}

/**
 * Builds default More menu sections by role.
 *
 * @param role - Active user role.
 * @param onLogout - Optional logout callback.
 * @returns More menu sections.
 */
function getDefaultMoreSections(role: TabBarRole, onLogout?: () => void): MoreMenuSection[] {
  if (role === 'employee') {
    return [
      {
        label: 'Employee',
        items: [
          { label: 'Stock levels', routeName: 'EmployeeStock' },
          { label: 'Report damaged stock', routeName: 'EmployeeDamagedStock' },
          { label: 'Profile', routeName: 'EmployeeProfile' },
          { label: 'Notifications', routeName: 'EmployeeNotifications' },
          { label: 'Log out', onPress: onLogout },
        ],
      },
    ]
  }

  if (role === 'admin') {
    return [
      {
        label: 'Admin',
        items: [
          { label: 'Transfers', routeName: 'AdminTransfers' },
          { label: 'Products', routeName: 'AdminProducts' },
          { label: 'Damaged stock', routeName: 'AdminDamagedStock' },
          { label: 'Employees', routeName: 'AdminEmployees' },
          { label: 'Notifications', routeName: 'AdminNotifications' },
          { label: 'Settings', routeName: 'AdminSettings' },
          { label: 'Log out', onPress: onLogout },
        ],
      },
    ]
  }

  return [
    {
      label: 'Management',
      items: [
        { label: 'Branches', routeName: 'OwnerBranches' },
        { label: 'Stock', routeName: 'OwnerStock' },
        { label: 'Transfers', routeName: 'OwnerTransfers' },
        { label: 'Products', routeName: 'OwnerProducts' },
        { label: 'Finances', routeName: 'OwnerFinances' },
      ],
    },
    {
      label: 'People and system',
      items: [
        { label: 'Admins', routeName: 'OwnerAdmins' },
        { label: 'Employees', routeName: 'OwnerEmployees' },
        { label: 'Audit Log', routeName: 'OwnerAudit' },
        { label: 'Settings', routeName: 'OwnerSettings' },
        { label: 'Notifications', routeName: 'OwnerNotifications' },
        { label: 'Log out', onPress: onLogout },
      ],
    },
  ]
}

/**
 * Safely navigates by route name.
 *
 * @param navigation - React Navigation object.
 * @param routeName - Route name to navigate to.
 * @returns Void.
 */
function navigateByName(navigation: BottomTabBarProps['navigation'], routeName: string) {
  ;(navigation as unknown as NavigationLike).navigate(routeName)
}

/**
 * Renders the custom Retivox tab bar.
 *
 * @param props - Tab bar props.
 * @returns Custom tab bar element.
 */
export function TabBar({ state, descriptors, navigation, role, moreSections, onLogout }: TabBarProps) {
  const { theme } = useTheme()
  const insets = useSafeAreaInsets()
  const [moreOpen, setMoreOpen] = useState(false)
  const sections = moreSections ?? getDefaultMoreSections(role, onLogout)

  /**
   * Handles tab presses.
   *
   * @param routeName - Pressed route name.
   * @param routeKey - Pressed route key.
   * @param isFocused - Whether the tab is focused.
   * @returns Void.
   */
  const handleTabPress = (routeName: string, routeKey: string, isFocused: boolean) => {
    if (isMoreRoute(routeName)) {
      setMoreOpen(true)
      return
    }

    const event = navigation.emit({
      type: 'tabPress',
      target: routeKey,
      canPreventDefault: true,
    })

    if (!isFocused && !event.defaultPrevented) {
      navigateByName(navigation, routeName)
    }
  }

  /**
   * Handles More menu item presses.
   *
   * @param item - Pressed menu item.
   * @returns Void.
   */
  const handleMoreItemPress = (item: MoreMenuItem) => {
    setMoreOpen(false)

    if (item.onPress) {
      item.onPress()
      return
    }

    if (item.routeName) {
      navigateByName(navigation, item.routeName)
    }
  }

  return (
    <>
      <View
        style={[
          styles.container,
          theme.shadows.card,
          {
            backgroundColor: theme.colors.surface,
            borderTopColor: theme.colors.border,
            paddingBottom: Math.max(insets.bottom, 8),
          },
        ]}
      >
        {state.routes.filter((route) => isVisibleTabRoute(role, route.name)).map((route) => {
          const index = state.routes.findIndex((candidate) => candidate.key === route.key)
          const descriptor = descriptors[route.key]
          const isFocused = state.index === index
          const primarySale = isPrimarySaleRoute(role, route.name)
          const label =
            typeof descriptor.options.tabBarLabel === 'string'
              ? descriptor.options.tabBarLabel
              : descriptor.options.title ?? formatRouteLabel(route.name)
          const Icon = getRouteIcon(route.name)

          return (
            <Pressable
              accessibilityLabel={descriptor.options.tabBarAccessibilityLabel ?? label}
              accessibilityRole="button"
              accessibilityState={isFocused ? { selected: true } : undefined}
              android_ripple={Platform.OS === 'android' ? { color: theme.colors.primaryLight, borderless: true } : undefined}
              key={route.key}
              onPress={() => handleTabPress(route.name, route.key, isFocused)}
              style={({ pressed }) => [styles.tab, primarySale ? styles.primarySaleTab : null, pressed ? styles.pressed : null]}
            >
              <View
                style={[
                  styles.iconCircle,
                  primarySale ? styles.primarySaleCircle : null,
                  {
                    backgroundColor: primarySale
                      ? theme.colors.primary
                      : isFocused
                        ? theme.colors.primaryLight
                        : 'transparent',
                  },
                ]}
              >
                <Icon
                  color={primarySale ? theme.colors.primaryForeground : isFocused ? theme.colors.primary : theme.colors.textMuted}
                  size={primarySale ? 26 : 18}
                  strokeWidth={2.4}
                />
              </View>
              <Text
                numberOfLines={1}
                style={[
                  styles.label,
                  {
                    color: isFocused ? theme.colors.primary : theme.colors.textMuted,
                    fontSize: theme.typography.sizes.xs,
                  },
                ]}
              >
                {label}
              </Text>
            </Pressable>
          )
        })}
      </View>

      <Modal visible={moreOpen} title="More" onClose={() => setMoreOpen(false)}>
        <View style={styles.moreContent}>
          {sections.map((section) => (
            <View key={section.label} style={styles.moreSection}>
              <Text style={[styles.sectionLabel, { color: theme.colors.textMuted }]}>{section.label}</Text>
              {section.items.map((item) => (
                (() => {
                  const Icon = getRouteIcon(item.routeName ?? item.label)

                  return (
                <Pressable
                  accessibilityLabel={item.label}
                  accessibilityRole="button"
                  android_ripple={Platform.OS === 'android' ? { color: theme.colors.primaryLight } : undefined}
                  key={`${section.label}-${item.label}`}
                  onPress={() => handleMoreItemPress(item)}
                  style={({ pressed }) => [
                    styles.moreItem,
                    { borderColor: theme.colors.border, backgroundColor: theme.colors.background },
                    pressed ? styles.pressed : null,
                  ]}
                >
                  <Icon color={theme.colors.primary} size={20} strokeWidth={2.4} />
                  <Text style={[styles.moreLabel, { color: theme.colors.textPrimary }]}>{item.label}</Text>
                </Pressable>
                  )
                })()
              ))}
            </View>
          ))}
        </View>
      </Modal>
    </>
  )
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    borderTopWidth: 1,
    flexDirection: 'row',
    minHeight: 68,
    paddingHorizontal: 8,
    paddingTop: 8,
  },
  iconCircle: {
    alignItems: 'center',
    borderRadius: 999,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  label: {
    fontWeight: '600',
    marginTop: 3,
  },
  moreContent: {
    gap: 18,
  },
  moreItem: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    minHeight: 48,
    paddingHorizontal: 14,
  },
  moreLabel: {
    fontSize: 15,
    fontWeight: '600',
  },
  moreSection: {
    gap: 10,
  },
  pressed: {
    opacity: 0.72,
  },
  primarySaleCircle: {
    height: 52,
    width: 52,
  },
  primarySaleTab: {
    marginTop: -22,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  tab: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    minHeight: 52,
  },
})
