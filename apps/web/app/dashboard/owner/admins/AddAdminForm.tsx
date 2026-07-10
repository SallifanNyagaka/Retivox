'use client'
/**
 * Modal form for creating a new admin account.
 *
 * The form creates the auth account, profile row, and branch assignments
 * through a server action and closes itself once the save succeeds.
 */

import { startTransition, useEffect, useRef, useState, type FormEvent } from 'react'
import { useActionState } from 'react'
import { useRouter } from 'next/navigation'
import Modal from '../../../../components/ui/Modal'
import Toast from '../../../../components/ui/Toast'
import LoadingOverlay from '../../../../components/ui/LoadingOverlay'
import { useToast } from '../../../../lib/hooks/useToast'
import { addAdmin, type FormState } from './actions'
import type { BranchRow } from './types'

/**
 * Props for the add-admin modal.
 */
type Props = {
  availableBranches: BranchRow[]
}

/**
 * AddAdminForm renders the top-level admin creation modal.
 */
export default function AddAdminForm({ availableBranches }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [selectedBranchIds, setSelectedBranchIds] = useState<string[]>([])

  const { toast, toastState, dismiss } = useToast()
  const [state, action, isPending] = useActionState<FormState, FormData>(addAdmin, {
    error: null,
    success: false,
  })
  const previousPending = useRef(isPending)

  /**
   * Responds to the server action result without mutating state synchronously.
   */
  useEffect(() => {
    let resetTimer: ReturnType<typeof setTimeout> | null = null

    if (previousPending.current && !isPending) {
      if (state.success) {
        toast.success('Admin added successfully')
        router.refresh()
        resetTimer = setTimeout(() => {
          setOpen(false)
          setName('')
          setEmail('')
          setPhone('')
          setPassword('')
          setSelectedBranchIds([])
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
   * Submits the admin creation request.
   */
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const formData = new FormData()
    formData.set('name', name)
    formData.set('email', email)
    formData.set('phone', phone)
    formData.set('password', password)
    selectedBranchIds.forEach((branchId) => {
      formData.append('branchIds', branchId)
    })

    startTransition(() => {
      action(formData)
    })
  }

  /**
   * Toggles a branch checkbox selection.
   */
  const toggleBranch = (branchId: string) => {
    setSelectedBranchIds((current) =>
      current.includes(branchId) ? current.filter((id) => id !== branchId) : [...current, branchId]
    )
  }

  /**
   * Opens the modal and clears any stale draft values.
   */
  const openModal = () => {
    setName('')
    setEmail('')
    setPhone('')
    setPassword('')
    setSelectedBranchIds([])
    setOpen(true)
  }

  return (
    <>
      {isPending && <LoadingOverlay message="Adding admin..." />}
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
        className="btn-primary"
        style={{ padding: '10px 20px', borderRadius: 8 }}
        onClick={openModal}
      >
        Add admin
      </button>

      <Modal isOpen={open} title="Add admin" onClose={() => setOpen(false)}>
        <form onSubmit={onSubmit}>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
              maxHeight: '70vh',
              overflowY: 'auto',
              paddingRight: 4,
            }}
          >
            <label style={{ fontSize: 13, display: 'block' }}>
              <span style={{ display: 'block', marginBottom: 6, fontWeight: 500, color: 'var(--color-text-primary)' }}>
                Name
              </span>
              <input
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
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

            <label style={{ fontSize: 13, display: 'block' }}>
              <span style={{ display: 'block', marginBottom: 6, fontWeight: 500, color: 'var(--color-text-primary)' }}>
                Phone
              </span>
              <input
                type="tel"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
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

            <label style={{ fontSize: 13, display: 'block' }}>
              <span style={{ display: 'block', marginBottom: 6, fontWeight: 500, color: 'var(--color-text-primary)' }}>
                Password
              </span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
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

            <div style={{ fontSize: 13, display: 'block' }}>
              <span style={{ display: 'block', marginBottom: 6, fontWeight: 500, color: 'var(--color-text-primary)' }}>
                Branch assignments
              </span>
              {availableBranches.length === 0 ? (
                <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: 0 }}>
                  No unassigned branches are available right now.
                </p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {availableBranches.map((branch) => {
                    const checked = selectedBranchIds.includes(branch.id)

                    return (
                      <label
                        key={branch.id}
                        className="flex items-center gap-2"
                        style={{
                          minHeight: 44,
                          padding: '0 12px',
                          border: '1px solid var(--color-border)',
                          borderRadius: 8,
                          backgroundColor: 'var(--color-background)',
                        }}
                      >
                        <input
                          type="checkbox"
                          name="branchIds"
                          value={branch.id}
                          checked={checked}
                          onChange={() => toggleBranch(branch.id)}
                        />
                        <span style={{ color: 'var(--color-text-primary)' }}>{branch.name}</span>
                      </label>
                    )
                  })}
                </div>
              )}
            </div>

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
                    Adding admin...
                  </span>
                ) : (
                  'Save'
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

