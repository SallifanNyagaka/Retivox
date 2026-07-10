'use client'
/**
 * AddBranchForm opens a modal for creating a new branch from the owner dashboard.
 *
 * The form submits through the `addBranch` server action, shows a loading
 * spinner while the request is in flight, and closes itself after success.
 */

import { startTransition, useEffect, useRef, useState, type FormEvent } from 'react'
import { useActionState } from 'react'
import Modal from '../../../../components/ui/Modal'
import Toast from '../../../../components/ui/Toast'
import LoadingOverlay from '../../../../components/ui/LoadingOverlay'
import { useToast } from '../../../../lib/hooks/useToast'
import { addBranch, type FormState } from './actions'

/**
 * Supported branch types in the owner dashboard.
 */
type BranchType = 'store' | 'warehouse'

/**
 * Client form used to open the add-branch modal and submit the server action.
 */
export default function AddBranchForm() {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [location, setLocation] = useState('')
  const [branchType, setBranchType] = useState<BranchType>('store')

  const { toast, toastState, dismiss } = useToast()
  const [state, action, isPending] = useActionState<FormState, FormData>(addBranch, {
    error: null,
    success: false,
  })
  const previousPending = useRef(isPending)

  /**
   * Handles the post-submit result so we can close the modal on success and
   * keep the form open on failure.
   */
  useEffect(() => {
    let resetTimer: ReturnType<typeof setTimeout> | null = null

    if (previousPending.current && !isPending) {
      if (state.success) {
        toast.success('Branch added successfully')
        resetTimer = setTimeout(() => {
          setOpen(false)
          setName('')
          setLocation('')
          setBranchType('store')
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
   * Submits the modal form to the server action with the current field values.
   */
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const formData = new FormData()
    formData.set('name', name)
    formData.set('location', location)
    formData.set('branchType', branchType)

    startTransition(() => {
      action(formData)
    })
  }

  /**
   * Opens the modal and clears any stale draft values.
   */
  const openModal = () => {
    setName('')
    setLocation('')
    setBranchType('store')
    setOpen(true)
  }

  return (
    <>
      {isPending && <LoadingOverlay message="Adding branch..." />}
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
        Add branch
      </button>

      <Modal isOpen={open} title="Add branch" onClose={() => setOpen(false)}>
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
                Branch name
              </span>
              <input
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                placeholder="e.g. Westlands Store"
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
                Location
              </span>
              <input
                type="text"
                value={location}
                onChange={(event) => setLocation(event.target.value)}
                required
                placeholder="e.g. Nairobi CBD"
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
                Branch type
              </span>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <label
                  className="flex items-center gap-2"
                  style={{
                    height: 44,
                    padding: '0 12px',
                    border: '1px solid var(--color-border)',
                    borderRadius: 8,
                    backgroundColor: 'var(--color-background)',
                  }}
                >
                  <input
                    type="radio"
                    name="branchType"
                    value="store"
                    checked={branchType === 'store'}
                    onChange={() => setBranchType('store')}
                  />
                  <span style={{ color: 'var(--color-text-primary)' }}>Store</span>
                </label>
                <label
                  className="flex items-center gap-2"
                  style={{
                    height: 44,
                    padding: '0 12px',
                    border: '1px solid var(--color-border)',
                    borderRadius: 8,
                    backgroundColor: 'var(--color-background)',
                  }}
                >
                  <input
                    type="radio"
                    name="branchType"
                    value="warehouse"
                    checked={branchType === 'warehouse'}
                    onChange={() => setBranchType('warehouse')}
                  />
                  <span style={{ color: 'var(--color-text-primary)' }}>Warehouse</span>
                </label>
              </div>
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
                    Adding branch...
                  </span>
                ) : (
                  'Add branch'
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
