/**
 * Employee damaged stock screen for Retivox mobile.
 *
 * Lets employees report breakage, spoilage, missing stock, and markdown damage
 * from their assigned branch using the same owner-approval workflow as web.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { PackageX, RefreshCcw } from 'lucide-react-native'
import { ScreenHeader } from '../../components/layout/ScreenHeader'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { EmptyState } from '../../components/ui/EmptyState'
import { Input } from '../../components/ui/Input'
import { LoadingSpinner } from '../../components/ui/LoadingSpinner'
import { Toast } from '../../components/ui/Toast'
import { useOnlineAutoRefresh } from '../../hooks/useOnlineAutoRefresh'
import { useTheme } from '../../hooks/useTheme'
import { resolveEmployeeBranchAssignment } from '../../lib/employee/branchAssignment'
import {
  fetchEmployeeDamageReportProducts,
  reportEmployeeDamagedStock,
  type DamageReportProductOption,
  type LossType,
  type UomOption,
} from '../../lib/employee/employeeApi'
import { formatQuantity } from '../../lib/employee/pricing'
import { useAuthStore } from '../../store/authStore'
import { useUiStore } from '../../store/uiStore'
import { handleError } from '../../utils/errorHandler'

const lossTypes: Array<{ label: string; value: LossType }> = [
  { label: 'Breakage', value: 'breakage' },
  { label: 'Spoilage', value: 'spoilage' },
  { label: 'Theft or missing', value: 'theft' },
  { label: 'Damaged but sellable', value: 'markdown_damage' },
  { label: 'Other', value: 'other' },
]

type LoadOptions = {
  silent?: boolean
}

/**
 * Finds the individual/base unit for damage reporting.
 *
 * @param product - Product option.
 * @returns UOM option or null.
 */
function getDefaultDamageUom(product: DamageReportProductOption | null): UomOption | null {
  if (!product) return null

  return product.uomOptions.find((uom) => uom.isBaseUom || uom.isBaseUnit || uom.conversionFactor === 1) ??
    product.uomOptions[0] ??
    null
}

/**
 * Renders damaged stock reporting.
 *
 * @returns Damage report screen.
 */
