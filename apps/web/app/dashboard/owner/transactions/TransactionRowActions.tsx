'use client'
/**
 * Row-level actions for owner transaction management.
 *
 * This component handles transaction details, payment approval/rejection, and
 * transaction void confirmation with safe server-action transitions.
 */

import { startTransition, useEffect, useRef, useState } from 'react'
import { useActionState } from 'react'
import { useRouter } from 'next/navigation'
import Modal from '../../../../components/ui/Modal'
import Toast from '../../../../components/ui/Toast'
import LoadingOverlay from '../../../../components/ui/LoadingOverlay'
import { Badge } from '../../../../components/ui/Badge'
import { useToast } from '../../../../lib/hooks/useToast'
import { getTransactionLineItems, verifyPayment, voidTransaction } from './actions'
import type { FormState, PaymentRow, TransactionLineItemView, TransactionView } from './types'

/**
 * Props for the transaction action cluster.
 */
type Props = {
  transaction: TransactionView
  currency: string
  canManage?: boolean
}

/**
 * Formats a money value with the business currency.
 */
function formatMoney(amount: number, currency: string) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)
}

/**
 * Returns a readable label for payment methods.
 */
function getPaymentMethodLabel(method: PaymentRow['payment_method']) {
  const labels: Record<PaymentRow['payment_method'], string> = {
    mpesa_stk: 'M-Pesa STK',
    mpesa_manual: 'M-Pesa manual',
    cash: 'Cash',
    card: 'Card',
  }

  return labels[method]
}

/**
 * Returns the badge variant for a payment status.
 */
function getPaymentStatusVariant(status: PaymentRow['status']) {
  if (status === 'verified') return 'success'
  if (status === 'pending_verify') return 'warning'
  if (status === 'rejected') return 'danger'
  return 'muted'
}

/**
 * Returns a readable label for payment status.
 */
function getPaymentStatusLabel(status: PaymentRow['status']) {
  if (status === 'pending_verify') return 'Pending verify'
  return status.charAt(0).toUpperCase() + status.slice(1)
}

function formatNumber(value: number) {
  return value.toLocaleString(undefined, { maximumFractionDigits: 4 })
}

function formatLineItemQuantity(item: TransactionLineItemView) {
  const quantityInUom = item.quantityInUom ?? item.quantity
  const baseQuantity = item.baseQuantity ?? item.quantity
  const uomName = item.uomName ?? 'units'

  if (!item.uomConversionFactor || item.uomConversionFactor <= 1 || baseQuantity === quantityInUom) {
    return {
      primary: `${formatNumber(quantityInUom)} ${uomName}`,
      secondary: null,
    }
  }

  return {
    primary: `${formatNumber(quantityInUom)} ${uomName}`,
    secondary: `${formatNumber(baseQuantity)} ${item.baseUomName ?? 'base units'}`,
  }
}

function getLineItemUnitPrice(item: TransactionLineItemView) {
  const quantityInUom = item.quantityInUom ?? item.quantity

  if (!Number.isFinite(quantityInUom) || quantityInUom <= 0) {
    return item.unitPriceAtSale
  }

  return item.lineTotal / quantityInUom
}

/**
 * TransactionRowActions renders row-level controls for a single transaction.
 */
