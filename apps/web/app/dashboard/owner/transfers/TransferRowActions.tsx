/**
 * Client-side transfer row actions.
 *
 * The component renders the correct confirmation flow for approving
 * initiated transfers or marking in-transit transfers as received.
 */

'use client'

import { startTransition, useEffect, useRef, useState } from 'react'
import { useActionState } from 'react'
import { useRouter } from 'next/navigation'
import Modal from '../../../../components/ui/Modal'
import Toast from '../../../../components/ui/Toast'
import LoadingOverlay from '../../../../components/ui/LoadingOverlay'
import { useToast } from '../../../../lib/hooks/useToast'
import {
  approveTransferAction,
  markTransferReceivedAction,
  type FormState,
} from './actions'
import type { TransferStatus } from './types'

/**
 * Props for the row action buttons.
 */
type Props = {
  transferId: string
  status: TransferStatus
}

/**
 * Selects the server action and button label for the current status.
 */
function getActionConfig(status: TransferStatus) {
  if (status === 'initiated') {
    return {
      label: 'Approve',
      title: 'Approve transfer',
      description: 'Approve this transfer so the stock moves into transit.',
      buttonClass: 'btn-success' as const,
      action: approveTransferAction,
      loadingLabel: 'Approving...',
      successLabel: 'Transfer approved',
    }
  }

  return {
    label: 'Mark received',
    title: 'Mark transfer received',
    description: 'Confirm that the stock arrived and finalize the inventory movement.',
    buttonClass: 'btn-primary' as const,
    action: markTransferReceivedAction,
    loadingLabel: 'Saving...',
    successLabel: 'Transfer received',
  }
}

/**
 * Renders the action button and confirmation modal for a transfer row.
 */
export default function TransferRowActions({ transferId, status }: Props) {
  const router = useRouter()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const config = getActionConfig(status)

  const { toast, toastState, dismiss } = useToast()
  const [state, action, isPending] = useActionState<FormState, FormData>(config.action, {
    success: false,
    error: null,
  })
  const previousPending = useRef(isPending)

  /**
   * Shows the completion toast and refreshes the page after a successful action.
   */
  useEffect(() => {
    let resetTimer: ReturnType<typeof setTimeout> | null = null

    if (previousPending.current && !isPending) {
      if (state.success) {
        toast.success(config.successLabel)
        router.refresh()
        resetTimer = setTimeout(() => {
          setConfirmOpen(false)
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
  }, [config.successLabel, isPending, router, state.error, state.success, toast])

  /**
   * Submits the hidden transfer id to the active server action.
   */
  const onConfirm = () => {
    const formData = new FormData()
    formData.set('transferId', transferId)
    startTransition(() => {
      action(formData)
    })
  }

  return (
    <>
      {isPending && <LoadingOverlay message={config.loadingLabel} />}
      {toastState && (
        <Toast
          message={toastState.message}
          type={toastState.type}
          onDismiss={dismiss}
          duration={toastState.duration}
        />
      )}

      <button
        type="button"
        className={config.buttonClass}
        style={{ padding: '5px 14px', borderRadius: 8, fontSize: 12 }}
        onClick={() => setConfirmOpen(true)}
      >
        {config.label}
      </button>

      <Modal title={config.title} isOpen={confirmOpen} onClose={() => setConfirmOpen(false)}>
        <p style={{ marginBottom: 12, fontSize: 13, color: 'var(--color-text-primary)' }}>
          {config.description}
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
              marginBottom: 12,
            }}
          >
            {state.error}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            disabled={isPending}
            className={config.buttonClass}
            style={{ padding: '8px 16px', borderRadius: 8, opacity: isPending ? 0.8 : 1 }}
            onClick={onConfirm}
          >
            {isPending ? (
              <span className="flex items-center gap-2">
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                </svg>
                {config.loadingLabel}
              </span>
            ) : (
              'Confirm'
            )}
          </button>
          <button
            type="button"
            className="btn-outline"
            style={{ padding: '8px 16px', borderRadius: 8 }}
            onClick={() => setConfirmOpen(false)}
          >
            Cancel
          </button>
        </div>
      </Modal>
    </>
  )
}