export default function EmployeeDamagedStockScreen() {
  const { theme } = useTheme()
  const user = useAuthStore((state) => state.user)
  const setUser = useAuthStore((state) => state.setUser)
  const { toast, showToast, hideToast } = useUiStore()
  const [products, setProducts] = useState<DamageReportProductOption[]>([])
  const [selectedProductId, setSelectedProductId] = useState('')
  const [quantity, setQuantity] = useState('')
  const [lossType, setLossType] = useState<LossType>('breakage')
  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectedProduct = useMemo(
    () => products.find((product) => product.productId === selectedProductId) ?? products[0] ?? null,
    [products, selectedProductId],
  )
  const selectedUom = getDefaultDamageUom(selectedProduct)
  const quantityValue = Number(quantity || 0)
  const baseQuantity = selectedUom && quantityValue > 0 ? quantityValue * selectedUom.conversionFactor : 0
  const exceedsAvailable = selectedProduct ? baseQuantity > selectedProduct.baseQuantityAvailable : false
  const canSubmit = Boolean(selectedProduct && selectedUom && quantityValue > 0 && reason.trim() && !exceedsAvailable && !submitting)

  const loadProducts = useCallback(async (options: LoadOptions = {}) => {
    if (!options.silent) {
      setLoading(true)
    }
    setError(null)

    try {
      const assignedUser = await resolveEmployeeBranchAssignment(user, setUser)
      const nextProducts = await fetchEmployeeDamageReportProducts(assignedUser.branchId)
      setProducts(nextProducts)
      setSelectedProductId((current) => current || nextProducts[0]?.productId || '')
    } catch (loadError) {
      const handled = handleError('EmployeeDamagedStock.loadProducts', loadError)
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
  useOnlineAutoRefresh(() => loadProducts({ silent: true }), { label: 'EmployeeDamagedStock.autoRefresh' })

  /**
   * Submits a damage report.
   *
   * @returns Promise that resolves after submit.
   */
  async function submitReport(): Promise<void> {
    if (!selectedProduct || !selectedUom || !canSubmit) {
      showToast('Check product, quantity, and reason before submitting.', 'warning')
      return
    }

    setSubmitting(true)

    try {
      await reportEmployeeDamagedStock({
        productId: selectedProduct.productId,
        uomId: selectedUom.id,
        quantity: quantityValue,
        lossType,
        reason: reason.trim(),
      })

      setQuantity('')
      setReason('')
      showToast('Damage report submitted for owner approval.', 'success')
      await loadProducts()
    } catch (submitError) {
      const handled = handleError('EmployeeDamagedStock.submitReport', submitError)
      showToast(handled.message, 'error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <SafeAreaView edges={['bottom']} style={[styles.safeArea, { backgroundColor: theme.colors.background }]}>
      <ScreenHeader
        title="Report Damaged Stock"
        subtitle={user?.branchName ?? 'Assigned branch'}
        rightAction={{ label: 'Refresh', icon: <RefreshCcw color={theme.colors.primary} size={16} />, onPress: loadProducts }}
      />
      {toast ? <Toast message={toast.message} type={toast.type} visible={toast.visible} onDismiss={hideToast} /> : null}
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.keyboard}>
        {loading ? (
          <LoadingSpinner label="Loading stock..." />
        ) : error ? (
          <View style={styles.content}>
            <EmptyState heading="Unable to load damaged-stock form" subtitle={error} actionLabel="Retry" onActionPress={loadProducts} />
          </View>
        ) : products.length === 0 ? (
          <View style={styles.content}>
            <EmptyState heading="No stocked products" subtitle="There are no available products for damage reporting at your branch." />
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <Card style={styles.hero}>
              <View style={styles.heroHeader}>
                <PackageX color={theme.colors.accent} size={24} />
                <Text style={[styles.heroTitle, { color: theme.colors.textPrimary }]}>Pending owner approval</Text>
              </View>
              <Text style={[styles.heroText, { color: theme.colors.textMuted }]}>
                Reports do not deduct stock until the owner approves them. If approved, the owner can set a recovery sale price.
              </Text>
            </Card>

            <View style={styles.productList}>
              {products.map((product) => (
                <Card
                  key={product.productId}
                  onPress={() => setSelectedProductId(product.productId)}
                  style={[
                    styles.productCard,
                    {
                      borderColor: selectedProduct?.productId === product.productId ? theme.colors.primary : theme.colors.border,
                    },
                  ]}
                >
                  <View style={styles.productHeader}>
                    <Text style={[styles.productName, { color: theme.colors.textPrimary }]}>{product.name}</Text>
                    {selectedProduct?.productId === product.productId ? <Badge label="Selected" variant="success" /> : null}
                  </View>
                  <Text style={[styles.productMeta, { color: theme.colors.textMuted }]}>{product.sku || 'No SKU'}</Text>
                  <Text style={[styles.available, { color: theme.colors.primary }]}>
                    Available {formatQuantity(product.baseQuantityAvailable)} {getDefaultDamageUom(product)?.name ?? 'units'}
                  </Text>
                </Card>
              ))}
            </View>

            <Card style={styles.form}>
              <Input
                label={`Quantity affected${selectedUom ? ` (${selectedUom.name})` : ''}`}
                value={quantity}
                onChangeText={setQuantity}
                keyboardType="decimal-pad"
              />

              <View style={styles.lossChips}>
                {lossTypes.map((type) => (
                  <Pressable
                    key={type.value}
                    onPress={() => setLossType(type.value)}
                    style={[
                      styles.lossChip,
                      {
                        backgroundColor: lossType === type.value ? theme.colors.primaryLight : theme.colors.background,
                        borderColor: lossType === type.value ? theme.colors.primary : theme.colors.border,
                      },
                    ]}
                  >
                    <Text style={[styles.lossChipText, { color: lossType === type.value ? theme.colors.primary : theme.colors.textMuted }]}>
                      {type.label}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <Input
                label="What happened?"
                value={reason}
                onChangeText={setReason}
                placeholder="e.g. 12 eggs cracked during unloading"
                maxLength={240}
              />

              <View style={[styles.preview, { borderColor: exceedsAvailable ? theme.colors.danger : theme.colors.border }]}>
                <Text style={[styles.previewText, { color: theme.colors.textMuted }]}>
                  Reported damage: {formatQuantity(quantityValue)} {selectedUom?.name ?? 'units'} = {formatQuantity(baseQuantity)} {selectedUom?.name ?? 'base units'}.
                </Text>
                {selectedProduct ? (
                  <Text style={[styles.previewText, { color: exceedsAvailable ? theme.colors.danger : theme.colors.textMuted }]}>
                    Available: {formatQuantity(selectedProduct.baseQuantityAvailable)} {selectedUom?.name ?? 'units'}.
                  </Text>
                ) : null}
              </View>

              <Button label="Submit damage report" loading={submitting} disabled={!canSubmit} onPress={() => void submitReport()} fullWidth />
            </Card>
          </ScrollView>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  available: {
    fontSize: 13,
    fontWeight: '800',
  },
  content: {
    gap: 14,
    padding: 16,
    paddingBottom: 120,
  },
  form: {
    gap: 14,
  },
  hero: {
    gap: 8,
  },
  heroHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  heroText: {
    fontSize: 13,
    lineHeight: 20,
  },
  heroTitle: {
    fontSize: 17,
    fontWeight: '900',
  },
  keyboard: {
    flex: 1,
  },
  lossChip: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  lossChipText: {
    fontSize: 12,
    fontWeight: '800',
  },
  lossChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  preview: {
    borderRadius: 12,
    borderWidth: 1,
    gap: 4,
    padding: 12,
  },
  previewText: {
    fontSize: 12,
    lineHeight: 18,
  },
  productCard: {
    gap: 5,
  },
  productHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'space-between',
  },
  productList: {
    gap: 10,
  },
  productMeta: {
    fontSize: 12,
  },
  productName: {
    flex: 1,
    fontSize: 15,
    fontWeight: '800',
  },
  safeArea: {
    flex: 1,
  },
})
