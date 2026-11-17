'use client'

import { useActionState } from 'react'
import { registerPesapalBusinessIpn, type PesapalIpnState } from './actions'

const initialState: PesapalIpnState = { success: false, error: null, message: null }

export default function PesapalIpnRegistrationForm({ ipnId }: { ipnId: string | null }) {
  const [state, action, pending] = useActionState(registerPesapalBusinessIpn, initialState)
  return <div className="flex flex-col items-start gap-2">
    {ipnId ? <p style={{ margin: 0, color: 'var(--color-success)', fontSize: 13 }}>IPN registered · {ipnId}</p> : <form action={action}>
      <button type="submit" disabled={pending} className="btn-outline" style={{ borderRadius: 9, padding: '10px 15px' }}>{pending ? 'Registering…' : 'Register Pesapal IPN'}</button>
    </form>}
    {state.error && <p role="alert" style={{ margin: 0, color: 'var(--color-danger)', fontSize: 13 }}>{state.error}</p>}
    {state.message && <p role="status" style={{ margin: 0, color: state.success ? 'var(--color-success)' : 'var(--color-danger)', fontSize: 13 }}>{state.message}</p>}
  </div>
}
