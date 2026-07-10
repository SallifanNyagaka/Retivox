'use server'
/**
 * Server actions for the owner transactions dashboard.
 *
 * These actions verify or reject pending payments, void transactions, notify
 * employees, and record immutable audit log entries for each write operation.
 */

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { GlobalRole } from '@smartretail/shared'
import { requireRole } from '../../../../lib/auth/helpers'
import { assertBranchAccess } from '../../../../lib/auth/branchAccess'
import { createClient } from '../../../../lib/supabase/server'
import logger from '../../../../lib/logger'
import type { FormState, TransactionLineItemProduct, TransactionLineItemUOM, TransactionLineItemView } from './types'

/**
 * Validates payment verification requests.
 */
const verifyPaymentSchema = z.object({
  paymentId: z.string().uuid(),
  action: z.enum(['approve', 'reject']),
})

/**
 * Validates transaction void requests.
 */
const voidTransactionSchema = z.object({
  transactionId: z.string().uuid(),
})

/**
 * Validates transaction detail requests.
 */
const transactionDetailsSchema = z.object({
  transactionId: z.string().uuid(),
})

/**
 * Raw line item row returned from Supabase before join normalization.
 */
type RawTransactionLineItemRow = {
  id: string
  product_id: string
  recovery_item_id: string | null
  quantity: number
  quantity_in_uom: string | number | null
  base_quantity: string | number | null
  unit_price_at_sale: number
  line_total: number
  stock_status: string
  products: TransactionLineItemProduct | TransactionLineItemProduct[] | null
  units_of_measure: TransactionLineItemUOM | TransactionLineItemUOM[] | null
}

type ProductBaseUomRow = {
  product_id: string
  units_of_measure: { name: string } | { name: string }[] | null
}

/**
 * Result returned by lazy transaction line-item loading.
 */
export type TransactionLineItemsState = {
  success: boolean
  error: string | null
  items: TransactionLineItemView[]
}

/**
 * Safely reads a trimmed string value from FormData.
 */
