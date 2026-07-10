/**
 * Reusable spreadsheet import/export controls for dashboard resources.
 *
 * Provides consistent Retivox-styled buttons, upload modal, loading state,
 * and success/error messaging for bulk XLSX/CSV imports.
 */
'use client'

import { startTransition, useEffect, useRef, useState, type FormEvent } from 'react'
import { useActionState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import Modal from '../ui/Modal'

/**
 * Standard server action state for spreadsheet imports.
 */
export type SpreadsheetImportState = {
  error: string | null
  success: boolean
  message?: string
}

type SpreadsheetToolsProps = {
  entityLabel: string
  exportHref: string
  templateHref: string
  importAction: (prevState: SpreadsheetImportState, formData: FormData) => Promise<SpreadsheetImportState>
}

/**
 * Small spinner used inside import submit buttons.
 */
function Spinner() {
  return (
    <svg aria-hidden className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="4" />
      <path d="M22 12a10 10 0 00-10-10" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
    </svg>
  )
}

/**
 * Renders import/export controls for one endpoint.
 */
export default function SpreadsheetTools({
  entityLabel,
  exportHref,
  templateHref,
  importAction,
}: SpreadsheetToolsProps) {
  const router = useRouter()
  const formRef = useRef<HTMLFormElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const successHandled = useRef(false)
  const [open, setOpen] = useState(false)
  const [clientError, setClientError] = useState<string | null>(null)
  const [state, action, isPending] = useActionState<SpreadsheetImportState, FormData>(importAction, {
    error: null,
    success: false,
  })

  useEffect(() => {
    if (state.success && !successHandled.current) {
      successHandled.current = true
      window.setTimeout(() => {
        setOpen(false)
        formRef.current?.reset()
        router.refresh()
      }, 0)
    }
  }, [router, state.success])

  /**
   * Opens the upload modal and clears stale state guards.
   */
  const openModal = () => {
    successHandled.current = false
    setClientError(null)
    setOpen(true)
  }

  /**
   * Submits the upload through useActionState inside a transition.
   */
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!event.currentTarget.reportValidity()) {
      return
    }

    const selectedFile = fileInputRef.current?.files?.[0]

    if (!selectedFile || selectedFile.size === 0) {
      setClientError('Please choose an XLSX or CSV file before importing.')
      return
    }

    setClientError(null)
    const formData = new FormData(event.currentTarget)

    startTransition(() => {
      action(formData)
    })
  }

  return (
    <>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <button
          type="button"
          className="btn-outline"
          style={{ padding: '8px 16px', borderRadius: 8 }}
          onClick={openModal}
        >
          Import spreadsheet
        </button>
        <Link href={exportHref} className="btn-outline" style={{ padding: '8px 16px', borderRadius: 8 }}>
          Download spreadsheet
        </Link>
      </div>

      <Modal isOpen={open} title={`Import ${entityLabel}`} onClose={() => setOpen(false)}>
        <form ref={formRef} onSubmit={onSubmit} className="flex flex-col gap-4">
          <div
            className="rounded-xl border"
            style={{
              borderColor: 'var(--color-border)',
              backgroundColor: 'var(--color-background)',
              padding: 16,
            }}
          >
            <p style={{ margin: 0, fontSize: 14, color: 'var(--color-text-primary)', fontWeight: 600 }}>
              Upload an XLSX or CSV file
            </p>
            <p style={{ marginTop: 6, marginBottom: 0, fontSize: 13, color: 'var(--color-text-muted)' }}>
              Use the template so headers match exactly. The import validates every row before creating records.
            </p>
            <Link
              href={templateHref}
              className="btn-outline"
              style={{ display: 'inline-flex', marginTop: 12, padding: '5px 14px', borderRadius: 8 }}
            >
              Download template
            </Link>
          </div>

          <label className="flex flex-col gap-2" style={{ fontSize: 13, color: 'var(--color-text-primary)' }}>
            Spreadsheet file
            <input
              name="file"
              type="file"
              ref={fileInputRef}
              accept=".xlsx,.csv"
              required
              onChange={() => setClientError(null)}
              style={{
                height: 44,
                border: '1px solid var(--color-border)',
                borderRadius: 8,
                padding: '9px 12px',
                backgroundColor: 'var(--color-background)',
                color: 'var(--color-text-primary)',
              }}
            />
          </label>

          {state.error && (
            <p style={{ margin: 0, fontSize: 13, color: 'var(--color-danger)' }}>
              {state.error}
            </p>
          )}
          {clientError && (
            <p style={{ margin: 0, fontSize: 13, color: 'var(--color-danger)' }}>
              {clientError}
            </p>
          )}
          {state.success && (
            <p style={{ margin: 0, fontSize: 13, color: 'var(--color-success)' }}>
              {state.message ?? `${entityLabel} imported successfully.`}
            </p>
          )}

          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              className="btn-outline"
              style={{ padding: '8px 16px', borderRadius: 8 }}
              onClick={() => setOpen(false)}
              disabled={isPending}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary"
              style={{ padding: '10px 20px', borderRadius: 8, display: 'inline-flex', alignItems: 'center', gap: 8 }}
              disabled={isPending}
            >
              {isPending ? (
                <>
                  <Spinner />
                  Importing {entityLabel.toLowerCase()}...
                </>
              ) : (
                `Import ${entityLabel}`
              )}
            </button>
          </div>
        </form>
      </Modal>
    </>
  )
}
