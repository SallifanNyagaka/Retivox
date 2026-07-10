'use client'
/**
 * Client actions for a product row: edit and toggle active status.
 */

import { startTransition, useEffect, useRef, useState } from 'react'
import { useActionState } from 'react'
import { useRouter } from 'next/navigation'
import Modal from '../../../../components/ui/Modal'
import LoadingOverlay from '../../../../components/ui/LoadingOverlay'
import DangerDeleteButton from '../../../../components/dashboard/DangerDeleteButton'
import { deleteProduct, toggleProductStatus, type FormState } from './actions'

type Props = {
  productId: string
  productName: string
  isActive: boolean
  onEdit: () => void
}

export default function ProductRowActions({ productId, productName, isActive, onEdit }: Props) {
  const router = useRouter()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [state, action, isPending] = useActionState<FormState, FormData>(toggleProductStatus, {
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
      if (resetTimer) {
        clearTimeout(resetTimer)
      }
    }
  }, [isPending, router, state.error, state.success])

  const onConfirm = () => {
    const formData = new FormData()
    formData.set('productId', productId)
    formData.set('isActive', String(!isActive))
    startTransition(() => {
      action(formData)
    })
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        className="btn-outline"
        style={{ padding: '6px 14px', borderRadius: 8 }}
        onClick={onEdit}
      >
        Edit
      </button>
      <button
        type="button"
        className={isActive ? 'btn-danger' : 'btn-success'}
        style={{ padding: '6px 14px', borderRadius: 8 }}
        onClick={() => setConfirmOpen(true)}
      >
        {isActive ? 'Deactivate' : 'Activate'}
      </button>
      <DangerDeleteButton
        entityLabel="Product"
        entityName={productName}
        idField="productId"
        idValue={productId}
        action={deleteProduct}
      />

      {isPending && (
        <LoadingOverlay message={isActive ? 'Deactivating product...' : 'Activating product...'} />
      )}

      <Modal
        title={isActive ? 'Deactivate product' : 'Activate product'}
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
      >
        <p style={{ marginBottom: 12 }}>
          Are you sure you want to {isActive ? 'deactivate' : 'activate'} this product?
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            className={isActive ? 'btn-danger' : 'btn-success'}
            disabled={isPending}
            style={{ padding: '8px 16px', borderRadius: 8, opacity: isPending ? 0.8 : 1 }}
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
          <button
            type="button"
            className="btn-outline"
            style={{ padding: '8px 16px', borderRadius: 8 }}
            onClick={() => setConfirmOpen(false)}
          >
            Cancel
          </button>
        </div>
        {state.error && <p style={{ color: 'var(--color-danger)', marginTop: 8 }}>{state.error}</p>}
      </Modal>
    </div>
  )
}
