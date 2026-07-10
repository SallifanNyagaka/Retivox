'use client'
/**
 * Modal form for creating an employee account.
 *
 * The form creates the auth user, profile row, and single branch assignment
 * through the employee server action.
 */

import { startTransition, useEffect, useRef, useState, type FormEvent } from 'react'
import { useActionState } from 'react'
import { useRouter } from 'next/navigation'
import Modal from '../../../../components/ui/Modal'
import Toast from '../../../../components/ui/Toast'
import LoadingOverlay from '../../../../components/ui/LoadingOverlay'
import { useToast } from '../../../../lib/hooks/useToast'
import { addEmployee, type FormState } from './actions'
import type { BranchRow } from './types'

/**
 * Props for the add employee modal.
 */
type Props = {
  branches: BranchRow[]
}

/**
 * AddEmployeeForm renders the employee creation modal and action button.
 */
export default function AddEmployeeForm({ branches }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [branchId, setBranchId] = useState('')

  const { toast, toastState, dismiss } = useToast()
  const [state, action, isPending] = useActionState<FormState, FormData>(addEmployee, {
    error: null,
    success: false,
  })
  const previousPending = useRef(isPending)

  /**
   * Closes and resets the modal after successful employee creation.
   */
  useEffect(() => {
    let resetTimer: ReturnType<typeof setTimeout> | null = null

    if (previousPending.current && !isPending) {
      if (state.success) {
        toast.success('Employee added successfully')
        router.refresh()
        resetTimer = setTimeout(() => {
          setOpen(false)
          setName('')
          setEmail('')
          setPhone('')
          setPassword('')
          setBranchId('')
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
   * Sends the form data to the employee creation server action.
   */
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const formData = new FormData()
    formData.set('name', name)
    formData.set('email', email)
    formData.set('phone', phone)
    formData.set('password', password)
    formData.set('branchId', branchId)

    startTransition(() => {
      action(formData)
    })
  }

  /**
   * Opens the modal with a clean draft state.
   */
  const openModal = () => {
    setName('')
    setEmail('')
    setPhone('')
    setPassword('')
    setBranchId(branches[0]?.id ?? '')
    setOpen(true)
  }

  return (
    <>
      {isPending && <LoadingOverlay message="Adding employee..." />}
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
        Add employee
      </button>

      <Modal isOpen={open} title="Add employee" onClose={() => setOpen(false)}>
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

            <label style={{ fontSize: 13, display: 'block' }}>
              <span style={{ display: 'block', marginBottom: 6, fontWeight: 500, color: 'var(--color-text-primary)' }}>
                Branch assignment
              </span>
              <select
                value={branchId}
                onChange={(event) => setBranchId(event.target.value)}
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
              >
                <option value="">Select branch</option>
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
              </select>
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
                disabled={isPending || !branchId}
                className="btn-primary"
                style={{
                  flex: 1,
                  padding: '10px 20px',
                  borderRadius: 8,
                  opacity: isPending || !branchId ? 0.8 : 1,
                }}
              >
                {isPending ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                    </svg>
                    Adding employee...
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
