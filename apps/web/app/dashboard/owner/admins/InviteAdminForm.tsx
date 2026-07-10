'use client'
/**
 * Modal form for inviting a future admin via email.
 *
 * The invite uses the Supabase auth admin API and closes after the invitation
 * is sent successfully.
 */

import { startTransition, useEffect, useRef, useState, type FormEvent } from 'react'
import { useActionState } from 'react'
import Modal from '../../../../components/ui/Modal'
import Toast from '../../../../components/ui/Toast'
import LoadingOverlay from '../../../../components/ui/LoadingOverlay'
import { useToast } from '../../../../lib/hooks/useToast'
import { inviteAdmin, type FormState } from './actions'

/**
 * InviteAdminForm renders the invite-by-email modal.
 */
export default function InviteAdminForm() {
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')

  const { toast, toastState, dismiss } = useToast()
  const [state, action, isPending] = useActionState<FormState, FormData>(inviteAdmin, {
    error: null,
    success: false,
  })
  const previousPending = useRef(isPending)

  /**
   * Reacts to invite completion without mutating state directly inside the effect.
   */
  useEffect(() => {
    let resetTimer: ReturnType<typeof setTimeout> | null = null

    if (previousPending.current && !isPending) {
      if (state.success) {
        toast.success('Invite sent successfully')
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
  }, [isPending, state.error, state.success, toast])

  /**
   * Sends the invitation email through the server action.
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
   * Opens the modal and resets the draft email.
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

      <Modal isOpen={open} title="Invite admin" onClose={() => setOpen(false)}>
        <form onSubmit={onSubmit}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
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
                style={{
                  flex: 1,
                  padding: '10px 20px',
                  borderRadius: 8,
                  opacity: isPending ? 0.8 : 1,
                }}
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

