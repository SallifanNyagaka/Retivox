'use client'
/**
 * Approval controls for employee transfer history rows.
 *
 * Pending transfers require an explicit confirmation before branch assignment
 * is changed by the server action.
 */

import { startTransition, useEffect, useRef, useState } from 'react'
import { useActionState } from 'react'
import { useRouter } from 'next/navigation'
import Modal from '../../../../components/ui/Modal'
import Toast from '../../../../components/ui/Toast'
import LoadingOverlay from '../../../../components/ui/LoadingOverlay'
import { useToast } from '../../../../lib/hooks/useToast'
import { approveTransfer, type FormState } from './actions'
import type { TransferHistoryRow } from './types'

/**
 * Props for transfer approval controls.
 */
type Props = {
  transfer: TransferHistoryRow
}

/**
 * EmployeeTransferActions renders approve controls for pending transfers.
 */
export default function EmployeeTransferActions({ transfer }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const { toast, toastState, dismiss } = useToast()
  const [state, action, isPending] = useActionState<FormState, FormData>(approveTransfer, {
    error: null,
    success: false,
  })
  const previousPending = useRef(isPending)

  /**
   * Handles approval results after the server action finishes.
   */
  useEffect(() => {
    let resetTimer: ReturnType<typeof setTimeout> | null = null

    if (previousPending.current && !isPending) {
      if (state.success) {
        toast.success('Employee transfer approved')
        router.refresh()
        resetTimer = setTimeout(() => {
          setOpen(false)
        }, 0)
      } else if (state.error) {
        toast.error(state.error)
      }
    }

    previousPending.current = isPending
    return () => {
      if (resetTimer) {
        clearTimeout(resetTimer)
      }
    }
  }, [isPending, router, state.error, state.success, toast])

  /**
   * Confirms transfer approval.
   */
  const onApprove = () => {
    const formData = new FormData()
    formData.set('transferId', transfer.id)

    startTransition(() => {
      action(formData)
    })
  }

  if (transfer.status !== 'pending') {
    return <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>No action</span>
  }

  return (
    <>
      {isPending && <LoadingOverlay message="Approving transfer..." />}
      {toastState && (
        <Toast
          message={toastState.message}
          type={toastState.type}
          duration={toastState.duration}
          onDismiss={dismiss}
        />
      )}

      <button
        type="button"
        className="btn-success"
        style={{ padding: '5px 14px', borderRadius: 8, fontSize: 12 }}
        onClick={() => setOpen(true)}
      >
        Approve
      </button>

      <Modal isOpen={open} title="Approve transfer" onClose={() => setOpen(false)}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: 0 }}>
            Approve moving {transfer.user_name} from {transfer.from_branch_name} to {transfer.to_branch_name}?
          </p>

          {state.error && (
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
              {state.error}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10 }}>
            <button
              type="button"
              className="btn-success"
              disabled={isPending}
              style={{ flex: 1, padding: '10px 20px', borderRadius: 8, opacity: isPending ? 0.8 : 1 }}
              onClick={onApprove}
            >
              {isPending ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                  </svg>
                  Approving transfer...
                </span>
              ) : (
                'Approve transfer'
              )}
            </button>
            <button
              type="button"
              className="btn-outline"
              style={{ flex: 1, padding: '10px 20px', borderRadius: 8 }}
              onClick={() => setOpen(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      </Modal>
    </>
  )
}
