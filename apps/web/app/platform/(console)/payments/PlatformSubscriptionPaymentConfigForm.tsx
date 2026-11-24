'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import type { PlatformManualPaymentOption, PlatformSubscriptionPaymentConfig } from '../../../../lib/subscriptions/platformPaymentConfig'
import { savePlatformSubscriptionPaymentConfig } from '../actions'

const inputStyle = {
  width: '100%', height: 42, border: '1px solid var(--color-border)', borderRadius: 9,
  padding: '0 11px', color: 'var(--color-text-primary)', background: 'var(--color-background)', fontSize: 13,
}

export default function PlatformSubscriptionPaymentConfigForm({ config }: { config: PlatformSubscriptionPaymentConfig }) {
  const router = useRouter()
  const [options, setOptions] = useState(config.manual_payment_options)
  const [message, setMessage] = useState(config.support_message)
  const [phone, setPhone] = useState(config.support_phone ?? '')
  const [email, setEmail] = useState(config.support_email ?? '')
  const [whatsapp, setWhatsapp] = useState(config.support_whatsapp ?? '')
  const [website, setWebsite] = useState(config.support_website ?? '')
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState('')

  const updateOption = (index: number, changes: Partial<PlatformManualPaymentOption>) => {
    setOptions((current) => current.map((option, position) => position === index ? { ...option, ...changes } : option))
  }
  const addOption = () => setOptions((current) => [...current, {
    id: crypto.randomUUID(), method: 'mpesa_manual', label: '', destination: '',
    accountName: '', accountReference: '', instructions: '', active: true,
  }])
  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const formData = new FormData()
    formData.set('config', JSON.stringify({
      manual_payment_options: options, support_phone: phone, support_email: email,
      support_whatsapp: whatsapp, support_website: website, support_message: message,
    }))
    setSaving(true)
    setSaveMessage('')
    try {
      const result = await savePlatformSubscriptionPaymentConfig(formData)
      if (!result.success) {
        setSaveMessage(result.error ?? 'Unable to save payment settings.')
      } else {
        setSaveMessage('Payment destinations and support contacts saved.')
        router.refresh()
      }
    } catch {
      setSaveMessage('Unable to save payment settings.')
    } finally {
      setSaving(false)
    }
  }

  return <form onSubmit={onSubmit} className="flex flex-col gap-5">
    <p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: 13, lineHeight: 1.6 }}>
      These are Retivox subscription payment destinations. They are separate from each business&apos;s customer checkout settings.
    </p>
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 style={{ margin: 0, color: 'var(--color-text-primary)', fontSize: 15 }}>Manual payment options</h3>
        <button type="button" className="btn-outline" onClick={addOption} style={{ borderRadius: 8, padding: '8px 12px' }}>Add payment option</button>
      </div>
      {options.length === 0 && <p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: 13 }}>No manual payment options configured yet.</p>}
      {options.map((option, index) => <div key={option.id} className="grid grid-cols-1 gap-3 rounded-xl border p-3 md:grid-cols-2" style={{ borderColor: 'var(--color-border)' }}>
        <label style={labelStyle}>Payment type<select value={option.method} onChange={(event) => updateOption(index, { method: event.target.value as PlatformManualPaymentOption['method'] })} style={inputStyle}><option value="mpesa_manual">M-Pesa manual</option><option value="bank_transfer">Bank transfer</option><option value="cash_deposit">Cash deposit</option><option value="other">Other</option></select></label>
        <label style={labelStyle}>Display name<input value={option.label} onChange={(event) => updateOption(index, { label: event.target.value })} placeholder="e.g. Retivox M-Pesa PayBill" required style={inputStyle} /></label>
        <label style={labelStyle}>Till, PayBill, account or destination<input value={option.destination} onChange={(event) => updateOption(index, { destination: event.target.value })} placeholder="Payment number or account" required style={inputStyle} /></label>
        <label style={labelStyle}>Account / recipient name<input value={option.accountName} onChange={(event) => updateOption(index, { accountName: event.target.value })} placeholder="Retivox Ltd" style={inputStyle} /></label>
        <label style={labelStyle}>Account reference<input value={option.accountReference} onChange={(event) => updateOption(index, { accountReference: event.target.value })} placeholder="Business name or subscription ID" style={inputStyle} /></label>
        <label className="flex items-center gap-2" style={{ ...labelStyle, alignSelf: 'end', minHeight: 42 }}><input type="checkbox" checked={option.active} onChange={(event) => updateOption(index, { active: event.target.checked })} />Available to businesses</label>
        <label className="md:col-span-2" style={labelStyle}>Instructions<textarea value={option.instructions} onChange={(event) => updateOption(index, { instructions: event.target.value })} rows={2} placeholder="Include any steps the payer should follow." style={{ ...inputStyle, height: 'auto', padding: 10, resize: 'vertical' }} /></label>
        <button type="button" className="btn-outline" onClick={() => setOptions((current) => current.filter((_, position) => position !== index))} style={{ justifySelf: 'start', borderRadius: 8, padding: '8px 12px' }}>Remove option</button>
      </div>)}
    </section>
    <section className="flex flex-col gap-3">
      <h3 style={{ margin: 0, color: 'var(--color-text-primary)', fontSize: 15 }}>Retivox support contacts</h3>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <label style={labelStyle}>Support phone<input type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+254..." style={inputStyle} /></label>
        <label style={labelStyle}>Support email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="support@example.com" style={inputStyle} /></label>
        <label style={labelStyle}>WhatsApp number<input type="tel" value={whatsapp} onChange={(event) => setWhatsapp(event.target.value)} placeholder="+254..." style={inputStyle} /></label>
        <label style={labelStyle}>Support website<input type="url" value={website} onChange={(event) => setWebsite(event.target.value)} placeholder="https://..." style={inputStyle} /></label>
        <label className="md:col-span-2" style={labelStyle}>Payment assistance message<textarea value={message} onChange={(event) => setMessage(event.target.value)} maxLength={300} rows={2} style={{ ...inputStyle, height: 'auto', padding: 10, resize: 'vertical' }} /></label>
      </div>
    </section>
    {saveMessage && <p role="status" style={{ margin: 0, color: saveMessage.startsWith('Unable') ? 'var(--color-danger)' : 'var(--color-success)', fontSize: 13 }}>{saveMessage}</p>}
    <button type="submit" disabled={saving} className="btn-primary" style={{ alignSelf: 'start', borderRadius: 9, padding: '10px 15px', opacity: saving ? 0.7 : 1 }}>{saving ? 'Saving...' : 'Save payment options and support contacts'}</button>
  </form>
}

const labelStyle = { display: 'flex', flexDirection: 'column' as const, gap: 6, color: 'var(--color-text-primary)', fontSize: 12, fontWeight: 750 }
