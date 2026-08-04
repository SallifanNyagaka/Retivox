/**
 * Login page for all Retivox user roles — owner, admin and employee.
 * Split layout: branded panel left, form right.
 * Branded panel hidden on mobile — form takes full width.
 */

'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useFormStatus } from 'react-dom'
import { loginUser, type FormState } from '../../../lib/auth/actions'
import { clearTrustedDeviceSession, getTrustedDeviceSession } from '../../../lib/pwa/trustedDevice'
import { createClient } from '../../../lib/supabase/client'

type ReviewRole = 'owner' | 'admin' | 'employee'

type LoginReview = {
  id: string
  role: ReviewRole
  quote: string
  reviewerName: string
  reviewerTitle: string
}

const FALLBACK_REVIEWS: Record<ReviewRole, LoginReview[]> = {
  owner: [
    {
      id: 'fallback-owner',
      role: 'owner',
      quote: 'Retivox gives me one clean view of every branch without waiting for end-of-day calls.',
      reviewerName: 'James Kamau',
      reviewerTitle: 'Owner, Kamau Enterprises',
    },
  ],
  admin: [
    {
      id: 'fallback-admin',
      role: 'admin',
      quote: 'The admin dashboard helps me spot low stock and follow branch performance before small issues become expensive.',
      reviewerName: 'Mercy Achieng',
      reviewerTitle: 'Branch Admin, Green Basket Stores',
    },
  ],
  employee: [
    {
      id: 'fallback-employee',
      role: 'employee',
      quote: 'Recording sales is quick, and damaged stock reporting is clear enough for busy counter work.',
      reviewerName: 'Faith Njeri',
      reviewerTitle: 'Sales Associate, Metro Mart',
    },
  ],
}

// ── Submit button with loading spinner ──
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
          Signing in...
        </span>
      ) : (
        'Sign In'
      )}
    </button>
  )
}

// ── Eye icon for show/hide password ──
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

// ── Email envelope icon ──
function EmailIcon() {
  return (
    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
      <polyline points="22,6 12,13 2,6" />
    </svg>
  )
}

// ── Lock icon ──
function LockIcon() {
  return (
    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0110 0v4" />
    </svg>
  )
}

// ── Checkmark for feature bullets ──
function CheckIcon() {
  return (
    <svg width="12" height="12" fill="currentColor" viewBox="0 0 20 20">
      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
    </svg>
  )
}

