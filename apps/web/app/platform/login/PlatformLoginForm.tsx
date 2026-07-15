'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { loginPlatformUser, type PlatformLoginState } from './actions'

function SubmitButton() {
  const { pending } = useFormStatus()

  return (
    <button
      type="submit"
      disabled={pending}
      className="btn-primary"
      style={{ width: '100%', padding: '12px 18px', borderRadius: 10, opacity: pending ? 0.75 : 1 }}
    >
      {pending ? 'Signing in...' : 'Open platform console'}
    </button>
  )
}

const inputStyle = {
  width: '100%',
  height: 44,
  border: '1px solid var(--color-border)',
  borderRadius: 10,
  padding: '0 12px',
  boxSizing: 'border-box' as const,
  backgroundColor: 'var(--color-background)',
  color: 'var(--color-text-primary)',
}

export default function PlatformLoginForm() {
  const [state, formAction] = useActionState<PlatformLoginState, FormData>(loginPlatformUser, {
    success: false,
    error: null,
  })

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <label style={{ fontSize: 13, color: 'var(--color-text-primary)' }}>
        <span style={{ display: 'block', marginBottom: 6, fontWeight: 700 }}>Platform email</span>
        <input name="email" type="email" autoComplete="email" required style={inputStyle} />
      </label>

      <label style={{ fontSize: 13, color: 'var(--color-text-primary)' }}>
        <span style={{ display: 'block', marginBottom: 6, fontWeight: 700 }}>Password</span>
        <input name="password" type="password" autoComplete="current-password" required style={inputStyle} />
      </label>

      {state.error && (
        <div
          style={{
            border: '1px solid var(--color-danger)',
            backgroundColor: 'var(--color-danger-light)',
            color: 'var(--color-danger)',
            borderRadius: 10,
            padding: '12px 14px',
            fontSize: 13,
          }}
        >
          {state.error}
        </div>
      )}

      <SubmitButton />
    </form>
  )
}
