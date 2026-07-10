'use client'
/**
 * Client actions for a Branch card: toggle active status with confirmation.
 * Uses the server action `toggleBranchStatus` via useActionState.
 */

import { startTransition, useEffect, useRef, useState } from 'react'
import { useActionState } from 'react'
import { useRouter } from 'next/navigation'
import Modal from '../../../../components/ui/Modal'
import DangerDeleteButton from '../../../../components/dashboard/DangerDeleteButton'
import { deleteBranch, toggleBranchStatus, type FormState } from './actions'

type Props = {
  branchId: string
  branchName: string
  isActive: boolean
}

export default function BranchCardActions({ branchId, branchName, isActive }: Props) {
  const router = useRouter()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [state, action, isPending] = useActionState<FormState, FormData>(toggleBranchStatus, {
    error: null,
    success: false,
  })
  const previousPending = useRef(isPending)

  useEffect(() => {
    let resetTimer: ReturnType<typeof setTimeout> | null = null

    if (previousPending.current && !isPending) {
      if (state.success) {
        router.refresh()
        resetTimer = setTimeout(() => {
          setConfirmOpen(false)
        }, 0)
      }
    }

    previousPending.current = isPending
    return () => {
      if (resetTimer) clearTimeout(resetTimer)
    }
  }, [isPending, router, state.error, state.success])

  const onConfirm = () => {
    const fd = new FormData()
    fd.set('branchId', branchId)
    fd.set('isActive', String(!isActive))
    startTransition(() => {
      action(fd)
    })
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirmOpen(true)}
        className={isActive ? 'btn-outline' : 'btn-success'}
        style={{ padding: '5px 14px', borderRadius: 8 }}
      >
        {isActive ? 'Deactivate' : 'Activate'}
      </button>
      <DangerDeleteButton
        entityLabel="Branch"
        entityName={branchName}
        idField="branchId"
        idValue={branchId}
        action={deleteBranch}
      />

      <Modal title={isActive ? 'Deactivate branch' : 'Activate branch'} isOpen={confirmOpen} onClose={() => setConfirmOpen(false)}>
        <p style={{ marginBottom: 12 }}>Are you sure you want to {isActive ? 'deactivate' : 'activate'} this branch?</p>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            disabled={isPending}
            className={isActive ? 'btn-danger' : 'btn-success'}
            style={{ padding: '8px 16px', borderRadius: 8, opacity: isPending ? 0.8 : 1, cursor: isPending ? 'not-allowed' : 'pointer' }}
            onClick={onConfirm}
          >
            {isPending ? (
              <span className="flex items-center gap-2">
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                </svg>
                {isActive ? 'Deactivating...' : 'Activating...'}
              </span>
            ) : (
              'Confirm'
            )}
          </button>
          <button type="button" className="btn-outline" style={{ padding: '8px 16px', borderRadius: 8 }} onClick={() => setConfirmOpen(false)}>
            Cancel
          </button>
        </div>

        {state.error && <p style={{ color: 'var(--color-danger)', marginTop: 8 }}>{state.error}</p>}
      </Modal>
    </>
  )
}