function LoginReviews({ defaultRole }: { defaultRole: ReviewRole }) {
  const [reviews, setReviews] = useState<LoginReview[]>(FALLBACK_REVIEWS[defaultRole])
  const scrollRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let ignore = false

    async function loadReviews() {
      try {
        const response = await fetch(`/api/login-reviews?role=${defaultRole}`, { cache: 'no-store' })
        const payload = (await response.json()) as { reviews?: LoginReview[] }
        const nextReviews = payload.reviews && payload.reviews.length > 0 ? payload.reviews : FALLBACK_REVIEWS[defaultRole]

        if (!ignore) {
          setReviews(nextReviews)
          if (scrollRef.current) {
            scrollRef.current.scrollTop = 0
          }
        }
      } catch {
        if (!ignore) {
          setReviews(FALLBACK_REVIEWS[defaultRole])
        }
      }
    }

    loadReviews()

    return () => {
      ignore = true
    }
  }, [defaultRole])

  useEffect(() => {
    const container = scrollRef.current
    if (!container || reviews.length <= 1) return

    const interval = window.setInterval(() => {
      const nextTop = container.scrollTop + 132
      const maxTop = container.scrollHeight - container.clientHeight

      container.scrollTo({
        top: nextTop >= maxTop ? 0 : nextTop,
        behavior: 'smooth',
      })
    }, 3600)

    return () => window.clearInterval(interval)
  }, [reviews])

  return (
    <div style={{ marginTop: 24 }}>
      <div
        ref={scrollRef}
        className="retivox-login-reviews"
        style={{
          maxHeight: 250,
          overflowY: 'auto',
          marginTop: 14,
          paddingRight: 6,
          scrollBehavior: 'smooth',
        }}
      >
        {reviews.map((review) => (
          <div
            key={review.id}
            style={{
              border: '1px solid rgba(255,255,255,0.16)',
              borderRadius: 18,
              padding: 16,
              marginBottom: 12,
              backgroundColor: 'rgba(255,255,255,0.1)',
              boxShadow: '0 18px 40px rgba(0,0,0,0.12)',
            }}
          >
            <p style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'rgba(255,255,255,0.94)', lineHeight: 1.55 }}>
              “{review.quote}”
            </p>
            <div className="flex items-center gap-3" style={{ marginTop: 14 }}>
              <div
                className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
                style={{ backgroundColor: 'rgba(255,255,255,0.2)' }}
              >
                {review.reviewerName
                  .split(' ')
                  .slice(0, 2)
                  .map((part) => part.charAt(0))
                  .join('')
                  .toUpperCase()}
              </div>
              <div>
                <p className="text-sm font-semibold text-white">{review.reviewerName}</p>
                <p className="text-xs" style={{ color: 'rgba(255,255,255,0.62)' }}>
                  {review.reviewerTitle}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function LoginPage() {
  const pathname = usePathname()
  const router = useRouter()
  const [state, formAction] = useActionState<FormState, FormData>(loginUser, {
    error: null,
    success: false,
  })
  const [showPassword, setShowPassword] = useState(false)

  // Track field values to hide icons when text is present
  const [emailValue, setEmailValue] = useState('')
  const [passwordValue, setPasswordValue] = useState('')
  const defaultReviewRole: ReviewRole = pathname.startsWith('/admin')
    ? 'admin'
    : pathname.startsWith('/employee')
      ? 'employee'
      : 'owner'
  const currentYear = new Date().getFullYear()

  useEffect(() => {
    const restoreTrustedSession = () => {
      const trustedSession = getTrustedDeviceSession()

      if (!trustedSession) {
        return
      }

      // A trusted device can immediately reopen its already-cached dashboard
      // without waiting on a network or token refresh.
      if (!navigator.onLine) {
        router.replace(trustedSession.dashboardPath)
        return
      }

      void createClient().auth.getSession().then(({ data }) => {
        if (data.session?.user.id === trustedSession.userId) {
          router.replace(trustedSession.dashboardPath)
          return
        }

        // The connection may disappear during the local session read. In that
        // case the trusted cached dashboard is still safe to restore.
        if (!navigator.onLine) {
          router.replace(trustedSession.dashboardPath)
          return
        }

        clearTrustedDeviceSession()
      }).catch(() => {
        if (!navigator.onLine) {
          router.replace(trustedSession.dashboardPath)
          return
        }

        clearTrustedDeviceSession()
      })
    }

    restoreTrustedSession()
  }, [router])

  return (
    <div className="min-h-screen w-full flex flex-col lg:flex-row">

      {/* ── Left Panel — Brand (desktop only) ── */}
<div
  className="flex w-full flex-col flex-shrink-0 lg:w-[480px]"
  style={{
    background: 'linear-gradient(135deg, #0a5c42 0%, #0F7B5A 50%, #1a8a66 100%)',
    padding: '28px min(32px, 7vw)',
  }}
>
  {/* Logo and tagline */}
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

  {/* Reviews */}
  <div style={{ marginTop: '18px' }}>
    <div
      style={{
        fontSize: '48px',
        fontWeight: '800',
        color: 'rgba(255,255,255,0.15)',
        lineHeight: '1',
        marginBottom: '-4px',
      }}
    >
      &ldquo;
    </div>
    <LoginReviews defaultRole={defaultReviewRole} />
  </div>

  {/* Divider */}
  <div
    className="hidden sm:block"
    style={{
      height: '1px',
      backgroundColor: 'rgba(255,255,255,0.12)',
      marginTop: '36px',
      marginBottom: '28px',
    }}
  />

  {/* Why Retivox */}
  <div className="hidden sm:block">
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
            <CheckIcon />
          </div>
          <span className="text-sm" style={{ color: 'rgba(255,255,255,0.82)' }}>
            {text}
          </span>
        </div>
      ))}
    </div>
  </div>

  {/* Copyright */}
  <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.3)', marginTop: 'auto', paddingTop: '32px' }}>
    © {currentYear} Retivox. All rights reserved.
  </p>