function getString(formData: FormData, key: string): string {
  const value = formData.get(key)
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Approves or rejects a pending payment verification request.
 */
export async function verifyPayment(_prevState: FormState, formData: FormData): Promise<FormState> {
  const profile = await requireRole([GlobalRole.Owner])
  const paymentId = getString(formData, 'paymentId')
  const requestedAction = getString(formData, 'action')
  const validation = verifyPaymentSchema.safeParse({ paymentId, action: requestedAction })

  if (!validation.success) {
    return { success: false, error: validation.error.errors[0]?.message ?? 'Invalid payment action' }
  }

  const businessId = profile.business_id

  if (!businessId) {
    logger.error('verifyPayment: missing business id', { userId: profile.id })
    return { success: false, error: 'Business context missing' }
  }

  try {
    const supabase = await createClient()
    const { error } = await supabase.rpc('owner_verify_payment', {
      p_payment_id: validation.data.paymentId,
      p_action: validation.data.action,
    })

    if (error) {
      logger.error('verifyPayment: RPC failed', { businessId, paymentId, action: validation.data.action, error })
      return { success: false, error: error.message ?? 'Unable to update payment' }
    }

    revalidatePath('/dashboard/owner/transactions')
    revalidatePath('/dashboard/owner/finances')
    logger.info('Payment verification updated', {
      businessId,
      paymentId,
      action: validation.data.action,
      actor: profile.id,
    })
    return { success: true, error: null }
  } catch (error: unknown) {
    logger.error('verifyPayment: unexpected error', { businessId, paymentId, error })
    return { success: false, error: error instanceof Error ? error.message : 'Server error' }
  }
}

/**
 * Voids a transaction after explicit owner confirmation.
 */
export async function voidTransaction(_prevState: FormState, formData: FormData): Promise<FormState> {
  const profile = await requireRole([GlobalRole.Owner])
  const transactionId = getString(formData, 'transactionId')
  const validation = voidTransactionSchema.safeParse({ transactionId })

  if (!validation.success) {
    return { success: false, error: validation.error.errors[0]?.message ?? 'Invalid transaction' }
  }

  const businessId = profile.business_id

  if (!businessId) {
    logger.error('voidTransaction: missing business id', { userId: profile.id })
    return { success: false, error: 'Business context missing' }
  }

  try {
    const supabase = await createClient()
    const { error } = await supabase.rpc('owner_void_transaction', {
      p_transaction_id: validation.data.transactionId,
    })

    if (error) {
      logger.error('voidTransaction: RPC failed', { businessId, transactionId: validation.data.transactionId, error })
      return { success: false, error: error.message ?? 'Unable to void transaction' }
    }

    revalidatePath('/dashboard/owner/transactions')
    revalidatePath('/dashboard/owner/finances')
    logger.info('Transaction voided', { businessId, transactionId: validation.data.transactionId, actor: profile.id })
    return { success: true, error: null }
  } catch (error: unknown) {
    logger.error('voidTransaction: unexpected error', { businessId, transactionId, error })
    return { success: false, error: error instanceof Error ? error.message : 'Server error' }
  }
}

/**
 * Resolves a product join whether Supabase returns an object or array.
 */
function getJoinedProduct(products: TransactionLineItemProduct | TransactionLineItemProduct[] | null) {
  if (!products) {
    return null
  }

  return Array.isArray(products) ? products[0] ?? null : products
}

/**
 * Resolves a UOM join whether Supabase returns an object or array.
 */
function getJoinedUOM(units: TransactionLineItemUOM | TransactionLineItemUOM[] | null) {
  if (!units) {
    return null
  }

  return Array.isArray(units) ? units[0] ?? null : units
}

function getJoinedBaseUOM(units: { name: string } | { name: string }[] | null) {
  if (!units) {
    return null
  }

  return Array.isArray(units) ? units[0] ?? null : units
}

/**
 * Loads transaction line items only when a user opens the details modal.
 */
export async function getTransactionLineItems(transactionId: string): Promise<TransactionLineItemsState> {
  const profile = await requireRole([GlobalRole.Owner, GlobalRole.Admin])
  const businessId = profile.business_id

  if (!businessId) {
    logger.error('getTransactionLineItems: missing business id', { userId: profile.id })
    return { success: false, error: 'Business context missing', items: [] }
  }

  const validation = transactionDetailsSchema.safeParse({ transactionId })

  if (!validation.success) {
    return { success: false, error: validation.error.errors[0]?.message ?? 'Invalid transaction', items: [] }
  }

  try {
    const supabase = await createClient()
    const { data: transactionData, error: transactionError } = await supabase
      .from('transactions')
      .select('id, branch_id')
      .eq('business_id', businessId)
      .eq('id', validation.data.transactionId)
      .maybeSingle()

    if (transactionError) {
      logger.error('getTransactionLineItems: transaction lookup failed', {
        businessId,
        transactionId: validation.data.transactionId,
        error: transactionError,
      })
      return { success: false, error: transactionError.message ?? 'Unable to load transaction', items: [] }
    }

    const transaction = transactionData as { id: string; branch_id: string | null } | null

    if (!transaction?.branch_id) {
      return { success: false, error: 'Transaction branch missing', items: [] }
    }

    await assertBranchAccess(profile.id, transaction.branch_id, 'admin', 'view_transaction_line_items')

    const { data, error } = await supabase
      .from('transaction_items')
      .select('id, product_id, recovery_item_id, quantity, quantity_in_uom, base_quantity, unit_price_at_sale, line_total, stock_status, products!inner(name, sku), units_of_measure(name, abbreviation, conversion_factor)')
      .eq('business_id', businessId)
      .eq('transaction_id', validation.data.transactionId)
      .order('id', { ascending: true })

    if (error) {
      logger.error('getTransactionLineItems: item lookup failed', {
        businessId,
        transactionId: validation.data.transactionId,
        error,
      })
      return { success: false, error: error.message ?? 'Unable to load line items', items: [] }
    }

    const rows = (data ?? []) as RawTransactionLineItemRow[]
    const productIds = Array.from(new Set(rows.map((item) => item.product_id).filter(Boolean)))
    const baseUomResponse =
      productIds.length > 0
        ? await supabase
            .from('product_uom_links')
            .select('product_id, units_of_measure!inner(name)')
            .eq('business_id', businessId)
            .eq('is_base_uom', true)
            .in('product_id', productIds)
        : { data: [], error: null }

    if (baseUomResponse.error) {
      logger.error('getTransactionLineItems: base UOM lookup failed', {
        businessId,
        transactionId: validation.data.transactionId,
        error: baseUomResponse.error,
      })
      return { success: false, error: baseUomResponse.error.message ?? 'Unable to load line item units', items: [] }
    }

    const baseUomByProduct = new Map<string, string>()
    ;((baseUomResponse.data ?? []) as ProductBaseUomRow[]).forEach((row) => {
      const baseUom = getJoinedBaseUOM(row.units_of_measure)

      if (baseUom?.name) {
        baseUomByProduct.set(row.product_id, baseUom.name)
      }
    })

    const items = rows.map((item) => {
      const product = getJoinedProduct(item.products)
      const uom = getJoinedUOM(item.units_of_measure)

      return {
        id: item.id,
        productId: item.product_id,
        productName: product?.name ?? 'Unknown product',
        productSku: product?.sku ?? null,
        isRecovery: Boolean(item.recovery_item_id),
        quantity: Number(item.quantity),
        quantityInUom: item.quantity_in_uom === null ? null : Number(item.quantity_in_uom),
        baseQuantity: item.base_quantity === null ? null : Number(item.base_quantity),
        uomName: uom?.name ?? null,
        uomConversionFactor: uom?.conversion_factor === undefined ? null : Number(uom.conversion_factor),
        baseUomName: baseUomByProduct.get(item.product_id) ?? null,
        unitPriceAtSale: Number(item.unit_price_at_sale),
        lineTotal: Number(item.line_total),
        stockStatus: item.stock_status,
      }
    })

    return { success: true, error: null, items }
  } catch (error: unknown) {
    logger.error('getTransactionLineItems: unexpected error', { businessId, transactionId, error })
    return { success: false, error: error instanceof Error ? error.message : 'Server error', items: [] }
  }
}
