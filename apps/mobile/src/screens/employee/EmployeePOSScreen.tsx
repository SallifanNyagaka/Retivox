/**
 * Employee POS screen for Retivox mobile.
 *
 * Mirrors the web employee sale form with normal/damaged stock tabs, UOM-aware
 * quantities, discount checks, payment references, and server-side RPC submit.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { PackageX, RefreshCcw, ShoppingCart } from 'lucide-react-native'
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
  fetchEmployeeDashboardData,
  fetchEmployeeSaleProducts,
  recordEmployeeTransaction,
  type EmployeeProductOption,
  type PaymentMethod,
} from '../../lib/employee/employeeApi'
import {
  formatMoney,
  formatProductAvailability,
  getBaseQuantity,
  getDefaultSaleUom,
  resolvePreviewPricing,
} from '../../lib/employee/pricing'
import { useAuthStore } from '../../store/authStore'
import { useUiStore } from '../../store/uiStore'
import { handleError } from '../../utils/errorHandler'

type SaleTab = 'normal' | 'damaged'

type LoadOptions = {
  silent?: boolean
}

type CartItem = {
  id: string
  product: EmployeeProductOption
  uomId: string
  quantity: string
}

/**
 * Returns a compact product pricing label.
 *
 * @param product - Product option.
 * @returns Pricing label.
 */
function getPricingLabel(product: EmployeeProductOption): string {
  if (product.stockSource === 'recovery') return 'Damaged stock'
  if (product.pricingMethod === 'manual_quantity') return 'Manual prices'
  if (product.pricingMethod === 'assisted_pack') return 'Pack pricing'
  return 'Fixed price'
}

/**
 * Renders the employee POS screen.
 *
 * @returns Employee POS screen.
 */
