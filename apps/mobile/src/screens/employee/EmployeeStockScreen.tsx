/**
 * Employee stock screen for Retivox mobile.
 *
 * Shows currently sellable normal and damaged stock from the same RPC used by
 * the web employee dashboard.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { FlatList, StyleSheet, Text, View } from 'react-native'
import { Boxes, PackageX } from 'lucide-react-native'
import { Badge } from '../../components/ui/Badge'
import { Card } from '../../components/ui/Card'
import { EmptyState } from '../../components/ui/EmptyState'
import { useTheme } from '../../hooks/useTheme'
import { fetchEmployeeDashboardData, fetchEmployeeSaleProducts, type EmployeeProductOption } from '../../lib/employee/employeeApi'
import { formatMoney, formatProductAvailability } from '../../lib/employee/pricing'
import { useAuthStore } from '../../store/authStore'
import { handleError } from '../../utils/errorHandler'
import { DashboardScaffold } from '../shared/DashboardScaffold'

/**
 * Renders employee stock levels.
 *
 * @returns Employee stock screen.
 */
export default function EmployeeStockScreen() {
  const { theme } = useTheme()
  const user = useAuthStore((state) => state.user)
  const [products, setProducts] = useState<EmployeeProductOption[]>([])
  const [currency, setCurrency] = useState('KES')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadProducts = useCallback(async () => {
    if (!user?.branchId) {
      setError('Your branch assignment is missing.')
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)

    try {
      const [dashboardData, saleProducts] = await Promise.all([
        fetchEmployeeDashboardData(user.businessId, user.branchId, user.id),
        fetchEmployeeSaleProducts(user.branchId),
      ])
      setCurrency(dashboardData.currency)
      setProducts(saleProducts)
    } catch (loadError) {
      const handled = handleError('EmployeeStock.loadProducts', loadError)
      setError(handled.message)
    } finally {
      setLoading(false)
    }
  }, [user?.branchId, user?.businessId, user?.id])

  useEffect(() => {
    void loadProducts()
  }, [loadProducts])

  const normalCount = useMemo(() => products.filter((product) => product.stockSource === 'normal').length, [products])
  const damagedCount = useMemo(() => products.filter((product) => product.stockSource === 'recovery').length, [products])

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
      {products.length === 0 ? (
        <EmptyState heading="No sellable stock" subtitle="Products appear here when normal or damaged stock is available." />
      ) : (
        <FlatList
          data={products}
          keyExtractor={(item) => item.optionId}
          scrollEnabled={false}
          renderItem={({ item }) => (
            <Card style={styles.row}>
              <View style={styles.rowHeader}>
                <View style={styles.titleGroup}>
                  {item.stockSource === 'recovery' ? (
                    <PackageX color={theme.colors.accent} size={18} />
                  ) : (
                    <Boxes color={theme.colors.primary} size={18} />
                  )}
                  <Text style={[styles.title, { color: theme.colors.textPrimary }]}>{item.name}</Text>
                </View>
                <Badge label={item.stockSource === 'recovery' ? 'Damaged' : 'Normal'} variant={item.stockSource === 'recovery' ? 'warning' : 'info'} />
              </View>
              <Text style={[styles.subtitle, { color: theme.colors.textMuted }]}>{item.sku || 'No SKU'}</Text>
              <View style={styles.stockLine}>
                <Text style={[styles.quantity, { color: theme.colors.primary }]}>{formatProductAvailability(item)}</Text>
                <Text style={[styles.price, { color: theme.colors.textMuted }]}>Price {formatMoney(item.sellingPrice, currency)}</Text>
              </View>
            </Card>
          )}
        />
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
