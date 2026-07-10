'use client'
/**
 * Modal form for inviting an employee by email.
 *
 * The invite is sent through a server action and gives the user clear loading,
 * success, and error feedback while keeping the modal state predictable.
 */

import { startTransition, useEffect, useRef, useState, type FormEvent } from 'react'
import { useActionState } from 'react'
import { useRouter } from 'next/navigation'
import Modal from '../../../../components/ui/Modal'
import Toast from '../../../../components/ui/Toast'
import LoadingOverlay from '../../../../components/ui/LoadingOverlay'
import { useToast } from '../../../../lib/hooks/useToast'
import { inviteEmployee, type FormState } from './actions'

/**
 * InviteEmployeeForm renders the top-level employee invite modal.
 */
export default function InviteEmployeeForm() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const { toast, toastState, dismiss } = useToast()
  const [state, action, isPending] = useActionState<FormState, FormData>(inviteEmployee, {
    error: null,
    success: false,
  })
  const previousPending = useRef(isPending)

  /**
   * Handles invite results after the action finishes.
   */
  useEffect(() => {
    let resetTimer: ReturnType<typeof setTimeout> | null = null

    if (previousPending.current && !isPending) {
      if (state.success) {
        toast.success('Employee invite sent')
        router.refresh()
        resetTimer = setTimeout(() => {
          setOpen(false)
          setEmail('')
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
   * Submits the invite action inside a transition.
   */
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const formData = new FormData()
    formData.set('email', email)

    startTransition(() => {
      action(formData)
    })
  }

  /**
   * Opens the invite modal with a clean draft.
   */
  const openModal = () => {
    setEmail('')
    setOpen(true)
  }

  return (
    <>
      {isPending && <LoadingOverlay message="Sending invite..." />}
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
        className="btn-outline"
        style={{ padding: '10px 20px', borderRadius: 8 }}
        onClick={openModal}
      >
        Invite via email
      </button>

      <Modal isOpen={open} title="Invite employee" onClose={() => setOpen(false)}>
        <form onSubmit={onSubmit}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: 0 }}>
              Send an email invitation so the employee can activate their account.
            </p>

            <label style={{ fontSize: 13, display: 'block' }}>
              <span style={{ display: 'block', marginBottom: 6, fontWeight: 500, color: 'var(--color-text-primary)' }}>
                Email
              </span>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                style={{
                  width: '100%',
                  height: 44,
                  border: '1px solid var(--color-border)',
                  borderRadius: 8,
                  padding: '0 12px',
                  boxSizing: 'border-box',
                  fontSize: 13,
                  color: 'var(--color-text-primary)',
                  backgroundColor: 'var(--color-background)',
                }}
              />
            </label>

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

            <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
              <button
                type="submit"
                disabled={isPending}
                className="btn-primary"
                style={{ flex: 1, padding: '10px 20px', borderRadius: 8, opacity: isPending ? 0.8 : 1 }}
              >
                {isPending ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                    </svg>
                    Sending invite...
                  </span>
                ) : (
                  'Send invite'
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
        </form>
      </Modal>
    </>
  )
}
