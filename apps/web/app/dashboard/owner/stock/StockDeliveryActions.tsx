'use client'
/**
 * Row actions for supplier delivery approval and acknowledgement.
 *
 * Owners approve admin-requested deliveries; admins/owners acknowledge approved
 * deliveries once stock physically arrives, which increases branch stock.
 */

import { startTransition, useEffect, useRef } from 'react'
import { useActionState } from 'react'
import { useRouter } from 'next/navigation'
import LoadingOverlay from '../../../../components/ui/LoadingOverlay'
import Toast from '../../../../components/ui/Toast'
import { useToast } from '../../../../lib/hooks/useToast'
import { acknowledgeSupplierDelivery, approveSupplierDelivery } from './actions'
import type { FormState, StockDeliveryRow } from './types'

/**
 * Props for StockDeliveryActions.
 */
type Props = {
  delivery: StockDeliveryRow
}

/**
 * StockDeliveryActions renders contextual delivery workflow controls.
 */
export default function StockDeliveryActions({ delivery }: Props) {
  const router = useRouter()
  const previousApprovePending = useRef(false)
  const previousAcknowledgePending = useRef(false)
  const [approveState, approveAction, approvePending] = useActionState<FormState, FormData>(approveSupplierDelivery, {
    success: false,
    error: null,
  })
  const [acknowledgeState, acknowledgeAction, acknowledgePending] = useActionState<FormState, FormData>(acknowledgeSupplierDelivery, {
    success: false,
    error: null,
  })
  const { toast, toastState, dismiss } = useToast()

  /**
   * Handles approval result messages.
   */
  useEffect(() => {
    if (previousApprovePending.current && !approvePending) {
      if (approveState.success) {
        toast.success('Delivery approved')
        router.refresh()
      } else if (approveState.error) {
        toast.error(approveState.error)
      }
    }

    previousApprovePending.current = approvePending
  }, [approvePending, approveState.error, approveState.success, router, toast])

  /**
   * Handles acknowledgement result messages.
   */
  useEffect(() => {
    if (previousAcknowledgePending.current && !acknowledgePending) {
      if (acknowledgeState.success) {
        toast.success('Delivery acknowledged and stock updated')
        router.refresh()
      } else if (acknowledgeState.error) {
        toast.error(acknowledgeState.error)
      }
    }

    previousAcknowledgePending.current = acknowledgePending
  }, [acknowledgePending, acknowledgeState.error, acknowledgeState.success, router, toast])

  /**
   * Starts a delivery action transition.
   */
  const runAction = (action: (formData: FormData) => void) => {
    const formData = new FormData()
    formData.set('deliveryId', delivery.id)

    startTransition(() => {
      action(formData)
    })
  }

  return (
    <>
      {(approvePending || acknowledgePending) && (
        <LoadingOverlay message={approvePending ? 'Approving delivery...' : 'Acknowledging delivery...'} />
      )}
      {toastState && (
        <Toast
          message={toastState.message}
          type={toastState.type}
          duration={toastState.duration}
          onDismiss={dismiss}
        />
      )}

      <div className="flex flex-wrap justify-center gap-2">
        {delivery.status === 'pending_approval' && (
          <button
            type="button"
            className="btn-success"
            style={{ padding: '5px 14px', borderRadius: 8, fontSize: 12 }}
            disabled={approvePending}
            onClick={() => runAction(approveAction)}
          >
            Approve
          </button>
        )}
        {delivery.status === 'approved' && (
          <button
            type="button"
            className="btn-primary"
            style={{ padding: '5px 14px', borderRadius: 8, fontSize: 12 }}
            disabled={acknowledgePending}
            onClick={() => runAction(acknowledgeAction)}
          >
            Acknowledge arrival
          </button>
        )}
      </div>
    </>
  )
}
