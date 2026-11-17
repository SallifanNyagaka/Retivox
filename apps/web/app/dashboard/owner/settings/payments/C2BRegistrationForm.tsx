'use client'

import { useActionState } from 'react'
import { registerDarajaC2BCallbacks, type C2BRegistrationState } from './actions'

const initialState: C2BRegistrationState = { success: false, error: null, message: null }

export default function C2BRegistrationForm() {
  const [state, action, pending] = useActionState(registerDarajaC2BCallbacks, initialState)
  return <form action={action} className="flex flex-col items-start gap-3">
    <button type="submit" disabled={pending} className="btn-outline" style={{ borderRadius: 9, padding: '10px 15px' }}>
      {pending ? 'Registering with Daraja…' : 'Register C2B callbacks'}
    </button>
    {state.error && <p role="alert" style={{ margin: 0, color: 'var(--color-danger)', fontSize: 13 }}>{state.error}</p>}
    {state.message && <p role="status" style={{ margin: 0, color: state.success ? 'var(--color-success)' : 'var(--color-danger)', fontSize: 13 }}>{state.message}</p>}
  </form>
}
