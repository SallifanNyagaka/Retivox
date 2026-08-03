/**
 * Employee stock screen for Retivox mobile.
 *
 * Shows currently sellable normal and damaged stock from the same RPC used by
 * the web employee dashboard.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { Boxes, PackageX } from 'lucide-react-native'
import { Badge } from '../../components/ui/Badge'
import { Card } from '../../components/ui/Card'
import { EmptyState } from '../../components/ui/EmptyState'
import { useOnlineAutoRefresh } from '../../hooks/useOnlineAutoRefresh'
import { useTheme } from '../../hooks/useTheme'
import { resolveEmployeeBranchAssignment } from '../../lib/employee/branchAssignment'
import {
  fetchEmployeeBranchStockLevels,
  fetchEmployeeDashboardData,
  fetchEmployeeSaleProducts,
  type EmployeeBranchStockLevel,
  type EmployeeProductOption,
} from '../../lib/employee/employeeApi'
import { formatMoney, formatQuantity } from '../../lib/employee/pricing'
import { useAuthStore } from '../../store/authStore'
import { handleError } from '../../utils/errorHandler'
import { DashboardScaffold } from '../shared/DashboardScaffold'

type LoadOptions = {
  silent?: boolean
}

/**
 * Renders employee stock levels.
 *
 * @returns Employee stock screen.
 */
export default function EmployeeStockScreen() {
  const { theme } = useTheme()
  const user = useAuthStore((state) => state.user)
  const setUser = useAuthStore((state) => state.setUser)
  const [physicalStock, setPhysicalStock] = useState<EmployeeBranchStockLevel[]>([])
  const [recoveryProducts, setRecoveryProducts] = useState<EmployeeProductOption[]>([])
  const [currency, setCurrency] = useState('KES')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadProducts = useCallback(async (options: LoadOptions = {}) => {
    if (!options.silent) {
      setLoading(true)
    }
    setError(null)

    try {
      const assignedUser = await resolveEmployeeBranchAssignment(user, setUser)
      const [dashboardData, branchStock, saleProducts] = await Promise.all([
        fetchEmployeeDashboardData(assignedUser.businessId, assignedUser.branchId, assignedUser.id),
        fetchEmployeeBranchStockLevels(assignedUser.businessId, assignedUser.branchId, assignedUser.id),
        fetchEmployeeSaleProducts(assignedUser.branchId, assignedUser.id, assignedUser.businessId),
      ])
      setCurrency(dashboardData.currency)
      setPhysicalStock(branchStock)
      setRecoveryProducts(saleProducts.filter((product) => product.stockSource === 'recovery'))
    } catch (loadError) {
      const handled = handleError('EmployeeStock.loadProducts', loadError)
      setError(handled.message)
    } finally {
      if (!options.silent) {
        setLoading(false)
      }
    }
  }, [setUser, user])

  useEffect(() => {
    void loadProducts()
  }, [loadProducts])
  useOnlineAutoRefresh(() => loadProducts({ silent: true }), { label: 'EmployeeStock.autoRefresh' })

  const normalCount = useMemo(() => physicalStock.length, [physicalStock])
  const damagedCount = useMemo(() => recoveryProducts.length, [recoveryProducts])

  return (
    <DashboardScaffold
      title="Stock Levels"
      subtitle={user?.branchName ?? 'Assigned branch'}
      loading={loading}
      error={error}
      onRefresh={loadProducts}
      metrics={[
        { label: 'Normal products', value: String(normalCount), delta: 'Sellable now' },
        { label: 'Damaged products', value: String(damagedCount), delta: damagedCount > 0 ? 'Recovery stock' : 'None approved' },
      ]}
    >
      {physicalStock.length === 0 && recoveryProducts.length === 0 ? (
        <EmptyState heading="No physical stock" subtitle="This branch has no products on hand. If stock was just received, it will appear as soon as it is approved." />
      ) : (
        <View style={styles.list}>
          {physicalStock.map((item) => {
            const available = Math.max(item.baseQuantityOnHand - item.baseQuantityReserved, 0)

            return (
              <Card key={`normal-${item.productId}`} style={styles.row}>
                <View style={styles.rowHeader}>
                  <View style={styles.titleGroup}>
                    <Boxes color={theme.colors.primary} size={18} />
                    <Text style={[styles.title, { color: theme.colors.textPrimary }]}>{item.name}</Text>
                  </View>
                  <Badge label="Normal" variant="info" />
                </View>
                <Text style={[styles.subtitle, { color: theme.colors.textMuted }]}>{item.sku || 'No SKU'}</Text>
                <View style={styles.stockLine}>
                  <Text style={[styles.quantity, { color: theme.colors.primary }]}>{formatQuantity(available)} {item.unit} available</Text>
                  <Text style={[styles.price, { color: theme.colors.textMuted }]}>On hand: {formatQuantity(item.baseQuantityOnHand)}</Text>
                </View>
              </Card>
            )
          })}
          {recoveryProducts.map((item) => (
            <Card key={item.optionId} style={styles.row}>
              <View style={styles.rowHeader}>
                <View style={styles.titleGroup}>
                  <PackageX color={theme.colors.accent} size={18} />
                  <Text style={[styles.title, { color: theme.colors.textPrimary }]}>{item.name}</Text>
                </View>
                <Badge label="Damaged" variant="warning" />
              </View>
              <Text style={[styles.subtitle, { color: theme.colors.textMuted }]}>{item.sku || 'No SKU'}</Text>
              <View style={styles.stockLine}>
                <Text style={[styles.quantity, { color: theme.colors.accent }]}>{formatQuantity(Math.max(item.baseQuantityOnHand - item.baseQuantityReserved, 0))} {item.unit} available</Text>
                <Text style={[styles.price, { color: theme.colors.textMuted }]}>Recovery price {formatMoney(item.sellingPrice, currency)}</Text>
              </View>
            </Card>
          ))}
        </View>
      )}
    </DashboardScaffold>
  )
}

const styles = StyleSheet.create({
  price: {
    fontSize: 12,
    fontWeight: '600',
  },
  quantity: {
    fontSize: 14,
    fontWeight: '900',
  },
  row: {
    gap: 8,
    marginBottom: 10,
  },
  list: {
    gap: 10,
  },
  rowHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'space-between',
  },
  stockLine: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  subtitle: {
    fontSize: 12,
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
