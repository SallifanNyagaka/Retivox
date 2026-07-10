'use client'
/**
 * Row actions for admin employee access management.
 *
 * The component only toggles the employee's access to the displayed branch and
 * never changes the employee's global account status or role.
 */

import Link from 'next/link'
import { startTransition, useEffect, useRef, useState } from 'react'
import { useActionState } from 'react'
import { useRouter } from 'next/navigation'
import LoadingOverlay from '../../../../components/ui/LoadingOverlay'
import Modal from '../../../../components/ui/Modal'
import Toast from '../../../../components/ui/Toast'
import { useToast } from '../../../../lib/hooks/useToast'
import { setEmployeeBranchAccess, type AdminEmployeeFormState } from './actions'

/**
 * Row action employee payload.
 */
export type AdminEmployeeActionRow = {
  roleId: string
  userId: string
  name: string
  branchId: string
  branchName: string
  accountIsActive: boolean
  accessIsActive: boolean
}

/**
 * Props for AdminEmployeeRowActions.
 */
type Props = {
  employee: AdminEmployeeActionRow
}

/**
 * AdminEmployeeRowActions renders activity and branch-access controls.
 */
export default function AdminEmployeeRowActions({ employee }: Props) {
  const router = useRouter()
  const previousPending = useRef(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [state, formAction, isPending] = useActionState<AdminEmployeeFormState, FormData>(setEmployeeBranchAccess, {
    error: null,
    success: false,
  })
  const { toast, toastState, dismiss } = useToast()
  const nextAccessState = !employee.accessIsActive
  const actionLabel = employee.accessIsActive ? 'Deactivate access' : 'Restore access'

  /**
   * Closes the confirmation dialog after successful access changes.
   */
  useEffect(() => {
    let resetTimer: ReturnType<typeof setTimeout> | null = null

    if (previousPending.current && !isPending) {
      if (state.success) {
        toast.success(state.message ?? 'Employee access updated')
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
  }, [isPending, router, state.error, state.message, state.success, toast])

  /**
   * Sends the branch access update inside a React transition.
   */
  const onConfirm = () => {
    const formData = new FormData()
    formData.set('roleId', employee.roleId)
    formData.set('userId', employee.userId)
    formData.set('branchId', employee.branchId)
    formData.set('isActive', String(nextAccessState))

    startTransition(() => {
      formAction(formData)
    })
  }

  return (
    <>
      {isPending && (
        <LoadingOverlay message={employee.accessIsActive ? 'Deactivating access...' : 'Restoring access...'} />
      )}
      {toastState && (
        <Toast
          message={toastState.message}
          type={toastState.type}
          duration={toastState.duration}
          onDismiss={dismiss}
        />
      )}

      <div className="flex flex-wrap gap-2">
        <Link
          href={`/dashboard/admin/transactions?employee=${employee.userId}&branch=${employee.branchId}`}
          className="btn-outline"
          style={{ padding: '5px 14px', borderRadius: 8, fontSize: 12 }}
        >
          View activity
        </Link>
        <button
          type="button"
          className={employee.accessIsActive ? 'btn-danger' : 'btn-success'}
          disabled={!employee.accountIsActive}
          style={{
            padding: '5px 14px',
            borderRadius: 8,
            fontSize: 12,
            opacity: employee.accountIsActive ? 1 : 0.65,
          }}
          onClick={() => setConfirmOpen(true)}
        >
          {employee.accountIsActive ? actionLabel : 'Account inactive'}
        </button>
      </div>

      <Modal isOpen={confirmOpen} title={actionLabel} onClose={() => setConfirmOpen(false)}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Confirmation copy keeps destructive branch-access changes explicit. */}
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: 0 }}>
            {employee.accessIsActive
              ? `Deactivate ${employee.name}'s access to ${employee.branchName}?`
              : `Restore ${employee.name}'s access to ${employee.branchName}?`}
          </p>
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: 0 }}>
            Their historical transactions and audit records will remain visible.
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
              className={employee.accessIsActive ? 'btn-danger' : 'btn-success'}
              disabled={isPending}
              style={{ flex: 1, padding: '10px 20px', borderRadius: 8, opacity: isPending ? 0.8 : 1 }}
              onClick={onConfirm}
            >
              {isPending ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                  </svg>
                  {employee.accessIsActive ? 'Deactivating...' : 'Restoring...'}
                </span>
              ) : (
                actionLabel
              )}
            </button>
            <button
              type="button"
              className="btn-outline"
              disabled={isPending}
              style={{ flex: 1, padding: '10px 20px', borderRadius: 8 }}
              onClick={() => setConfirmOpen(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      </Modal>
    </>
  )
}
