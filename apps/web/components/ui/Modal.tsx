/**
 * Reusable Modal component for Retivox
 *
 * Provides a simple accessible modal with backdrop. Client component used by
 * forms and confirmation dialogs across the dashboard.
 */
'use client'

import { ReactNode, useEffect } from 'react'

type ModalProps = {
  isOpen: boolean
  title?: string
  children: ReactNode
  onClose: () => void
}

/**
 * Modal component
 */
export default function Modal({ isOpen, title, children, onClose }: ModalProps) {
  useEffect(() => {
    if (!isOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 60 }}>
      <div
        onClick={onClose}
        aria-hidden
        style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)' }}
      />

      <div
        role="dialog"
        aria-modal="true"
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          transform: 'translate(-50%, -50%)',
          background: 'white',
          borderRadius: 'var(--radius-card)',
          boxShadow: 'var(--shadow-modal)',
          maxWidth: 560,
          maxHeight: 'calc(100vh - 32px)',
          width: 'calc(100% - 32px)',
          padding: 24,
          overflow: 'hidden',
        }}
      >
        <div className="flex items-start justify-between">
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{title}</h2>
          <button
            type="button"
            aria-label="Close modal"
            onClick={onClose}
            className="btn-outline"
            style={{ padding: '5px 14px', borderRadius: 8 }}
          >
            ✕
          </button>
        </div>

        <div
          style={{
            marginTop: 12,
            maxHeight: 'calc(100vh - 132px)',
            overflowY: 'auto',
            paddingRight: 4,
          }}
        >
          {children}
        </div>
      </div>
    </div>
  )
}
