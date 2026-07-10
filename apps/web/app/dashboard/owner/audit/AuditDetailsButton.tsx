/**
 * Client-side audit details button.
 *
 * Opens a modal with the full immutable audit row details when table summaries
 * are too compact to show everything.
 */
'use client'

import { useState } from 'react'
import Modal from '../../../../components/ui/Modal'
import type { AuditLogView, JsonValue } from './types'

type Props = {
  log: AuditLogView
}

/**
 * Pretty-prints JSONB values for the modal.
 */
function formatJson(value: JsonValue) {
  return JSON.stringify(value, null, 2)
}

/**
 * Renders one labeled details block.
 */
function DetailBlock({ title, value }: { title: string; value: string }) {
  return (
    <div className="flex flex-col gap-2">
      <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)' }}>{title}</p>
      <pre
        style={{
          margin: 0,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          border: '1px solid var(--color-border)',
          borderRadius: 8,
          backgroundColor: 'var(--color-background)',
          color: 'var(--color-text-primary)',
          padding: 12,
          fontSize: 12,
          lineHeight: 1.5,
        }}
      >
        {value}
      </pre>
    </div>
  )
}

/**
 * Opens the full audit details modal.
 */
export default function AuditDetailsButton({ log }: Props) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        className="btn-outline"
        style={{ padding: '5px 14px', borderRadius: 8 }}
        onClick={() => setOpen(true)}
      >
        See more
      </button>

      <Modal isOpen={open} title="Audit details" onClose={() => setOpen(false)}>
        <div className="flex flex-col gap-4">
          <div
            className="rounded-xl border"
            style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-background)', padding: 14 }}
          >
            <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)' }}>
              {log.action} {log.entity_type}
            </p>
            <p style={{ marginTop: 6, marginBottom: 0, fontSize: 13, color: 'var(--color-text-muted)' }}>
              Actor: {log.actor_name} {log.actor_email ? `(${log.actor_email})` : ''}
            </p>
            <p style={{ marginTop: 6, marginBottom: 0, fontSize: 13, color: 'var(--color-text-muted)' }}>
              Entity ID: {log.entity_id}
            </p>
          </div>

          <DetailBlock title="Old value" value={formatJson(log.old_value)} />
          <DetailBlock title="New value" value={formatJson(log.new_value)} />
        </div>
      </Modal>
    </>
  )
}