export default function TransactionRowActions({ transaction, currency, canManage = true }: Props) {
  const router = useRouter()
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [detailsPending, setDetailsPending] = useState(false)
  const [lineItems, setLineItems] = useState<TransactionLineItemView[]>([])
  const [lineItemsError, setLineItemsError] = useState<string | null>(null)
  const [verifyOpen, setVerifyOpen] = useState(false)
  const [verifyIntent, setVerifyIntent] = useState<'approve' | 'reject'>('approve')
  const [voidOpen, setVoidOpen] = useState(false)
  const { toast, toastState, dismiss } = useToast()
  const [verifyState, verifyAction, verifyPending] = useActionState<FormState, FormData>(verifyPayment, {
    success: false,
    error: null,
  })
  const [voidState, voidAction, voidPending] = useActionState<FormState, FormData>(voidTransaction, {
    success: false,
    error: null,
  })
  const previousVerifyPending = useRef(verifyPending)
  const previousVoidPending = useRef(voidPending)
  const pendingPayment = transaction.payments.find((payment) => payment.status === 'pending_verify') ?? null

  /**
   * Opens the detail modal and lazy-loads line items separately from the list query.
   */
  const openDetailsModal = () => {
    setDetailsOpen(true)

    if (lineItems.length > 0 || detailsPending) {
      return
    }

    setDetailsPending(true)
    setLineItemsError(null)
    startTransition(() => {
      void getTransactionLineItems(transaction.id)
        .then((result) => {
          if (result.success) {
            setLineItems(result.items)
          } else {
            setLineItemsError(result.error ?? 'Unable to load line items')
          }
        })
        .catch(() => {
          setLineItemsError('Unable to load line items')
        })
        .finally(() => {
          setDetailsPending(false)
        })
    })
  }

  /**
   * Handles payment approval or rejection results after the action finishes.
   */
  useEffect(() => {
    let resetTimer: ReturnType<typeof setTimeout> | null = null

    if (previousVerifyPending.current && !verifyPending) {
      if (verifyState.success) {
        toast.success(verifyIntent === 'approve' ? 'Payment approved' : 'Payment rejected')
        router.refresh()
        resetTimer = setTimeout(() => {
          setVerifyOpen(false)
        }, 0)
      } else if (verifyState.error) {
        toast.error(verifyState.error)
      }
    }

    previousVerifyPending.current = verifyPending
    return () => {
      if (resetTimer) {
        clearTimeout(resetTimer)
      }
    }
  }, [router, toast, verifyIntent, verifyPending, verifyState.error, verifyState.success])

  /**
   * Handles transaction void results after the action finishes.
   */
  useEffect(() => {
    let resetTimer: ReturnType<typeof setTimeout> | null = null

    if (previousVoidPending.current && !voidPending) {
      if (voidState.success) {
        toast.success('Transaction voided')
        router.refresh()
        resetTimer = setTimeout(() => {
          setVoidOpen(false)
        }, 0)
      } else if (voidState.error) {
        toast.error(voidState.error)
      }
    }

    previousVoidPending.current = voidPending
    return () => {
      if (resetTimer) {
        clearTimeout(resetTimer)
      }
    }
  }, [router, toast, voidPending, voidState.error, voidState.success])

  /**
   * Opens the payment verification confirmation modal.
   */
  const openVerifyModal = (intent: 'approve' | 'reject') => {
    setVerifyIntent(intent)
    setVerifyOpen(true)
  }

  /**
   * Confirms payment approval or rejection.
   */
  const onVerifyConfirm = () => {
    if (!pendingPayment) {
      toast.error('No pending payment found')
      return
    }

    const formData = new FormData()
    formData.set('paymentId', pendingPayment.id)
    formData.set('action', verifyIntent)

    startTransition(() => {
      verifyAction(formData)
    })
  }

  /**
   * Confirms transaction voiding.
   */
  const onVoidConfirm = () => {
    const formData = new FormData()
    formData.set('transactionId', transaction.id)

    startTransition(() => {
      voidAction(formData)
    })
  }

  const canVoid = transaction.status !== 'voided'

  return (
    <>
      {(verifyPending || voidPending || detailsPending) && (
        <LoadingOverlay
          message={
            detailsPending
              ? 'Loading transaction details...'
              : verifyPending
                ? `${verifyIntent === 'approve' ? 'Approving' : 'Rejecting'} payment...`
                : 'Voiding transaction...'
          }
        />
      )}
      {toastState && (
        <Toast
          message={toastState.message}
          type={toastState.type}
          duration={toastState.duration}
          onDismiss={dismiss}
        />
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-outline"
          style={{ padding: '5px 14px', borderRadius: 8, fontSize: 12 }}
          onClick={openDetailsModal}
        >
          View details
        </button>
        {canManage && pendingPayment && (
          <>
            <button
              type="button"
              className="btn-success"
              style={{ padding: '5px 14px', borderRadius: 8, fontSize: 12 }}
              onClick={() => openVerifyModal('approve')}
            >
              Approve payment
            </button>
            <button
              type="button"
              className="btn-danger"
              style={{ padding: '5px 14px', borderRadius: 8, fontSize: 12 }}
              onClick={() => openVerifyModal('reject')}
            >
              Reject payment
            </button>
          </>
        )}
        {canManage && (
          <button
            type="button"
            className={canVoid ? 'btn-danger' : 'btn-outline'}
            disabled={!canVoid}
            style={{ padding: '5px 14px', borderRadius: 8, fontSize: 12, opacity: canVoid ? 1 : 0.65 }}
            onClick={() => setVoidOpen(true)}
          >
            {canVoid ? 'Void' : 'Voided'}
          </button>
        )}
      </div>

      <Modal isOpen={detailsOpen} title="Transaction details" onClose={() => setDetailsOpen(false)}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Transaction summary section */}
          <div
            style={{
              border: '1px solid var(--color-border)',
              borderRadius: 8,
              padding: 14,
              backgroundColor: 'var(--color-background)',
            }}
          >
            <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: 0 }}>Transaction ID</p>
            <p style={{ fontSize: 13, color: 'var(--color-text-primary)', marginTop: 6, wordBreak: 'break-all' }}>
              {transaction.id}
            </p>
            <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 12 }}>
              Branch: {transaction.branch_name}
            </p>
            <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 6 }}>
              Employee: {transaction.employee_name}
            </p>
            <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 6 }}>
              Subtotal: {formatMoney(Number(transaction.subtotal), currency)}
            </p>
            <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 6 }}>
              Discount: {formatMoney(Number(transaction.discount_amount), currency)}
            </p>
            <p style={{ fontSize: 13, color: 'var(--color-text-primary)', marginTop: 6, fontWeight: 800 }}>
              Total: {formatMoney(Number(transaction.total_amount), currency)}
            </p>
          </div>

          {/* Payment details section */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)', margin: 0 }}>Payments</h3>
            {transaction.payments.length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: 0 }}>No payments recorded.</p>
            ) : (
              transaction.payments.map((payment) => (
                <div
                  key={payment.id}
                  style={{
                    border: '1px solid var(--color-border)',
                    borderRadius: 8,
                    padding: 14,
                    backgroundColor: 'var(--color-background)',
                  }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)', margin: 0 }}>
                        {getPaymentMethodLabel(payment.payment_method)}
                      </p>
                      <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 6 }}>
                        {formatMoney(Number(payment.amount), currency)}
                      </p>
                    </div>
                    <Badge variant={getPaymentStatusVariant(payment.status)}>{getPaymentStatusLabel(payment.status)}</Badge>
                  </div>
                  <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 10 }}>
                    Reference: {payment.mpesa_ref_code ?? payment.cash_deposit_code ?? payment.account_reference ?? '-'}
                  </p>
                </div>
              ))
            )}
          </div>

          {/* Lazy-loaded line-item detail section */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)', margin: 0 }}>Line items</h3>
            {lineItemsError && (
              <p style={{ fontSize: 13, color: 'var(--color-danger)', margin: 0 }}>{lineItemsError}</p>
            )}
            {!lineItemsError && lineItems.length === 0 && !detailsPending ? (
              <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: 0 }}>No line items found.</p>
            ) : (
              lineItems.map((item) => {
                const quantityDisplay = formatLineItemQuantity(item)
                const unitPrice = getLineItemUnitPrice(item)

                return (
                  <div
                    key={item.id}
                    style={{
                      border: '1px solid var(--color-border)',
                      borderRadius: 8,
                      padding: 14,
                      backgroundColor: 'var(--color-background)',
                    }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)', margin: 0 }}>
                          {item.isRecovery ? `Damaged: ${item.productName}` : item.productName}
                          {item.productSku ? ` - ${item.productSku}` : ''}
                        </p>
                        {item.isRecovery && (
                          <Badge variant="warning">
                            Damaged stock sale
                          </Badge>
                        )}
                        <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 6 }}>
                          {quantityDisplay.primary} x {formatMoney(unitPrice, currency)}
                        </p>
                        {quantityDisplay.secondary && (
                          <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 4 }}>
                            {quantityDisplay.secondary}
                          </p>
                        )}
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text-primary)', margin: 0 }}>
                          {formatMoney(item.lineTotal, currency)}
                        </p>
                        <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 6 }}>
                          Stock: {item.isRecovery ? 'damaged recovery' : item.stockStatus}
                        </p>
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={verifyOpen}
        title={verifyIntent === 'approve' ? 'Approve payment' : 'Reject payment'}
        onClose={() => setVerifyOpen(false)}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: 0 }}>
            {verifyIntent === 'approve'
              ? 'Approve this pending payment and mark the transaction as verified?'
              : 'Reject this pending payment and mark the transaction as rejected?'}
          </p>

          {verifyState.error && (
            <div
              style={{
                backgroundColor: 'var(--color-danger-light)',
                border: '1px solid var(--color-danger)',
                color: 'var(--color-danger)',
                borderRadius: 8,
                padding: '12px 14px',
                fontSize: 13,
              }}
            >
              {verifyState.error}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10 }}>
            <button
              type="button"
              className={verifyIntent === 'approve' ? 'btn-success' : 'btn-danger'}
              disabled={verifyPending}
              style={{ flex: 1, padding: '10px 20px', borderRadius: 8, opacity: verifyPending ? 0.8 : 1 }}
              onClick={onVerifyConfirm}
            >
              {verifyPending ? (
                <span className="flex items-center justify-center gap-2">
                  <svg
                    className="animate-spin h-4 w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    style={{ color: 'var(--color-surface)' }}
                  >
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                  </svg>
                  {verifyIntent === 'approve' ? 'Approving payment...' : 'Rejecting payment...'}
                </span>
              ) : verifyIntent === 'approve' ? (
                'Approve payment'
              ) : (
                'Reject payment'
              )}
            </button>
            <button
              type="button"
              className="btn-outline"
              style={{ flex: 1, padding: '10px 20px', borderRadius: 8 }}
              onClick={() => setVerifyOpen(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={voidOpen} title="Void transaction" onClose={() => setVoidOpen(false)}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: 0 }}>
            Are you sure you want to void this transaction? This keeps the record but removes it from normal active sales.
          </p>

          {voidState.error && (
            <div
              style={{
                backgroundColor: 'var(--color-danger-light)',
                border: '1px solid var(--color-danger)',
                color: 'var(--color-danger)',
                borderRadius: 8,
                padding: '12px 14px',
                fontSize: 13,
              }}
            >
              {voidState.error}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10 }}>
            <button
              type="button"
              className="btn-danger"
              disabled={voidPending}
              style={{ flex: 1, padding: '10px 20px', borderRadius: 8, opacity: voidPending ? 0.8 : 1 }}
              onClick={onVoidConfirm}
            >
              {voidPending ? (
                <span className="flex items-center justify-center gap-2">
                  <svg
                    className="animate-spin h-4 w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    style={{ color: 'var(--color-surface)' }}
                  >
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                  </svg>
                  Voiding transaction...
                </span>
              ) : (
                'Void transaction'
              )}
            </button>
            <button
              type="button"
              className="btn-outline"
              style={{ flex: 1, padding: '10px 20px', borderRadius: 8 }}
              onClick={() => setVoidOpen(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      </Modal>
    </>
  )
}
