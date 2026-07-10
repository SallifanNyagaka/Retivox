/**
 * Reusable soft-delete confirmation button for dashboard danger zones.
 *
 * Uses server actions through useActionState, shows a confirmation dialog with
 * optional reason, closes itself on success, and refreshes the current route.
 */
'use client'

import { startTransition, useEffect, useRef, useState, type FormEvent } from 'react'
import { useActionState } from 'react'
import { useRouter } from 'next/navigation'
import Modal from '../ui/Modal'
import Toast from '../ui/Toast'
import LoadingOverlay from '../ui/LoadingOverlay'
import { useToast } from '../../lib/hooks/useToast'

type FormState = {
  error: string | null
  success: boolean
  message?: string
}

type Props = {
  entityLabel: string
  entityName: string
  idField: string
  idValue: string
  action: (prevState: FormState, formData: FormData) => Promise<FormState>
}

/**
 * Renders a destructive soft-delete confirmation flow.
 */
export default function DangerDeleteButton({ entityLabel, entityName, idField, idValue, action }: Props) {
  const router = useRouter()
  const previousPending = useRef(false)
  const [open, setOpen] = useState(false)
  const [state, formAction, isPending] = useActionState<FormState, FormData>(action, {
    error: null,
    success: false,
  })
  const { toast, toastState, dismiss } = useToast()

  useEffect(() => {
    let resetTimer: ReturnType<typeof setTimeout> | null = null

    if (previousPending.current && !isPending) {
      if (state.success) {
        toast.success(state.message ?? `${entityLabel} deleted`)
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
  }, [entityLabel, isPending, router, state.error, state.message, state.success, toast])

  /**
   * Sends the delete request inside a React transition.
   */
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)

    startTransition(() => {
      formAction(formData)
    })
  }

  return (
    <>
      {isPending && <LoadingOverlay message={`Deleting ${entityLabel.toLowerCase()}...`} />}
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
        className="btn-danger"
        style={{ padding: '5px 14px', borderRadius: 8, fontSize: 12 }}
        onClick={() => setOpen(true)}
      >
        Delete
      </button>

      <Modal isOpen={open} title={`Delete ${entityLabel.toLowerCase()}`} onClose={() => setOpen(false)}>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <input type="hidden" name={idField} value={idValue} />

          <div
            className="rounded-xl border"
            style={{
              borderColor: 'var(--color-danger)',
              backgroundColor: 'var(--color-danger-light)',
              padding: 14,
            }}
          >
            <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--color-danger)' }}>
              This removes {entityName} from active operations.
            </p>
            <p style={{ marginTop: 6, marginBottom: 0, fontSize: 13, color: 'var(--color-danger)' }}>
              Historical transactions and audit logs remain traceable.
            </p>
          </div>

          <label className="flex flex-col gap-2" style={{ fontSize: 13, color: 'var(--color-text-primary)' }}>
            Reason optional
            <textarea
              name="reason"
              rows={3}
              placeholder={`Why are you deleting this ${entityLabel.toLowerCase()}?`}
              style={{
                border: '1px solid var(--color-border)',
                borderRadius: 8,
                padding: '10px 12px',
                backgroundColor: 'var(--color-background)',
                color: 'var(--color-text-primary)',
                resize: 'vertical',
              }}
            />
          </label>

          {state.error && (
            <p style={{ margin: 0, fontSize: 13, color: 'var(--color-danger)' }}>
              {state.error}
            </p>
          )}

          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              className="btn-outline"
              style={{ padding: '8px 16px', borderRadius: 8 }}
              onClick={() => setOpen(false)}
              disabled={isPending}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-danger"
              style={{ padding: '10px 20px', borderRadius: 8 }}
              disabled={isPending}
            >
              {isPending ? `Deleting ${entityLabel.toLowerCase()}...` : `Delete ${entityLabel.toLowerCase()}`}
            </button>
          </div>
        </form>
      </Modal>
    </>
  )
}