export default function EmployeePOSScreen() {
  const { theme } = useTheme()
  const user = useAuthStore((state) => state.user)
  const setUser = useAuthStore((state) => state.setUser)
  const { toast, showToast, hideToast } = useUiStore()
  const [products, setProducts] = useState<EmployeeProductOption[]>([])
  const [currency, setCurrency] = useState('KES')
  const [activeTab, setActiveTab] = useState<SaleTab>('normal')
  const [cart, setCart] = useState<CartItem[]>([])
  const [discountAmount, setDiscountAmount] = useState('0')
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('mpesa_manual')
  const [mpesaRefCode, setMpesaRefCode] = useState('')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadProducts = useCallback(async (options: LoadOptions = {}) => {
    if (!options.silent) {
      setLoading(true)
    }
    setError(null)

    try {
      const assignedUser = await resolveEmployeeBranchAssignment(user, setUser)
      const [dashboardData, saleProducts] = await Promise.all([
        fetchEmployeeDashboardData(assignedUser.businessId, assignedUser.branchId, assignedUser.id),
        fetchEmployeeSaleProducts(assignedUser.branchId),
      ])
      setCurrency(dashboardData.currency)
      setProducts(saleProducts)
    } catch (loadError) {
      const handled = handleError('EmployeePOS.loadProducts', loadError)
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
  useOnlineAutoRefresh(() => loadProducts({ silent: true }), { label: 'EmployeePOS.autoRefresh' })

  const normalProducts = useMemo(() => products.filter((product) => product.stockSource === 'normal'), [products])
  const damagedProducts = useMemo(
    () => products.filter((product) => product.stockSource === 'recovery' && product.recoveryItemId && product.baseQuantityOnHand > product.baseQuantityReserved),
    [products],
  )
  const visibleProducts = activeTab === 'damaged' ? damagedProducts : normalProducts
  const lineSummaries = cart.map((item) => {
    const selectedUom = item.product.uomOptions.find((uom) => uom.id === item.uomId) ?? getDefaultSaleUom(item.product)
    const quantity = Number(item.quantity)
    const baseQuantity = getBaseQuantity(quantity, selectedUom)
    const pricing = baseQuantity ? resolvePreviewPricing(item.product, baseQuantity, selectedUom?.id ?? null) : null
    const availableBaseQuantity = item.product.baseQuantityOnHand - item.product.baseQuantityReserved

    return {
      item,
      selectedUom,
      quantity,
      baseQuantity,
      pricing,
      availableBaseQuantity,
    }
  })
  const requestedByOption = new Map<string, number>()

  lineSummaries.forEach((summary) => {
    if (!summary.baseQuantity) return
    requestedByOption.set(summary.item.product.optionId, (requestedByOption.get(summary.item.product.optionId) ?? 0) + summary.baseQuantity)
  })

  const subtotal = lineSummaries.reduce((sum, summary) => sum + (summary.pricing?.lineTotal ?? 0), 0)
  const maxDiscount = lineSummaries.reduce((sum, summary) => sum + (summary.pricing?.maxDiscountAmount ?? 0), 0)
  const discountValue = Number(discountAmount || 0)
  const discountInvalid = !Number.isFinite(discountValue) || discountValue < 0 || discountValue > maxDiscount
  const invalidLine = lineSummaries.some((summary) => !summary.selectedUom || !summary.baseQuantity || !summary.pricing)
  const overStockLine = lineSummaries.some((summary) => {
    const requestedBaseQuantity = requestedByOption.get(summary.item.product.optionId) ?? 0
    return requestedBaseQuantity > summary.availableBaseQuantity
  })
  const total = Math.max(0, subtotal - (discountInvalid ? 0 : discountValue))
  const canSubmit = cart.length > 0 && !invalidLine && !overStockLine && !discountInvalid && !submitting

  /**
   * Adds a product to the sale cart.
   *
   * @param product - Product option.
   * @returns Void.
   */
  function addProduct(product: EmployeeProductOption) {
    const defaultUom = getDefaultSaleUom(product)

    if (!defaultUom) {
      showToast('This product has no sale unit configured.', 'error')
      return
    }

    setCart((current) => {
      const existing = current.find((item) => item.product.optionId === product.optionId && item.uomId === defaultUom.id)

      if (existing) {
        return current.map((item) =>
          item.id === existing.id ? { ...item, quantity: String(Number(item.quantity || 0) + 1) } : item,
        )
      }

      return [...current, { id: `${product.optionId}-${Date.now()}`, product, uomId: defaultUom.id, quantity: '1' }]
    })
  }

  /**
   * Updates a cart row.
   *
   * @param id - Cart row id.
   * @param patch - Partial row patch.
   * @returns Void.
   */
  function updateCartItem(id: string, patch: Partial<Pick<CartItem, 'quantity' | 'uomId'>>) {
    setCart((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  }

  /**
   * Submits the sale to Supabase.
   *
   * @returns Promise that resolves after submit.
   */
  async function submitSale(): Promise<void> {
    if (!canSubmit) {
      showToast('Check quantities, prices, stock, and discount before submitting.', 'warning')
      return
    }

    if (paymentMethod === 'mpesa_manual' && mpesaRefCode.trim().length < 5) {
      showToast('Enter a valid M-Pesa reference code.', 'warning')
      return
    }

    setSubmitting(true)

    try {
      await recordEmployeeTransaction({
        items: cart.map((item) => ({
          productId: item.product.productId,
          uomId: item.uomId,
          quantity: Number(item.quantity),
          recoveryItemId: item.product.recoveryItemId,
        })),
        paymentMethod,
        discountAmount: discountValue,
        customerName: customerName.trim(),
        customerPhone: customerPhone.trim(),
        mpesaRefCode: mpesaRefCode.trim(),
      })

      setCart([])
      setDiscountAmount('0')
      setCustomerName('')
      setCustomerPhone('')
      setMpesaRefCode('')
      showToast('Transaction recorded successfully.', 'success')
      await loadProducts()
    } catch (submitError) {
      const handled = handleError('EmployeePOS.submitSale', submitError)
      showToast(handled.message, 'error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <SafeAreaView edges={['bottom']} style={[styles.safeArea, { backgroundColor: theme.colors.background }]}>
      <ScreenHeader
        title="Record Sale"
        subtitle={activeTab === 'damaged' ? 'Owner-approved damaged stock' : user?.branchName ?? 'Assigned branch'}
        rightAction={{ label: 'Refresh', icon: <RefreshCcw color={theme.colors.primary} size={16} />, onPress: loadProducts }}
      />
      {toast ? <Toast message={toast.message} type={toast.type} visible={toast.visible} onDismiss={hideToast} /> : null}
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.keyboard}>
        {loading ? (
          <LoadingSpinner label="Loading sale products..." />
        ) : error ? (
          <View style={styles.content}>
            <EmptyState heading="Unable to load products" subtitle={error} actionLabel="Retry" onActionPress={loadProducts} />
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <View style={styles.tabs}>
              <Button label="Normal stock" variant={activeTab === 'normal' ? 'primary' : 'outline'} onPress={() => setActiveTab('normal')} />
              {damagedProducts.length > 0 ? (
                <Button label="Damaged stock" variant={activeTab === 'damaged' ? 'primary' : 'outline'} onPress={() => setActiveTab('damaged')} />
              ) : null}
            </View>

            {activeTab === 'damaged' ? (
              <Card style={styles.notice}>
                <View style={styles.noticeHeader}>
                  <PackageX color={theme.colors.accent} size={20} />
                  <Text style={[styles.noticeTitle, { color: theme.colors.textPrimary }]}>Damaged stock sale</Text>
                </View>
                <Text style={[styles.noticeText, { color: theme.colors.textMuted }]}>
                  These products use the owner-approved recovery price. Discounts are not applied to damaged stock.
                </Text>
              </Card>
            ) : null}

            {visibleProducts.length === 0 ? (
              <EmptyState heading={`No ${activeTab === 'damaged' ? 'damaged' : 'normal'} stock`} subtitle="Pull refresh or check again after stock is approved." />
            ) : (
              <View style={styles.productGrid}>
                {visibleProducts.map((product) => (
                  <Card key={product.optionId} style={styles.productCard} onPress={() => addProduct(product)}>
                    <View style={styles.productHeader}>
                      <Text style={[styles.productName, { color: theme.colors.textPrimary }]} numberOfLines={2}>
                        {product.name}
                      </Text>
                      <Badge label={getPricingLabel(product)} variant={product.stockSource === 'recovery' ? 'warning' : 'info'} />
                    </View>
                    <Text style={[styles.productMeta, { color: theme.colors.textMuted }]}>{product.sku || 'No SKU'}</Text>
                    <Text style={[styles.productPrice, { color: theme.colors.primary }]}>{formatMoney(product.sellingPrice, currency)}</Text>
                    <Text style={[styles.productMeta, { color: theme.colors.textMuted }]}>Available: {formatProductAvailability(product)}</Text>
                  </Card>
                ))}
              </View>
            )}

            <Card style={styles.cartCard}>
              <View style={styles.noticeHeader}>
                <ShoppingCart color={theme.colors.primary} size={20} />
                <Text style={[styles.cartTitle, { color: theme.colors.textPrimary }]}>Cart</Text>
              </View>

              {cart.length === 0 ? (
                <Text style={[styles.emptyCart, { color: theme.colors.textMuted }]}>Tap a product above to add it to the cart.</Text>
              ) : (
                <View style={styles.cartRows}>
                  {lineSummaries.map((summary) => {
                    const requestedBaseQuantity = requestedByOption.get(summary.item.product.optionId) ?? 0
                    const lineOverStock = requestedBaseQuantity > summary.availableBaseQuantity

                    return (
                      <View key={summary.item.id} style={[styles.cartRow, { borderColor: theme.colors.border }]}>
                        <View style={styles.rowBetween}>
                          <Text style={[styles.cartProductName, { color: theme.colors.textPrimary }]}>{summary.item.product.name}</Text>
                          <Pressable onPress={() => setCart((current) => current.filter((item) => item.id !== summary.item.id))}>
                            <Text style={[styles.removeText, { color: theme.colors.danger }]}>Remove</Text>
                          </Pressable>
                        </View>

                        <View style={styles.uomChips}>
                          {summary.item.product.uomOptions.map((uom) => (
                            <Pressable
                              key={`${summary.item.id}-${uom.id}`}
                              onPress={() => updateCartItem(summary.item.id, { uomId: uom.id })}
                              style={[
                                styles.uomChip,
                                {
                                  backgroundColor: summary.item.uomId === uom.id ? theme.colors.primaryLight : theme.colors.background,
                                  borderColor: summary.item.uomId === uom.id ? theme.colors.primary : theme.colors.border,
                                },
                              ]}
                            >
                              <Text style={[styles.uomText, { color: summary.item.uomId === uom.id ? theme.colors.primary : theme.colors.textMuted }]}>
                                {uom.name}
                              </Text>
                            </Pressable>
                          ))}
                        </View>

                        <Input
                          keyboardType="decimal-pad"
                          label="Quantity"
                          onChangeText={(value) => updateCartItem(summary.item.id, { quantity: value })}
                          value={summary.item.quantity}
                        />
                        <Text style={[styles.lineHint, { color: lineOverStock || !summary.pricing ? theme.colors.danger : theme.colors.textMuted }]}>
                          {summary.pricing
                            ? `Line total ${formatMoney(summary.pricing.lineTotal, currency)}`
                            : 'This quantity has no approved price.'}
                          {lineOverStock ? ' Not enough stock.' : ''}
                        </Text>
                      </View>
                    )
                  })}
                </View>
              )}

              <View style={styles.formGrid}>
                <Input label="Customer name optional" value={customerName} onChangeText={setCustomerName} />
                <Input label="Customer phone optional" value={customerPhone} onChangeText={setCustomerPhone} keyboardType="phone-pad" />
                <Input label="Discount amount" value={discountAmount} onChangeText={setDiscountAmount} keyboardType="decimal-pad" />
              </View>

              <View style={styles.tabs}>
                <Button label="M-Pesa" variant={paymentMethod === 'mpesa_manual' ? 'primary' : 'outline'} onPress={() => setPaymentMethod('mpesa_manual')} />
                <Button label="Cash" variant={paymentMethod === 'cash' ? 'primary' : 'outline'} onPress={() => setPaymentMethod('cash')} />
              </View>

              {paymentMethod === 'mpesa_manual' ? (
                <Input label="M-Pesa reference code" value={mpesaRefCode} onChangeText={setMpesaRefCode} autoCapitalize="characters" />
              ) : (
                <Text style={[styles.cashNote, { color: theme.colors.textMuted }]}>
                  Cash sales are recorded now. The deposit/reference code is added later during cash reconciliation.
                </Text>
              )}

              <View style={[styles.summary, { borderColor: overStockLine || invalidLine || discountInvalid ? theme.colors.danger : theme.colors.border }]}>
                <Text style={[styles.summaryText, { color: theme.colors.textMuted }]}>Subtotal: {formatMoney(subtotal, currency)}</Text>
                <Text style={[styles.summaryText, { color: discountInvalid ? theme.colors.danger : theme.colors.textMuted }]}>
                  Max discount: {formatMoney(maxDiscount, currency)}
                </Text>
                <Text style={[styles.summaryTotal, { color: theme.colors.textPrimary }]}>Customer pays: {formatMoney(total, currency)}</Text>
              </View>

              <Button label="Record transaction" loading={submitting} disabled={!canSubmit} onPress={() => void submitSale()} fullWidth />
            </Card>
          </ScrollView>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  cartCard: {
    gap: 14,
  },
  cartProductName: {
    flex: 1,
    fontSize: 15,
    fontWeight: '800',
  },
  cartRow: {
    borderBottomWidth: 1,
    gap: 10,
    paddingBottom: 14,
  },
  cartRows: {
    gap: 14,
  },
  cartTitle: {
    fontSize: 18,
    fontWeight: '800',
  },
  cashNote: {
    borderRadius: 12,
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 20,
  },
  content: {
    gap: 14,
    padding: 16,
    paddingBottom: 120,
  },
  emptyCart: {
    fontSize: 13,
    lineHeight: 20,
  },
  formGrid: {
    gap: 12,
  },
  keyboard: {
    flex: 1,
  },
  lineHint: {
    fontSize: 12,
    fontWeight: '700',
  },
  notice: {
    gap: 8,
  },
  noticeHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  noticeText: {
    fontSize: 13,
    lineHeight: 20,
  },
  noticeTitle: {
    fontSize: 15,
    fontWeight: '800',
  },
  productCard: {
    gap: 6,
  },
  productGrid: {
    gap: 10,
  },
  productHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'space-between',
  },
  productMeta: {
    fontSize: 12,
  },
  productName: {
    flex: 1,
    fontSize: 15,
    fontWeight: '800',
  },
  productPrice: {
    fontSize: 16,
    fontWeight: '900',
  },
  removeText: {
    fontSize: 12,
    fontWeight: '800',
  },
  rowBetween: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'space-between',
  },
  safeArea: {
    flex: 1,
  },
  summary: {
    borderRadius: 12,
    borderWidth: 1,
    gap: 5,
    padding: 12,
  },
  summaryText: {
    fontSize: 13,
  },
  summaryTotal: {
    fontSize: 18,
    fontWeight: '900',
  },
  tabs: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  uomChip: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  uomChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  uomText: {
    fontSize: 12,
    fontWeight: '700',
  },
})
