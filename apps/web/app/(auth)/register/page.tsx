'use client'

/**
 * Registration page for Retivox.
 *
 * Uses a split layout that matches the login page, with a branded panel on desktop
 * and a full-width registration form on mobile.
 */

import { useActionState, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useFormStatus } from 'react-dom'
import { registerBusinessAndOwner, type FormState } from '../../../lib/auth/actions'

// ── Submit button used in the registration form ──
function SubmitButton() {
  const { pending } = useFormStatus()

  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full text-sm font-semibold text-white transition-all duration-200"
      style={{
        height: '44px',
        backgroundColor: 'var(--color-primary)',
        borderRadius: '8px',
        opacity: pending ? 0.75 : 1,
        cursor: pending ? 'not-allowed' : 'pointer',
        letterSpacing: '0.01em',
      }}
    >
      {pending ? (
        <span className="flex items-center justify-center gap-2">
          <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
          </svg>
          Creating account...
        </span>
      ) : (
        'Create account'
      )}
    </button>
  )
}

// ── Password visibility toggle icon ──
function EyeIcon({ open }: { open: boolean }) {
  return open ? (
    <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ) : (
    <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94" />
      <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  )
}

// ── Input icons used inside the registration fields ─
function PersonIcon() {
  return (
    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path d="M12 12a4 4 0 100-8 4 4 0 000 8z" />
      <path d="M4 20c0-4 4-6 8-6s8 2 8 6" />
    </svg>
  )
}

function EmailIcon() {
  return (
    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
      <polyline points="22,6 12,13 2,6" />
    </svg>
  )
}

function PhoneIcon() {
  return (
    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.12.82.34 1.63.65 2.4a2 2 0 01-.45 2.11L8.09 8.91a16 16 0 006 6l1.68-1.12a2 2 0 012.11-.45c.77.31 1.58.53 2.4.65a2 2 0 011.72 2z" />
    </svg>
  )
}

function LockIcon() {
  return (
    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0110 0v4" />
    </svg>
  )
}

function BuildingIcon() {
  return (
    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path d="M4 21h16V7H4v14z" />
      <path d="M8 21V11h8v10" />
      <path d="M8 15h2M8 19h2M14 15h2M14 19h2" />
      <path d="M4 11h16" />
    </svg>
  )
}

function GlobeIcon() {
  return (
    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="9" />
      <path d="M2.05 12h19.9" />
      <path d="M12 2.05a15.93 15.93 0 010 19.9" />
      <path d="M6.5 6.5a13 13 0 0111 11" />
      <path d="M17.5 6.5a13 13 0 00-11 11" />
    </svg>
  )
}

function CurrencyIcon() {
  return (
    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path d="M12 3v18" />
      <path d="M8 7h8" />
      <path d="M8 17h8" />
      <path d="M10 3a4 4 0 010 8h4a4 4 0 010 8" />
    </svg>
  )
}

function ClockIcon() {
  return (
    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 3" />
    </svg>
  )
}

