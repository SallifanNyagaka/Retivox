'use client'
/**
 * Row-level actions for an admin account.
 *
 * The component contains the edit-branches, transfer, and deactivate flows,
 * each backed by a separate server action and confirmation or modal step.
 */

import { startTransition, useEffect, useMemo, useRef, useState } from 'react'
import { useActionState } from 'react'
import { useRouter } from 'next/navigation'
import Modal from '../../../../components/ui/Modal'
import Toast from '../../../../components/ui/Toast'
import LoadingOverlay from '../../../../components/ui/LoadingOverlay'
import DangerDeleteButton from '../../../../components/dashboard/DangerDeleteButton'
import { useToast } from '../../../../lib/hooks/useToast'
import { deactivateAdminAction, deleteAdmin, transferAdmin, updateAdminBranches, type FormState } from './actions'
import type { AdminRow, BranchRow } from './types'

/**
 * Props for the admin row action buttons.
 */
type Props = {
  admin: AdminRow
  branches: BranchRow[]
  availableBranches: BranchRow[]
}

/**
 * AdminRowActions renders the buttons and modals for one admin row.
 */
export default function AdminRowActions({ admin, branches, availableBranches }: Props) {
  const router = useRouter()
  const [editOpen, setEditOpen] = useState(false)
  const [transferOpen, setTransferOpen] = useState(false)
  const [statusOpen, setStatusOpen] = useState(false)
  const [selectedBranchIds, setSelectedBranchIds] = useState<string[]>(admin.assignedBranchIds)
  const [fromBranchId, setFromBranchId] = useState(admin.assignedBranchIds[0] ?? '')
  const [toBranchId, setToBranchId] = useState(availableBranches[0]?.id ?? '')

  const { toast, toastState, dismiss } = useToast()
  const [editState, editAction, editPending] = useActionState<FormState, FormData>(updateAdminBranches, {
    error: null,
    success: false,
  })
  const [transferState, transferAction, transferPending] = useActionState<FormState, FormData>(transferAdmin, {
    error: null,
    success: false,
  })
  const [deactivateState, deactivateAction, deactivatePending] = useActionState<FormState, FormData>(
    deactivateAdminAction,
    {
      error: null,
      success: false,
    }
  )

  const previousEditPending = useRef(editPending)
  const previousTransferPending = useRef(transferPending)
  const previousDeactivatePending = useRef(deactivatePending)

  /**
   * Limits edit options to current assignments plus branches that are still open.
   */
  const selectableBranches = useMemo(() => {
    const allowedIds = new Set([...admin.assignedBranchIds, ...availableBranches.map((branch) => branch.id)])
    return branches.filter((branch) => allowedIds.has(branch.id))
  }, [admin.assignedBranchIds, availableBranches, branches])

  /**
   * Limits destination branches to open branches that are not the source branch.
   */
  const destinationBranches = useMemo(() => {
    return availableBranches.filter((branch) => branch.id !== fromBranchId)
  }, [availableBranches, fromBranchId])

  /**
   * Shows completion feedback for the edit-branches flow.
   */
  useEffect(() => {
    let resetTimer: ReturnType<typeof setTimeout> | null = null

    if (previousEditPending.current && !editPending) {
      if (editState.success) {
        toast.success('Admin branches updated')
        router.refresh()
        resetTimer = setTimeout(() => {
          setEditOpen(false)
        }, 0)
      } else if (editState.error) {
        toast.error(editState.error)
      }
    }

    previousEditPending.current = editPending
    return () => {
      if (resetTimer) {
        clearTimeout(resetTimer)
      }
    }
  }, [editPending, editState.error, editState.success, router, toast])

  /**
   * Shows completion feedback for the transfer flow.
   */
  useEffect(() => {
    let resetTimer: ReturnType<typeof setTimeout> | null = null

    if (previousTransferPending.current && !transferPending) {
      if (transferState.success) {
        toast.success('Admin transfer recorded')
        router.refresh()
        resetTimer = setTimeout(() => {
          setTransferOpen(false)
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
   * Shows completion feedback for the deactivate flow.
   */
  useEffect(() => {
    if (previousDeactivatePending.current && !deactivatePending) {
      if (deactivateState.success) {
        toast.success(admin.is_active ? 'Admin deactivated' : 'Admin activated')
        router.refresh()
      } else if (deactivateState.error) {
        toast.error(deactivateState.error)
      }
    }

    previousDeactivatePending.current = deactivatePending
  }, [admin.is_active, deactivatePending, deactivateState.error, deactivateState.success, router, toast])

  /**
   * Opens the edit-branches modal with the current branch assignments.
   */
  const openEditModal = () => {
    setSelectedBranchIds(admin.assignedBranchIds)
    setEditOpen(true)
  }

  /**
   * Opens the transfer modal with sensible defaults.
   */
  const openTransferModal = () => {
    const currentSource = admin.assignedBranchIds[0] ?? ''
    const currentDestination = availableBranches.find((branch) => branch.id !== currentSource)?.id ?? ''

    setFromBranchId(currentSource)
    setToBranchId(currentDestination)
    setTransferOpen(true)
  }

  /**
   * Handles the edit-branches form submit.
   */
  const onEditSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const formData = new FormData()
    formData.set('userId', admin.id)
    selectedBranchIds.forEach((branchId) => {
      formData.append('branchIds', branchId)
    })

    startTransition(() => {
      editAction(formData)
    })
  }

  /**
   * Handles the transfer form submit.
   */
  const onTransferSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const formData = new FormData()
    formData.set('userId', admin.id)
    formData.set('fromBranchId', fromBranchId)
    formData.set('toBranchId', toBranchId)

    startTransition(() => {
      transferAction(formData)
    })
  }

  /**
   * Handles the deactivate confirmation submit.
   */
  const onDeactivateSubmit = () => {
    const formData = new FormData()
    formData.set('userId', admin.id)
    formData.set('isActive', String(!admin.is_active))
    setStatusOpen(false)

    startTransition(() => {
      deactivateAction(formData)
    })
  }

  /**
   * Toggles branch selection in the edit modal.
   */
  const toggleBranch = (branchId: string) => {
    setSelectedBranchIds((current) =>
      current.includes(branchId) ? current.filter((id) => id !== branchId) : [...current, branchId]
    )
  }

  /**
   * Updates the source branch and refreshes the destination pickers.
   */
  const handleSourceBranchChange = (value: string) => {
    setFromBranchId(value)
    setToBranchId(availableBranches.find((branch) => branch.id !== value)?.id ?? '')
  }

  const isAdminLocked = admin.global_role === 'owner'

  return (
    <div className="flex flex-wrap gap-2">
      {toastState && (
        <Toast
          message={toastState.message}
          type={toastState.type}
          duration={toastState.duration}
          onDismiss={dismiss}
        />
      )}

      {editPending && <LoadingOverlay message="Updating branches..." />}
      {transferPending && <LoadingOverlay message="Transferring admin..." />}
      {deactivatePending && (
        <LoadingOverlay message={admin.is_active ? 'Deactivating admin...' : 'Activating admin...'} />
      )}

      <button
        type="button"
        className="btn-outline"
        style={{ padding: '5px 14px', borderRadius: 8 }}
        onClick={openEditModal}
        disabled={isAdminLocked}
      >
        Edit branches
      </button>
      <button
        type="button"
        className="btn-primary"
        style={{ padding: '5px 14px', borderRadius: 8 }}
        onClick={openTransferModal}
        disabled={isAdminLocked || admin.assignedBranchIds.length === 0 || availableBranches.length === 0}
      >
        Transfer
      </button>
      <button
        type="button"
        className={admin.is_active ? 'btn-danger' : 'btn-success'}
        style={{ padding: '5px 14px', borderRadius: 8 }}
        onClick={() => setStatusOpen(true)}
        disabled={isAdminLocked}
      >
        {admin.is_active ? 'Deactivate' : 'Activate'}
      </button>
      {!isAdminLocked && (
        <DangerDeleteButton
          entityLabel="Admin"
          entityName={admin.name}
          idField="userId"
          idValue={admin.id}
          action={deleteAdmin}
        />
      )}

      <Modal isOpen={editOpen} title="Edit branches" onClose={() => setEditOpen(false)}>
        <form onSubmit={onEditSubmit}>
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
            <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: 0 }}>
              Select the branches this admin should manage.
            </p>

            {selectableBranches.length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: 0 }}>
                No selectable branches are available right now.
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {selectableBranches.map((branch) => {
                  const checked = selectedBranchIds.includes(branch.id)
                  const isCurrent = admin.assignedBranchIds.includes(branch.id)

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
                      <span style={{ color: 'var(--color-text-primary)' }}>
                        {branch.name}
                        {isCurrent ? ' (current)' : ''}
                      </span>
                    </label>
                  )
                })}
              </div>
            )}

            {editState.error && (
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
                {editState.error}
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
              <button
                type="submit"
                disabled={editPending}
                className="btn-primary"
                style={{
                  flex: 1,
                  padding: '10px 20px',
                  borderRadius: 8,
                  opacity: editPending ? 0.8 : 1,
                }}
              >
                {editPending ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                    </svg>
                    Updating branches...
                  </span>
                ) : (
                  'Save changes'
                )}
              </button>
              <button
                type="button"
                className="btn-outline"
                style={{ flex: 1, padding: '10px 20px', borderRadius: 8 }}
                onClick={() => setEditOpen(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </form>
      </Modal>

      <Modal isOpen={transferOpen} title="Transfer admin" onClose={() => setTransferOpen(false)}>
        <form onSubmit={onTransferSubmit}>
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
            <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: 0 }}>
              Move a single branch assignment from one location to another.
            </p>

            <label style={{ fontSize: 13, display: 'block' }}>
              <span style={{ display: 'block', marginBottom: 6, fontWeight: 500, color: 'var(--color-text-primary)' }}>
                From branch
              </span>
              <select
                value={fromBranchId}
                onChange={(event) => handleSourceBranchChange(event.target.value)}
                required
                style={{
                  width: '100%',
                  height: 44,
                  border: '1px solid var(--color-border)',
                  borderRadius: 8,
                  padding: '0 12px',
                  boxSizing: 'border-box',
                  fontSize: 13,
                  backgroundColor: 'var(--color-background)',
                  color: 'var(--color-text-primary)',
                }}
              >
                <option value="">Select source branch</option>
                {admin.assignedBranchIds.map((branchId) => (
                  <option key={branchId} value={branchId}>
                    {branches.find((branch) => branch.id === branchId)?.name ?? branchId}
                  </option>
                ))}
              </select>
            </label>

            <label style={{ fontSize: 13, display: 'block' }}>
              <span style={{ display: 'block', marginBottom: 6, fontWeight: 500, color: 'var(--color-text-primary)' }}>
                To branch
              </span>
              <select
                value={toBranchId}
                onChange={(event) => setToBranchId(event.target.value)}
                required
                style={{
                  width: '100%',
                  height: 44,
                  border: '1px solid var(--color-border)',
                  borderRadius: 8,
                  padding: '0 12px',
                  boxSizing: 'border-box',
                  fontSize: 13,
                  backgroundColor: 'var(--color-background)',
                  color: 'var(--color-text-primary)',
                }}
              >
                <option value="">Select destination branch</option>
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
                disabled={transferPending || !fromBranchId || !toBranchId}
                className="btn-primary"
                style={{
                  flex: 1,
                  padding: '10px 20px',
                  borderRadius: 8,
                  opacity: transferPending || !fromBranchId || !toBranchId ? 0.8 : 1,
                }}
              >
                {transferPending ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                    </svg>
                    Transferring admin...
                  </span>
                ) : (
                  'Transfer'
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
        title={admin.is_active ? 'Deactivate admin' : 'Activate admin'}
        onClose={() => setStatusOpen(false)}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <p style={{ fontSize: 13, color: 'var(--color-text-primary)', margin: 0 }}>
            Are you sure you want to {admin.is_active ? 'deactivate' : 'activate'} {admin.name}?
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
              disabled={deactivatePending}
              className={admin.is_active ? 'btn-danger' : 'btn-success'}
              style={{
                flex: 1,
                padding: '10px 20px',
                borderRadius: 8,
                opacity: deactivatePending ? 0.8 : 1,
              }}
              onClick={onDeactivateSubmit}
            >
              {deactivatePending ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                  </svg>
                  {admin.is_active ? 'Deactivating admin...' : 'Activating admin...'}
                </span>
              ) : (
                admin.is_active ? 'Deactivate' : 'Activate'
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
    </div>
  )
}
