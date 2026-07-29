'use client'

import { startTransition, useEffect, useRef, useState, type FormEvent } from 'react'
import { useActionState } from 'react'
import { useRouter } from 'next/navigation'
import Modal from '../../../../components/ui/Modal'
import LoadingOverlay from '../../../../components/ui/LoadingOverlay'
import Toast from '../../../../components/ui/Toast'
import { Badge } from '../../../../components/ui/Badge'
import { useToast } from '../../../../lib/hooks/useToast'
import type { SupplierDirectoryRow } from '../stock/types'
import { saveSupplier, toggleSupplierStatus, type SupplierFormState } from './actions'

type Props = {
  role: 'owner' | 'admin'
  suppliers: SupplierDirectoryRow[]
}

const inputStyle = {
  width: '100%',
  height: 44,
  border: '1px solid var(--color-border)',
  borderRadius: 8,
  padding: '0 12px',
  boxSizing: 'border-box' as const,
  fontSize: 13,
  color: 'var(--color-text-primary)',
  backgroundColor: 'var(--color-background)',
}

function formatDateTime(isoDate: string | null) {
  if (!isoDate) {
    return '-'
  }

  return new Date(isoDate).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatRating(value: number | null) {
  return value ? `${value.toFixed(1)} / 5` : 'Not rated'
}

function emptySupplier(): SupplierDirectoryRow {
  return {
    id: '',
    name: '',
    phone: null,
    email: null,
    contact_person: null,
    notes: null,
    is_active: true,
    supply_count: 0,
    product_count: 0,
    branch_count: 0,
    average_price_rating: null,
    average_stock_quality_rating: null,
    average_availability_rating: null,
    average_score: null,
    last_supplied_at: null,
  }
}

export default function SuppliersPageClient({ role, suppliers }: Props) {
  const router = useRouter()
  const { toast, toastState, dismiss } = useToast()
  const [modalOpen, setModalOpen] = useState(false)
  const [editingSupplier, setEditingSupplier] = useState<SupplierDirectoryRow>(emptySupplier())
  const [saveState, saveAction, savePending] = useActionState<SupplierFormState, FormData>(saveSupplier, {
    success: false,
    error: null,
  })
  const [toggleState, toggleAction, togglePending] = useActionState<SupplierFormState, FormData>(toggleSupplierStatus, {
    success: false,
    error: null,
  })
  const previousSavePending = useRef(savePending)
  const previousTogglePending = useRef(togglePending)

  useEffect(() => {
    if (previousSavePending.current && !savePending) {
      if (saveState.success) {
        toast.success('Supplier saved')
        setModalOpen(false)
        setEditingSupplier(emptySupplier())
        router.refresh()
      } else if (saveState.error) {
        toast.error(saveState.error)
      }
    }

    previousSavePending.current = savePending
  }, [router, savePending, saveState.error, saveState.success, toast])

  useEffect(() => {
    if (previousTogglePending.current && !togglePending) {
      if (toggleState.success) {
        toast.success('Supplier status updated')
        router.refresh()
      } else if (toggleState.error) {
        toast.error(toggleState.error)
      }
    }

    previousTogglePending.current = togglePending
  }, [router, toast, togglePending, toggleState.error, toggleState.success])

  const openCreate = () => {
    setEditingSupplier(emptySupplier())
    setModalOpen(true)
  }

  const openEdit = (supplier: SupplierDirectoryRow) => {
    setEditingSupplier(supplier)
    setModalOpen(true)
  }

  const submitSupplier = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)

    startTransition(() => {
      saveAction(formData)
    })
  }

  return (
    <>
      {(savePending || togglePending) && <LoadingOverlay message={savePending ? 'Saving supplier...' : 'Updating supplier...'} />}
      {toastState && <Toast message={toastState.message} type={toastState.type} onDismiss={dismiss} duration={toastState.duration} />}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <MetricCard label="Suppliers" value={String(suppliers.length)} />
        <MetricCard label="Active" value={String(suppliers.filter((supplier) => supplier.is_active).length)} />
        <MetricCard label="Rated" value={String(suppliers.filter((supplier) => supplier.average_score).length)} />
      </div>

      <div className="flex flex-col gap-3 rounded-xl sm:flex-row sm:items-center sm:justify-between" style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)', padding: 18 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: 'var(--color-text-primary)' }}>Supplier directory</h2>
          <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--color-text-muted)' }}>
            {role === 'admin' ? 'Maintain supplier contacts for your managed stores.' : 'Maintain supplier contacts across your business.'} Stock deliveries can reference these suppliers without asking for contacts every time.
          </p>
        </div>
        <button type="button" className="btn-primary" style={{ borderRadius: 8, padding: '10px 16px' }} onClick={openCreate}>
          Add supplier
        </button>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', minWidth: 960, borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
              {['Supplier', 'Contact', 'Score', 'Price', 'Quality', 'Availability', 'Coverage', 'Last supply', 'Action'].map((heading) => (
                <th key={heading} style={{ padding: 12, textAlign: 'left', color: 'var(--color-text-muted)', fontSize: 12 }}>
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {suppliers.length === 0 ? (
              <tr>
                <td colSpan={9} style={{ padding: 24, textAlign: 'center', color: 'var(--color-text-muted)' }}>
                  No suppliers yet. Add one here or record a stock delivery with a supplier name.
                </td>
              </tr>
            ) : (
              suppliers.map((supplier, index) => (
                <tr key={supplier.id} style={{ backgroundColor: index % 2 === 0 ? 'var(--color-background)' : 'var(--color-surface)' }}>
                  <td style={{ padding: 12, color: 'var(--color-text-primary)', fontWeight: 800 }}>
                    {supplier.name}
                    <span style={{ display: 'block', marginTop: 5 }}>
                      <Badge variant={supplier.is_active ? 'success' : 'muted'}>{supplier.is_active ? 'Active' : 'Inactive'}</Badge>
                    </span>
                    {supplier.notes && (
                      <span style={{ display: 'block', marginTop: 5, color: 'var(--color-text-muted)', fontSize: 12, fontWeight: 500 }}>
                        {supplier.notes}
                      </span>
                    )}
                  </td>
                  <td style={{ padding: 12, color: 'var(--color-text-muted)' }}>
                    <span style={{ display: 'block', color: 'var(--color-text-primary)', fontWeight: 700 }}>{supplier.contact_person ?? 'No contact person'}</span>
                    <span style={{ display: 'block', marginTop: 4 }}>{supplier.phone ?? 'No phone'}</span>
                    <span style={{ display: 'block', marginTop: 4 }}>{supplier.email ?? 'No email'}</span>
                  </td>
                  <td style={{ padding: 12, color: supplier.average_score ? 'var(--color-success)' : 'var(--color-text-muted)', fontWeight: 800 }}>
                    {formatRating(supplier.average_score)}
                  </td>
                  <td style={{ padding: 12, color: 'var(--color-text-primary)' }}>{formatRating(supplier.average_price_rating)}</td>
                  <td style={{ padding: 12, color: 'var(--color-text-primary)' }}>{formatRating(supplier.average_stock_quality_rating)}</td>
                  <td style={{ padding: 12, color: 'var(--color-text-primary)' }}>{formatRating(supplier.average_availability_rating)}</td>
                  <td style={{ padding: 12, color: 'var(--color-text-muted)' }}>
                    <span style={{ display: 'block', color: 'var(--color-text-primary)', fontWeight: 700 }}>{supplier.supply_count} deliveries</span>
                    <span style={{ display: 'block', marginTop: 4 }}>{supplier.product_count} products, {supplier.branch_count} stores</span>
                  </td>
                  <td style={{ padding: 12, color: 'var(--color-text-primary)' }}>{formatDateTime(supplier.last_supplied_at)}</td>
                  <td style={{ padding: 12 }}>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" className="btn-outline" style={{ borderRadius: 8, padding: '7px 12px', fontSize: 12 }} onClick={() => openEdit(supplier)}>
                        Edit
                      </button>
                      <form action={toggleAction}>
                        <input type="hidden" name="supplierId" value={supplier.id} />
                        <input type="hidden" name="name" value={supplier.name} />
                        <input type="hidden" name="phone" value={supplier.phone ?? ''} />
                        <input type="hidden" name="email" value={supplier.email ?? ''} />
                        <input type="hidden" name="contactPerson" value={supplier.contact_person ?? ''} />
                        <input type="hidden" name="notes" value={supplier.notes ?? ''} />
                        <input type="hidden" name="isActive" value={supplier.is_active ? 'false' : 'true'} />
                        <button type="submit" className="btn-outline" style={{ borderRadius: 8, padding: '7px 12px', fontSize: 12 }} disabled={togglePending}>
                          {supplier.is_active ? 'Deactivate' : 'Activate'}
                        </button>
                      </form>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Modal isOpen={modalOpen} title={editingSupplier.id ? 'Edit supplier' : 'Add supplier'} onClose={() => setModalOpen(false)}>
        <form className="flex flex-col gap-4" onSubmit={submitSupplier}>
          <input type="hidden" name="supplierId" value={editingSupplier.id} />
          <input type="hidden" name="isActive" value={editingSupplier.is_active ? 'true' : 'false'} />

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <label style={{ fontSize: 13 }}>
              <span style={{ display: 'block', marginBottom: 6, fontWeight: 600, color: 'var(--color-text-primary)' }}>Supplier name</span>
              <input
                name="name"
                defaultValue={editingSupplier.name}
                required
                style={inputStyle}
              />
            </label>
            <label style={{ fontSize: 13 }}>
              <span style={{ display: 'block', marginBottom: 6, fontWeight: 600, color: 'var(--color-text-primary)' }}>Contact person</span>
              <input name="contactPerson" defaultValue={editingSupplier.contact_person ?? ''} style={inputStyle} />
            </label>
            <label style={{ fontSize: 13 }}>
              <span style={{ display: 'block', marginBottom: 6, fontWeight: 600, color: 'var(--color-text-primary)' }}>Phone</span>
              <input name="phone" defaultValue={editingSupplier.phone ?? ''} inputMode="tel" style={inputStyle} />
            </label>
            <label style={{ fontSize: 13 }}>
              <span style={{ display: 'block', marginBottom: 6, fontWeight: 600, color: 'var(--color-text-primary)' }}>Email</span>
              <input name="email" type="email" defaultValue={editingSupplier.email ?? ''} style={inputStyle} />
            </label>
          </div>

          <label style={{ fontSize: 13 }}>
            <span style={{ display: 'block', marginBottom: 6, fontWeight: 600, color: 'var(--color-text-primary)' }}>Notes</span>
            <textarea
              name="notes"
              defaultValue={editingSupplier.notes ?? ''}
              rows={4}
              style={{ ...inputStyle, height: 'auto', minHeight: 96, paddingTop: 10, resize: 'vertical' }}
            />
          </label>

          {saveState.error && <p style={{ margin: 0, color: 'var(--color-danger)', fontSize: 13 }}>{saveState.error}</p>}

          <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
            <button type="button" className="btn-outline" style={{ borderRadius: 8, padding: '10px 16px' }} onClick={() => setModalOpen(false)}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" style={{ borderRadius: 8, padding: '10px 16px' }} disabled={savePending}>
              {savePending ? 'Saving...' : 'Save supplier'}
            </button>
          </div>
        </form>
      </Modal>
    </>
  )
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-card)', backgroundColor: 'var(--color-surface)', padding: 16 }}>
      <p style={{ margin: 0, fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 600 }}>{label}</p>
      <p style={{ margin: '8px 0 0', fontSize: 28, color: 'var(--color-text-primary)', fontWeight: 800 }}>{value}</p>
    </div>
  )
}
