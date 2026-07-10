'use client'
/**
 * Row-level actions for employee management.
 *
 * This component keeps employee transfer and deactivation flows interactive
 * while using server actions safely through startTransition.
 */

import Link from 'next/link'
import { startTransition, useEffect, useRef, useState, type FormEvent } from 'react'
import { useActionState } from 'react'
import { useRouter } from 'next/navigation'
import Modal from '../../../../components/ui/Modal'
import Toast from '../../../../components/ui/Toast'
import LoadingOverlay from '../../../../components/ui/LoadingOverlay'
import DangerDeleteButton from '../../../../components/dashboard/DangerDeleteButton'
import { useToast } from '../../../../lib/hooks/useToast'
import { deactivateEmployee, deleteEmployee, transferEmployee, type FormState } from './actions'
import type { BranchRow, EmployeeRow } from './types'

/**
 * Props for the employee row action cluster.
 */
type Props = {
  employee: EmployeeRow
  branches: BranchRow[]
}

/**
 * EmployeeRowActions renders per-employee activity, transfer, and deactivate controls.
 */
export default function EmployeeRowActions({ employee, branches }: Props) {
  const router = useRouter()
  const [transferOpen, setTransferOpen] = useState(false)
  const [statusOpen, setStatusOpen] = useState(false)
  const [destinationBranchId, setDestinationBranchId] = useState('')
  const { toast, toastState, dismiss } = useToast()

  const [transferState, transferAction, transferPending] = useActionState<FormState, FormData>(transferEmployee, {
    error: null,
    success: false,
  })
  const [deactivateState, deactivateAction, deactivatePending] = useActionState<FormState, FormData>(deactivateEmployee, {
    error: null,
    success: false,
  })
  const previousTransferPending = useRef(transferPending)
  const previousDeactivatePending = useRef(deactivatePending)
  const destinationBranches = branches.filter((branch) => branch.id !== employee.assignedBranchId)

  /**
   * Handles transfer action results after the transition finishes.
   */
  useEffect(() => {
    let resetTimer: ReturnType<typeof setTimeout> | null = null

    if (previousTransferPending.current && !transferPending) {
      if (transferState.success) {
        toast.success('Employee transfer requested')
        router.refresh()
        resetTimer = setTimeout(() => {
          setTransferOpen(false)
          setDestinationBranchId('')
        }, 0)
      } else if (transferState.error) {
        toast.error(transferState.error)
      }
    }

    previousTransferPending.current = transferPending
    return () => {
      if (resetTimer) {
        clearTimeout(resetTimer)
      }
    }
  }, [router, toast, transferPending, transferState.error, transferState.success])

  /**
   * Handles deactivation action results after the transition finishes.
   */
  useEffect(() => {
    if (previousDeactivatePending.current && !deactivatePending) {
      if (deactivateState.success) {
        toast.success(employee.is_active ? 'Employee deactivated' : 'Employee activated')
        router.refresh()
      } else if (deactivateState.error) {
        toast.error(deactivateState.error)
      }
    }

    previousDeactivatePending.current = deactivatePending
  }, [deactivatePending, deactivateState.error, deactivateState.success, employee.is_active, router, toast])

  /**
   * Opens the transfer modal with a sensible default destination.
   */
  const openTransferModal = () => {
    setDestinationBranchId(destinationBranches[0]?.id ?? '')
    setTransferOpen(true)
  }

  /**
   * Submits a pending transfer request.
   */
  const onTransferSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const formData = new FormData()
    formData.set('userId', employee.id)
    formData.set('fromBranchId', employee.assignedBranchId ?? '')
    formData.set('toBranchId', destinationBranchId)

    startTransition(() => {
      transferAction(formData)
    })
  }

  /**
   * Confirms employee deactivation.
   */
  const onDeactivateConfirm = () => {
    const formData = new FormData()
    formData.set('userId', employee.id)
    formData.set('isActive', String(!employee.is_active))
    setStatusOpen(false)

    startTransition(() => {
      deactivateAction(formData)
    })
  }

  const transferDisabled = !employee.is_active || !employee.assignedBranchId || destinationBranches.length === 0

  return (
    <>
      {(transferPending || deactivatePending) && (
        <LoadingOverlay
          message={
            transferPending
              ? 'Requesting transfer...'
              : employee.is_active
                ? 'Deactivating employee...'
                : 'Activating employee...'
          }
        />
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
          href={`/dashboard/owner/transactions?employee=${employee.id}`}
          className="btn-outline"
          style={{ padding: '5px 14px', borderRadius: 8, fontSize: 12 }}
        >
          View activity
        </Link>
        <button
          type="button"
          className="btn-primary"
          disabled={transferDisabled}
          style={{ padding: '5px 14px', borderRadius: 8, fontSize: 12, opacity: transferDisabled ? 0.65 : 1 }}
          onClick={openTransferModal}
        >
          Transfer
        </button>
        <button
          type="button"
          className={employee.is_active ? 'btn-danger' : 'btn-success'}
          style={{ padding: '5px 14px', borderRadius: 8, fontSize: 12 }}
          onClick={() => setStatusOpen(true)}
        >
          {employee.is_active ? 'Deactivate' : 'Activate'}
        </button>
        <DangerDeleteButton
          entityLabel="Employee"
          entityName={employee.name}
          idField="userId"
          idValue={employee.id}
          action={deleteEmployee}
        />
      </div>

      <Modal isOpen={transferOpen} title="Transfer employee" onClose={() => setTransferOpen(false)}>
        <form onSubmit={onTransferSubmit}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: 0 }}>
              Move {employee.name} from {employee.assignedBranchName ?? 'their current branch'} to another branch.
            </p>

            <label style={{ fontSize: 13, display: 'block' }}>
              <span style={{ display: 'block', marginBottom: 6, fontWeight: 500, color: 'var(--color-text-primary)' }}>
                Destination branch
              </span>
              <select
                value={destinationBranchId}
                onChange={(event) => setDestinationBranchId(event.target.value)}
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
                {destinationBranches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
              </select>
            </label>

            {transferState.error && (
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
                {transferState.error}
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
              <button
                type="submit"
                disabled={transferPending || !destinationBranchId}
                className="btn-primary"
                style={{
                  flex: 1,
                  padding: '10px 20px',
                  borderRadius: 8,
                  opacity: transferPending || !destinationBranchId ? 0.8 : 1,
                }}
              >
                {transferPending ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                    </svg>
                    Requesting transfer...
                  </span>
                ) : (
                  'Request transfer'
                )}
              </button>

              <button
                type="button"
                className="btn-outline"
                style={{ flex: 1, padding: '10px 20px', borderRadius: 8 }}
                onClick={() => setTransferOpen(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={statusOpen}
        title={employee.is_active ? 'Deactivate employee' : 'Activate employee'}
        onClose={() => setStatusOpen(false)}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: 0 }}>
            Are you sure you want to {employee.is_active ? 'deactivate' : 'activate'} {employee.name}?
          </p>

          {deactivateState.error && (
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
              {deactivateState.error}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10 }}>
            <button
              type="button"
              className={employee.is_active ? 'btn-danger' : 'btn-success'}
              disabled={deactivatePending}
              style={{ flex: 1, padding: '10px 20px', borderRadius: 8, opacity: deactivatePending ? 0.8 : 1 }}
              onClick={onDeactivateConfirm}
            >
              {deactivatePending ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                  </svg>
                  {employee.is_active ? 'Deactivating...' : 'Activating...'}
                </span>
              ) : (
                employee.is_active ? 'Deactivate' : 'Activate'
              )}
            </button>
            <button
              type="button"
              className="btn-outline"
              style={{ flex: 1, padding: '10px 20px', borderRadius: 8 }}
              onClick={() => setStatusOpen(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      </Modal>
    </>
  )
}