</div>

      {/* ── Right Panel — Login Form ── */}
      <div
        className="flex-1 flex items-center justify-center px-6 py-12 sm:px-12"
        style={{ backgroundColor: 'var(--color-surface)' }}
      >
        <div className="w-full max-w-sm">

          {/* Heading */}
          <div className="mb-8">
            <h1
              className="font-bold"
              style={{
                fontSize: '28px',
                color: 'var(--color-text-primary)',
                letterSpacing: '-0.5px',
              }}
            >
              Welcome Back!
            </h1>
            <p
              className="mt-2"
              style={{ fontSize: '14px', color: 'var(--color-text-muted)', lineHeight: '1.5' }}
            >
              Sign in to access your dashboard and manage your stores.
            </p>
          </div>

          {/* Form */}
          <form action={formAction} className="flex flex-col gap-5">

            {/* Email field */}
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="email"
                className="text-sm font-medium"
                style={{ color: 'var(--color-text-primary)' }}
              >
                Email
              </label>
              <div className="relative">
                {/* Icon — hidden when email has value */}
                {!emailValue && (
                  <div
                    className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none"
                    style={{ color: 'var(--color-text-muted)' }}
                  >
                    <EmailIcon />
                  </div>
                )}
                <input
                  id="email"
                  name="email"
                  type="email"
                  placeholder="Enter your email"
                  required
                  value={emailValue}
                  onChange={e => setEmailValue(e.target.value)}
                  className="w-full text-sm border outline-none transition-all duration-150"
                  style={{
                    height: '44px',
                    paddingLeft: emailValue ? '14px' : '38px',
                    paddingRight: '14px',
                    borderRadius: '8px',
                    borderColor: 'var(--color-border)',
                    backgroundColor: 'var(--color-background)',
                    color: 'var(--color-text-primary)',
                  }}
                  onFocus={e => {
                    e.currentTarget.style.borderColor = 'var(--color-primary)'
                    e.currentTarget.style.boxShadow = '0 0 0 3px rgba(15,123,90,0.12)'
                  }}
                  onBlur={e => {
                    e.currentTarget.style.borderColor = 'var(--color-border)'
                    e.currentTarget.style.boxShadow = 'none'
                  }}
                />
              </div>
            </div>

            {/* Password field */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <label
                  htmlFor="password"
                  className="text-sm font-medium"
                  style={{ color: 'var(--color-text-primary)' }}
                >
                  Password
                </label>
                <Link
                  href="/forgot-password"
                  className="text-sm font-medium transition-opacity hover:opacity-70"
                  style={{ color: 'var(--color-primary)' }}
                >
                  Forgot password?
                </Link>
              </div>
              <div className="relative">
                {/* Icon — hidden when password has value */}
                {!passwordValue && (
                  <div
                    className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none"
                    style={{ color: 'var(--color-text-muted)' }}
                  >
                    <LockIcon />
                  </div>
                )}
                <input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Enter your password"
                  required
                  value={passwordValue}
                  onChange={e => setPasswordValue(e.target.value)}
                  className="w-full text-sm border outline-none transition-all duration-150"
                  style={{
                    height: '44px',
                    paddingLeft: passwordValue ? '14px' : '38px',
                    paddingRight: '42px',
                    borderRadius: '8px',
                    borderColor: 'var(--color-border)',
                    backgroundColor: 'var(--color-background)',
                    color: 'var(--color-text-primary)',
                  }}
                  onFocus={e => {
                    e.currentTarget.style.borderColor = 'var(--color-primary)'
                    e.currentTarget.style.boxShadow = '0 0 0 3px rgba(15,123,90,0.12)'
                  }}
                  onBlur={e => {
                    e.currentTarget.style.borderColor = 'var(--color-border)'
                    e.currentTarget.style.boxShadow = 'none'
                  }}
                />
                {/* Show/hide toggle — always visible */}
                <button
                  type="button"
                  onClick={() => setShowPassword(p => !p)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center transition-opacity hover:opacity-60"
                  style={{ color: 'var(--color-text-muted)' }}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  <EyeIcon open={showPassword} />
                </button>
              </div>
            </div>

            {/* Error message */}
            {state.error && (
              <div
                className="px-4 py-3 text-sm"
                style={{
                  backgroundColor: 'var(--color-danger-light)',
                  border: '1px solid var(--color-danger)',
                  color: 'var(--color-danger)',
                  borderRadius: '8px',
                }}
              >
                {state.error}
              </div>
            )}

            {/* Submit */}
            <SubmitButton />

            {/* Divider */}
            <div className="flex items-center gap-3">
              <div className="flex-1 h-px" style={{ backgroundColor: 'var(--color-border)' }} />
              <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>OR</span>
              <div className="flex-1 h-px" style={{ backgroundColor: 'var(--color-border)' }} />
            </div>

            {/* Register link */}
            <p className="text-center text-sm" style={{ color: 'var(--color-text-muted)' }}>
              Don&apos;t have an account?{' '}
              <Link
                href="/register"
                className="font-semibold transition-opacity hover:opacity-75"
                style={{ color: 'var(--color-primary)' }}
              >
                Sign Up
              </Link>
            </p>
          </form>
        </div>
      </div>
    </div>
  )
}
