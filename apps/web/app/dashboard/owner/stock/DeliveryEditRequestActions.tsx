'use client'
/**
 * Owner controls for reviewing admin-submitted supplier delivery edits.
 */

import { startTransition, useEffect, useRef } from 'react'
import { useActionState } from 'react'
import { useRouter } from 'next/navigation'
import LoadingOverlay from '../../../../components/ui/LoadingOverlay'
import Toast from '../../../../components/ui/Toast'
import { useToast } from '../../../../lib/hooks/useToast'
import { reviewSupplierDeliveryEditRequest } from './actions'
import type { FormState, StockDeliveryEditRequestRow } from './types'

type Props = {
  request: StockDeliveryEditRequestRow
}

/**
 * DeliveryEditRequestActions renders approve/reject buttons for owner review.
 */
export default function DeliveryEditRequestActions({ request }: Props) {
  const router = useRouter()
  const previousPending = useRef(false)
  const [state, action, pending] = useActionState<FormState, FormData>(reviewSupplierDeliveryEditRequest, {
    success: false,
    error: null,
  })
  const { toast, toastState, dismiss } = useToast()

  useEffect(() => {
    if (previousPending.current && !pending) {
      if (state.success) {
        toast.success('Delivery edit reviewed')
        router.refresh()
      } else if (state.error) {
        toast.error(state.error)
      }
    }

    previousPending.current = pending
  }, [pending, router, state.error, state.success, toast])

  const submitReview = (reviewAction: 'approve' | 'reject') => {
    const formData = new FormData()
    formData.set('requestId', request.id)
    formData.set('action', reviewAction)

    startTransition(() => {
      action(formData)
    })
  }

  return (
    <>
      {pending && <LoadingOverlay message="Reviewing delivery edit..." />}
      {toastState && <Toast message={toastState.message} type={toastState.type} duration={toastState.duration} onDismiss={dismiss} />}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-success"
          onClick={() => submitReview('approve')}
          disabled={pending}
          style={{ padding: '5px 12px', borderRadius: 8, fontSize: 12 }}
        >
          Approve
        </button>
        <button
          type="button"
          className="btn-outline"
          onClick={() => submitReview('reject')}
          disabled={pending}
          style={{ padding: '5px 12px', borderRadius: 8, fontSize: 12 }}
        >
          Reject
        </button>
      </div>
    </>
  )
}