export default function RegisterPage() {
  const router = useRouter()
  const [state, formAction] = useActionState<FormState, FormData>(registerBusinessAndOwner, {
    error: null,
    success: false,
  })
  const [showPassword, setShowPassword] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [businessName, setBusinessName] = useState('')
  const [country, setCountry] = useState('')
  const [currency, setCurrency] = useState('')
  const [timezone, setTimezone] = useState('')
  const currentYear = new Date().getFullYear()

  // Redirect to owner dashboard after successful registration
  useEffect(() => {
    if (state.success) {
      router.push('/dashboard/owner')
    }
  }, [state.success, router])

  return (
    <div className="min-h-screen w-full flex">
      {/* ── Left Panel — Brand and testimonial (desktop only) ── */}
      <div
        className="hidden lg:flex w-[480px] flex-col flex-shrink-0"
        style={{
          background: 'linear-gradient(135deg, #0a5c42 0%, #0F7B5A 50%, #1a8a66 100%)',
          padding: '40px 48px',
        }}
      >
        <div>
          <span
            className="font-extrabold block"
            style={{ fontSize: '26px', color: 'white', letterSpacing: '-0.5px' }}
          >
            Retivox
          </span>
          <p className="mt-1.5 text-sm" style={{ color: 'rgba(255,255,255,0.6)' }}>
            Run every store. From anywhere.
          </p>
        </div>

        <div style={{ marginTop: '36px' }}>
          <div
            style={{
              fontSize: '64px',
              fontWeight: '800',
              color: 'rgba(255,255,255,0.15)',
              lineHeight: '1',
              marginBottom: '-4px',
            }}
          >
            &ldquo;
          </div>
          <p
            style={{
              fontSize: '17px',
              fontWeight: '500',
              color: 'rgba(255,255,255,0.92)',
              lineHeight: '1.65',
            }}
          >
            Setting up our business on Retivox took minutes. Now I can see every branch from my phone.
          </p>
          <div className="flex items-center gap-3 mt-5">
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white flex-shrink-0"
              style={{ backgroundColor: 'rgba(255,255,255,0.2)' }}
            >
              SW
            </div>
            <div>
              <p className="text-sm font-semibold text-white">Sarah Wanjiku</p>
              <p className="text-xs" style={{ color: 'rgba(255,255,255,0.55)' }}>
                Owner, Wanjiku Holdings
              </p>
            </div>
          </div>
        </div>

        <div
          style={{
            height: '1px',
            backgroundColor: 'rgba(255,255,255,0.12)',
            marginTop: '36px',
            marginBottom: '28px',
          }}
        />

        <div>
          <p
            className="mb-4"
            style={{
              fontSize: '11px',
              letterSpacing: '2px',
              color: 'rgba(255,255,255,0.45)',
              textTransform: 'uppercase',
            }}
          >
            Why Retivox
          </p>
          <div className="flex flex-col gap-3">
            {[
              'Real-time sales across all your branches',
              'Works offline — syncs automatically',
              'Built for growing businesses',
            ].map((text) => (
              <div key={text} className="flex items-center gap-3">
                <div
                  className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0"
                  style={{ backgroundColor: 'rgba(255,255,255,0.15)' }}
                >
                  <svg width="12" height="12" fill="currentColor" viewBox="0 0 20 20">
                    <path
                      fillRule="evenodd"
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                </div>
                <span className="text-sm" style={{ color: 'rgba(255,255,255,0.82)' }}>
                  {text}
                </span>
              </div>
            ))}
          </div>
        </div>

        <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.3)', marginTop: 'auto', paddingTop: '32px' }}>
          © {currentYear} Retivox. All rights reserved.
        </p>
      </div>

      {/* ── Right Panel — Registration form ── */}
      <div
        className="flex-1 flex items-center justify-center py-10"
         style={{
            backgroundColor: 'var(--color-surface)',
            overflowY: 'auto',
            paddingLeft: '20px',
            paddingRight: '20px',
        }}
>
        <div className="w-full" style={{ maxWidth: '720px' }}>

  {/* Mobile logo */}
  <div className="lg:hidden mb-8">
    <span
      className="font-extrabold"
      style={{ fontSize: '22px', color: 'var(--color-primary)', letterSpacing: '-0.5px' }}
    >
      Retivox
    </span>
  </div>

  {/* Heading — centered */}
  <div className="text-center mb-8">
    <h1
      className="font-bold"
      style={{ fontSize: '28px', color: 'var(--color-text-primary)', letterSpacing: '-0.5px' }}
    >
      Create your account
    </h1>
    <p
      className="mt-2"
      style={{ fontSize: '14px', color: 'var(--color-text-muted)', lineHeight: '1.5' }}
    >
      Start your 30-day free trial. No credit card required.
    </p>
  </div>

  <form action={formAction}>
    {/* Two column grid — personal left, business right */}
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">

      {/* Left column — Your details */}
      <div className="flex flex-col gap-4">
        <p
          style={{
            fontSize: '11px',
            letterSpacing: '0.2em',
            color: 'var(--color-text-muted)',
            textTransform: 'uppercase',
            marginBottom: '4px',
          }}
        >
          Your details
        </p>

        {/* Full name */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="name" className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>
            Full name
          </label>
          <div className="relative">
            {!name && (
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none" style={{ color: 'var(--color-text-muted)' }}>
                <PersonIcon />
              </div>
            )}
            <input
              id="name" name="name" type="text" placeholder="Your full name" required
              value={name} onChange={e => setName(e.target.value)}
              className="w-full text-sm border outline-none transition-all duration-150"
              style={{ height: '44px', paddingLeft: name ? '14px' : '38px', paddingRight: '14px', borderRadius: '8px', borderColor: 'var(--color-border)', backgroundColor: 'var(--color-background)', color: 'var(--color-text-primary)' }}
              onFocus={e => { e.currentTarget.style.borderColor = 'var(--color-primary)'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(15,123,90,0.12)' }}
              onBlur={e => { e.currentTarget.style.borderColor = 'var(--color-border)'; e.currentTarget.style.boxShadow = 'none' }}
            />
          </div>
        </div>

        {/* Email */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="email" className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>
            Email
          </label>
          <div className="relative">
            {!email && (
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none" style={{ color: 'var(--color-text-muted)' }}>
                <EmailIcon />
              </div>
            )}
            <input
              id="email" name="email" type="email" placeholder="you@example.com" required
              value={email} onChange={e => setEmail(e.target.value)}
              className="w-full text-sm border outline-none transition-all duration-150"
              style={{ height: '44px', paddingLeft: email ? '14px' : '38px', paddingRight: '14px', borderRadius: '8px', borderColor: 'var(--color-border)', backgroundColor: 'var(--color-background)', color: 'var(--color-text-primary)' }}
              onFocus={e => { e.currentTarget.style.borderColor = 'var(--color-primary)'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(15,123,90,0.12)' }}
              onBlur={e => { e.currentTarget.style.borderColor = 'var(--color-border)'; e.currentTarget.style.boxShadow = 'none' }}
            />
          </div>
        </div>

        {/* Phone */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="phone" className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>
            Phone
          </label>
          <div className="relative">
            {!phone && (
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none" style={{ color: 'var(--color-text-muted)' }}>
                <PhoneIcon />
              </div>
            )}
            <input
              id="phone" name="phone" type="tel" placeholder="+254 700 000 000" required
              value={phone} onChange={e => setPhone(e.target.value)}
              className="w-full text-sm border outline-none transition-all duration-150"
              style={{ height: '44px', paddingLeft: phone ? '14px' : '38px', paddingRight: '14px', borderRadius: '8px', borderColor: 'var(--color-border)', backgroundColor: 'var(--color-background)', color: 'var(--color-text-primary)' }}
              onFocus={e => { e.currentTarget.style.borderColor = 'var(--color-primary)'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(15,123,90,0.12)' }}
              onBlur={e => { e.currentTarget.style.borderColor = 'var(--color-border)'; e.currentTarget.style.boxShadow = 'none' }}
            />
          </div>
        </div>

        {/* Password */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="password" className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>
            Password
          </label>
          <div className="relative">
            {!password && (
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none" style={{ color: 'var(--color-text-muted)' }}>
                <LockIcon />
              </div>
            )}
            <input
              id="password" name="password" type={showPassword ? 'text' : 'password'} placeholder="Min. 8 characters" required
              value={password} onChange={e => setPassword(e.target.value)}
              className="w-full text-sm border outline-none transition-all duration-150"
              style={{ height: '44px', paddingLeft: password ? '14px' : '38px', paddingRight: '42px', borderRadius: '8px', borderColor: 'var(--color-border)', backgroundColor: 'var(--color-background)', color: 'var(--color-text-primary)' }}
              onFocus={e => { e.currentTarget.style.borderColor = 'var(--color-primary)'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(15,123,90,0.12)' }}
              onBlur={e => { e.currentTarget.style.borderColor = 'var(--color-border)'; e.currentTarget.style.boxShadow = 'none' }}
            />
            <button
              type="button" onClick={() => setShowPassword(p => !p)}
              className="absolute inset-y-0 right-0 pr-3 flex items-center transition-opacity hover:opacity-60"
              style={{ color: 'var(--color-text-muted)' }}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              <EyeIcon open={showPassword} />
            </button>
          </div>
        </div>
      </div>

      {/* Right column — Your business */}
      <div className="flex flex-col gap-4">
        <p
          style={{
            fontSize: '11px',
            letterSpacing: '0.2em',
            color: 'var(--color-text-muted)',
            textTransform: 'uppercase',
            marginBottom: '4px',
          }}
        >
          Your business
        </p>

        {/* Business name */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="businessName" className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>
            Business name
          </label>
          <div className="relative">
            {!businessName && (
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none" style={{ color: 'var(--color-text-muted)' }}>
                <BuildingIcon />
              </div>
            )}
            <input
              id="businessName" name="businessName" type="text" placeholder="e.g. Kamau Enterprises" required
              value={businessName} onChange={e => setBusinessName(e.target.value)}
              className="w-full text-sm border outline-none transition-all duration-150"
              style={{ height: '44px', paddingLeft: businessName ? '14px' : '38px', paddingRight: '14px', borderRadius: '8px', borderColor: 'var(--color-border)', backgroundColor: 'var(--color-background)', color: 'var(--color-text-primary)' }}
              onFocus={e => { e.currentTarget.style.borderColor = 'var(--color-primary)'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(15,123,90,0.12)' }}
              onBlur={e => { e.currentTarget.style.borderColor = 'var(--color-border)'; e.currentTarget.style.boxShadow = 'none' }}
            />
          </div>
        </div>

        {/* Country */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="country" className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>
            Country code
          </label>
          <div className="relative">
            {!country && (
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none" style={{ color: 'var(--color-text-muted)' }}>
                <GlobeIcon />
              </div>
            )}
            <input
              id="country" name="country" type="text" placeholder="KE" required maxLength={2}
              value={country} onChange={e => setCountry(e.target.value.toUpperCase())}
              className="w-full text-sm border outline-none transition-all duration-150"
              style={{ height: '44px', paddingLeft: country ? '14px' : '38px', paddingRight: '14px', borderRadius: '8px', borderColor: 'var(--color-border)', backgroundColor: 'var(--color-background)', color: 'var(--color-text-primary)', textTransform: 'uppercase' }}
              onFocus={e => { e.currentTarget.style.borderColor = 'var(--color-primary)'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(15,123,90,0.12)' }}
              onBlur={e => { e.currentTarget.style.borderColor = 'var(--color-border)'; e.currentTarget.style.boxShadow = 'none' }}
            />
          </div>
        </div>

        {/* Currency */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="currency" className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>
            Currency code
          </label>
          <div className="relative">
            {!currency && (
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none" style={{ color: 'var(--color-text-muted)' }}>
                <CurrencyIcon />
              </div>
            )}
            <input
              id="currency" name="currency" type="text" placeholder="KES" required maxLength={3}
              value={currency} onChange={e => setCurrency(e.target.value.toUpperCase())}
              className="w-full text-sm border outline-none transition-all duration-150"
              style={{ height: '44px', paddingLeft: currency ? '14px' : '38px', paddingRight: '14px', borderRadius: '8px', borderColor: 'var(--color-border)', backgroundColor: 'var(--color-background)', color: 'var(--color-text-primary)', textTransform: 'uppercase' }}
              onFocus={e => { e.currentTarget.style.borderColor = 'var(--color-primary)'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(15,123,90,0.12)' }}
              onBlur={e => { e.currentTarget.style.borderColor = 'var(--color-border)'; e.currentTarget.style.boxShadow = 'none' }}
            />
          </div>
        </div>

        {/* Timezone */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="timezone" className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>
            Timezone
          </label>
          <div className="relative">
            {!timezone && (
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none" style={{ color: 'var(--color-text-muted)' }}>
                <ClockIcon />
              </div>
            )}
            <input
              id="timezone" name="timezone" type="text" placeholder="Africa/Nairobi" required
              value={timezone} onChange={e => setTimezone(e.target.value)}
              className="w-full text-sm border outline-none transition-all duration-150"
              style={{ height: '44px', paddingLeft: timezone ? '14px' : '38px', paddingRight: '14px', borderRadius: '8px', borderColor: 'var(--color-border)', backgroundColor: 'var(--color-background)', color: 'var(--color-text-primary)' }}
              onFocus={e => { e.currentTarget.style.borderColor = 'var(--color-primary)'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(15,123,90,0.12)' }}
              onBlur={e => { e.currentTarget.style.borderColor = 'var(--color-border)'; e.currentTarget.style.boxShadow = 'none' }}
            />
          </div>
        </div>
      </div>
    </div>

    {/* Error and success messages */}
    {state.error && (
      <div className="px-4 py-3 text-sm mb-4" style={{ backgroundColor: 'var(--color-danger-light)', border: '1px solid var(--color-danger)', color: 'var(--color-danger)', borderRadius: '8px' }}>
        {state.error}
      </div>
    )}
    {state.success && (
      <div className="px-4 py-3 text-sm mb-4" style={{ backgroundColor: 'var(--color-success-light)', border: '1px solid var(--color-success)', color: 'var(--color-success)', borderRadius: '8px' }}>
        Account created! Redirecting...
      </div>
    )}

    {/* Submit button — centered */}
   <div className="flex justify-center" style={{ marginTop: '24px' }}>
      <div style={{ width: '320px' }}>
        <SubmitButton />
      </div>
    </div>

    {/* Sign in link */}
    <p className="text-center text-sm mt-5" style={{ color: 'var(--color-text-muted)' }}>
      Already have an account?{' '}
      <Link href="/login" className="font-semibold transition-opacity hover:opacity-75" style={{ color: 'var(--color-primary)' }}>
        Sign in
      </Link>
    </p>
  </form>
</div>
      </div>
    </div>
  )
}
