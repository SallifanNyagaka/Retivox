'use client'
/**
 * Client dashboard for owner settings.
 *
 * This component renders the interactive settings sections: business profile,
 * password changes, subscription display, appearance preferences, and danger
 * zone confirmations.
 */

import { startTransition, useEffect, useRef, useState, type FormEvent } from 'react'
import { useActionState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardHeader } from '../../../../components/ui/Card'
import { Badge } from '../../../../components/ui/Badge'
import Modal from '../../../../components/ui/Modal'
import Toast from '../../../../components/ui/Toast'
import LoadingOverlay from '../../../../components/ui/LoadingOverlay'
import { applyDashboardTheme, getDashboardThemeKey } from '../../../../components/dashboard/DashboardThemeProvider'
import { useToast } from '../../../../lib/hooks/useToast'
import { addLoginReview, changePassword, logoutFromSettings, setLoginReviewActive, updateBusinessProfile } from './actions'
import type { BusinessSettingsRow, FormState, LoginReviewRow, SubscriptionRow, UserProfileRow } from './types'

/**
 * Props for the settings page client.
 */
type Props = {
  business: BusinessSettingsRow
  ownerProfile: UserProfileRow
  subscription: SubscriptionRow | null
  loginReviews: LoginReviewRow[]
}

/**
 * Available plan display metadata.
 */
type PlanOption = {
  key: 'trial' | 'starter' | 'growth' | 'enterprise'
  label: string
  monthlyAmount: number
  branchLimit: string
}

/**
 * Plan cards shown in the subscription section.
 */
const PLAN_OPTIONS: PlanOption[] = [
  { key: 'trial', label: 'Trial', monthlyAmount: 0, branchLimit: 'Free starter workspace' },
  { key: 'starter', label: 'Starter', monthlyAmount: 2000, branchLimit: 'Up to 3 branches' },
  { key: 'growth', label: 'Growth', monthlyAmount: 5000, branchLimit: 'Up to 10 branches' },
  { key: 'enterprise', label: 'Enterprise', monthlyAmount: 12000, branchLimit: 'Unlimited branches' },
]

const REVIEW_ROLE_LABELS: Record<LoginReviewRow['role'], string> = {
  owner: 'Owner',
  admin: 'Admin',
  employee: 'Employee',
}

/**
 * Shared input styling for settings forms.
 */
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

/**
 * Formats monetary values with the business currency.
 */
function formatMoney(amount: number, currency: string) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)
}

/**
 * Formats optional subscription dates.
 */
function formatDateLabel(isoDate: string | null) {
  if (!isoDate) {
    return 'Not scheduled'
  }

  return new Date(isoDate).toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

/**
 * Returns a readable status label.
 */
function formatStatusLabel(status: string) {
  return status
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

/**
 * Business profile editing form.
 */
function BusinessProfileSection({ business }: { business: BusinessSettingsRow }) {
  const router = useRouter()
  const [name, setName] = useState(business.name)
  const [country, setCountry] = useState(business.country)
  const [currency, setCurrency] = useState(business.currency)
  const [timezone, setTimezone] = useState(business.timezone)
  const { toast, toastState, dismiss } = useToast()
  const [state, action, isPending] = useActionState<FormState, FormData>(updateBusinessProfile, {
    error: null,
    success: false,
  })
  const previousPending = useRef(isPending)

  /**
   * Handles save results after the transition completes.
   */
  useEffect(() => {
    let refreshTimer: ReturnType<typeof setTimeout> | null = null

    if (previousPending.current && !isPending) {
      if (state.success) {
        toast.success('Business profile updated')
        refreshTimer = setTimeout(() => {
          router.refresh()
        }, 0)
      } else if (state.error) {
        toast.error(state.error)
      }
    }

    previousPending.current = isPending
    return () => {
      if (refreshTimer) {
        clearTimeout(refreshTimer)
      }
    }
  }, [isPending, router, state.error, state.success, toast])

  /**
   * Submits the business profile update.
   */
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const formData = new FormData()
    formData.set('name', name)
    formData.set('country', country)
    formData.set('currency', currency)
    formData.set('timezone', timezone)

    startTransition(() => {
      action(formData)
    })
  }

  return (
    <>
      {isPending && <LoadingOverlay message="Saving business profile..." />}
      {toastState && (
        <Toast
          message={toastState.message}
          type={toastState.type}
          duration={toastState.duration}
          onDismiss={dismiss}
        />
      )}

      <Card padding="md">
        <CardHeader title="Business profile" />
        <form onSubmit={onSubmit}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Business name field */}
            <label style={{ fontSize: 13 }}>
              <span style={{ display: 'block', marginBottom: 6, fontWeight: 500, color: 'var(--color-text-primary)' }}>
                Business name
              </span>
              <input value={name} onChange={(event) => setName(event.target.value)} required style={inputStyle} />
            </label>

            {/* Country field */}
            <label style={{ fontSize: 13 }}>
              <span style={{ display: 'block', marginBottom: 6, fontWeight: 500, color: 'var(--color-text-primary)' }}>
                Country
              </span>
              <input
                value={country}
                onChange={(event) => setCountry(event.target.value.toUpperCase())}
                maxLength={2}
                required
                style={inputStyle}
              />
            </label>

            {/* Currency field */}
            <label style={{ fontSize: 13 }}>
              <span style={{ display: 'block', marginBottom: 6, fontWeight: 500, color: 'var(--color-text-primary)' }}>
                Currency
              </span>
              <input
                value={currency}
                onChange={(event) => setCurrency(event.target.value.toUpperCase())}
                maxLength={3}
                required
                style={inputStyle}
              />
            </label>

            {/* Timezone field */}
            <label style={{ fontSize: 13 }}>
              <span style={{ display: 'block', marginBottom: 6, fontWeight: 500, color: 'var(--color-text-primary)' }}>
                Timezone
              </span>
              <input value={timezone} onChange={(event) => setTimezone(event.target.value)} required style={inputStyle} />
            </label>
          </div>

          {state.error && (
            <div
              style={{
                backgroundColor: 'var(--color-danger-light)',
                border: '1px solid var(--color-danger)',
                color: 'var(--color-danger)',
                borderRadius: 8,
                padding: '12px 14px',
                fontSize: 13,
                marginTop: 14,
              }}
            >
              {state.error}
            </div>
          )}

          <button
            type="submit"
            className="btn-primary"
            disabled={isPending}
            style={{ padding: '10px 20px', borderRadius: 8, marginTop: 16, opacity: isPending ? 0.8 : 1 }}
          >
            {isPending ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24" style={{ color: 'var(--color-surface)' }}>
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                </svg>
                Saving profile...
              </span>
            ) : (
              'Save profile'
            )}
          </button>
        </form>
      </Card>
    </>
  )
}

/**
 * Account security form for password changes.
 */
function AccountSecuritySection({ ownerProfile }: { ownerProfile: UserProfileRow }) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const { toast, toastState, dismiss } = useToast()
  const [state, action, isPending] = useActionState<FormState, FormData>(changePassword, {
    error: null,
    success: false,
  })
  const previousPending = useRef(isPending)

  /**
   * Handles password change results after completion.
   */
  useEffect(() => {
    let resetTimer: ReturnType<typeof setTimeout> | null = null

    if (previousPending.current && !isPending) {
      if (state.success) {
        toast.success('Password updated')
        resetTimer = setTimeout(() => {
          setCurrentPassword('')
          setNewPassword('')
          setConfirmPassword('')
        }, 0)
      } else if (state.error) {
        toast.error(state.error)
      }
    }

    previousPending.current = isPending
    return () => {
      if (resetTimer) {
        clearTimeout(resetTimer)
      }
    }
  }, [isPending, state.error, state.success, toast])

  /**
   * Submits the password update request.
   */
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const formData = new FormData()
    formData.set('currentPassword', currentPassword)
    formData.set('newPassword', newPassword)
    formData.set('confirmPassword', confirmPassword)

    startTransition(() => {
      action(formData)
    })
  }

  return (
    <>
      {isPending && <LoadingOverlay message="Changing password..." />}
      {toastState && (
        <Toast
          message={toastState.message}
          type={toastState.type}
          duration={toastState.duration}
          onDismiss={dismiss}
        />
      )}

      <Card padding="md">
        <CardHeader title="Account security" />
        <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 0, marginBottom: 14 }}>
          Signed in as {ownerProfile.email}. Use a strong password with uppercase, lowercase, and a number.
        </p>
        <form onSubmit={onSubmit}>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Current password field */}
            <label style={{ fontSize: 13 }}>
              <span style={{ display: 'block', marginBottom: 6, fontWeight: 500, color: 'var(--color-text-primary)' }}>
                Current password
              </span>
              <input
                type="password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                required
                style={inputStyle}
              />
            </label>

            {/* New password field */}
            <label style={{ fontSize: 13 }}>
              <span style={{ display: 'block', marginBottom: 6, fontWeight: 500, color: 'var(--color-text-primary)' }}>
                New password
              </span>
              <input
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                required
                style={inputStyle}
              />
            </label>

            {/* Confirm password field */}
            <label style={{ fontSize: 13 }}>
              <span style={{ display: 'block', marginBottom: 6, fontWeight: 500, color: 'var(--color-text-primary)' }}>
                Confirm new password
              </span>
              <input
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                required
                style={inputStyle}
              />
            </label>
          </div>

          {state.error && (
            <div
              style={{
                backgroundColor: 'var(--color-danger-light)',
                border: '1px solid var(--color-danger)',
                color: 'var(--color-danger)',
                borderRadius: 8,
                padding: '12px 14px',
                fontSize: 13,
                marginTop: 14,
              }}
            >
              {state.error}
            </div>
          )}

          <button
            type="submit"
            className="btn-primary"
            disabled={isPending}
            style={{ padding: '10px 20px', borderRadius: 8, marginTop: 16, opacity: isPending ? 0.8 : 1 }}
          >
            {isPending ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24" style={{ color: 'var(--color-surface)' }}>
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                </svg>
                Changing password...
              </span>
            ) : (
              'Change password'
            )}
          </button>
        </form>
      </Card>
    </>
  )
}

/**
 * Login review management shown to owners.
 */
function LoginReviewsSection({ reviews }: { reviews: LoginReviewRow[] }) {
  const router = useRouter()
  const [role, setRole] = useState<LoginReviewRow['role']>('owner')
  const [reviewerName, setReviewerName] = useState('')
  const [reviewerTitle, setReviewerTitle] = useState('')
  const [quote, setQuote] = useState('')
  const [sortOrder, setSortOrder] = useState('100')
  const { toast, toastState, dismiss } = useToast()
  const [state, action, isPending] = useActionState<FormState, FormData>(addLoginReview, {
    error: null,
    success: false,
  })
  const previousPending = useRef(isPending)

  useEffect(() => {
    let refreshTimer: ReturnType<typeof setTimeout> | null = null

    if (previousPending.current && !isPending) {
      if (state.success) {
        toast.success('Login review added')
        setReviewerName('')
        setReviewerTitle('')
        setQuote('')
        setSortOrder('100')
        refreshTimer = setTimeout(() => {
          router.refresh()
        }, 0)
      } else if (state.error) {
        toast.error(state.error)
      }
    }

    previousPending.current = isPending
    return () => {
      if (refreshTimer) {
        clearTimeout(refreshTimer)
      }
    }
  }, [isPending, router, state.error, state.success, toast])

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const formData = new FormData()
    formData.set('role', role)
    formData.set('reviewerName', reviewerName)
    formData.set('reviewerTitle', reviewerTitle)
    formData.set('quote', quote)
    formData.set('sortOrder', sortOrder)

    startTransition(() => {
      action(formData)
    })
  }

  return (
    <>
      {isPending && <LoadingOverlay message="Adding login review..." />}
      {toastState && (
        <Toast
          message={toastState.message}
          type={toastState.type}
          duration={toastState.duration}
          onDismiss={dismiss}
        />
      )}

      <Card padding="md">
        <CardHeader title="Login reviews" />
        <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 0, marginBottom: 16 }}>
          Add role-specific reviews shown on the login page before users sign in.
        </p>

        <form onSubmit={onSubmit}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label style={{ fontSize: 13 }}>
              <span style={{ display: 'block', marginBottom: 6, fontWeight: 500, color: 'var(--color-text-primary)' }}>
                Review for
              </span>
              <select
                value={role}
                onChange={(event) => setRole(event.target.value as LoginReviewRow['role'])}
                required
                style={inputStyle}
              >
                <option value="owner">Owner login</option>
                <option value="admin">Admin login</option>
                <option value="employee">Employee login</option>
              </select>
            </label>

            <label style={{ fontSize: 13 }}>
              <span style={{ display: 'block', marginBottom: 6, fontWeight: 500, color: 'var(--color-text-primary)' }}>
                Sort order
              </span>
              <input
                type="number"
                min="0"
                max="10000"
                value={sortOrder}
                onChange={(event) => setSortOrder(event.target.value)}
                style={inputStyle}
              />
            </label>

            <label style={{ fontSize: 13 }}>
              <span style={{ display: 'block', marginBottom: 6, fontWeight: 500, color: 'var(--color-text-primary)' }}>
                Reviewer name
              </span>
              <input
                value={reviewerName}
                onChange={(event) => setReviewerName(event.target.value)}
                required
                style={inputStyle}
              />
            </label>

            <label style={{ fontSize: 13 }}>
              <span style={{ display: 'block', marginBottom: 6, fontWeight: 500, color: 'var(--color-text-primary)' }}>
                Reviewer title
              </span>
              <input
                value={reviewerTitle}
                onChange={(event) => setReviewerTitle(event.target.value)}
                required
                placeholder="Owner, Branch Admin, Employee..."
                style={inputStyle}
              />
            </label>
          </div>

          <label style={{ display: 'block', fontSize: 13, marginTop: 14 }}>
            <span style={{ display: 'block', marginBottom: 6, fontWeight: 500, color: 'var(--color-text-primary)' }}>
              Review
            </span>
            <textarea
              value={quote}
              onChange={(event) => setQuote(event.target.value)}
              required
              rows={4}
              maxLength={600}
              style={{
                ...inputStyle,
                height: 'auto',
                minHeight: 104,
                paddingTop: 10,
                resize: 'vertical',
              }}
            />
          </label>

          {state.error && (
            <div
              style={{
                backgroundColor: 'var(--color-danger-light)',
                border: '1px solid var(--color-danger)',
                color: 'var(--color-danger)',
                borderRadius: 8,
                padding: '12px 14px',
                fontSize: 13,
                marginTop: 14,
              }}
            >
              {state.error}
            </div>
          )}

          <button
            type="submit"
            className="btn-primary"
            disabled={isPending}
            style={{ padding: '10px 20px', borderRadius: 8, marginTop: 16, opacity: isPending ? 0.8 : 1 }}
          >
            {isPending ? 'Adding review...' : 'Add review'}
          </button>
        </form>

        <div style={{ borderTop: '1px solid var(--color-border)', marginTop: 20, paddingTop: 18 }}>
          <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)', marginTop: 0 }}>
            Existing reviews
          </p>

          {reviews.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: 0 }}>
              No reviews have been added yet.
            </p>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {reviews.map((review) => (
                <div
                  key={review.id}
                  className="rounded-xl"
                  style={{
                    border: '1px solid var(--color-border)',
                    backgroundColor: 'var(--color-background)',
                    padding: 14,
                  }}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Badge variant={review.is_active ? 'success' : 'muted'}>
                      {review.is_active ? 'Active' : 'Hidden'}
                    </Badge>
                    <Badge variant="info">{REVIEW_ROLE_LABELS[review.role]}</Badge>
                  </div>
                  <p style={{ fontSize: 14, color: 'var(--color-text-primary)', lineHeight: 1.55, marginTop: 12 }}>
                    &ldquo;{review.quote}&rdquo;
                  </p>
                  <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: 2 }}>
                    {review.reviewer_name}
                  </p>
                  <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 0 }}>
                    {review.reviewer_title} · Sort {review.sort_order}
                  </p>

                  <form action={setLoginReviewActive}>
                    <input type="hidden" name="reviewId" value={review.id} />
                    <input type="hidden" name="isActive" value={review.is_active ? 'false' : 'true'} />
                    <button
                      type="submit"
                      className={review.is_active ? 'btn-outline' : 'btn-primary'}
                      style={{ padding: '8px 14px', borderRadius: 8, marginTop: 10 }}
                    >
                      {review.is_active ? 'Hide review' : 'Show review'}
                    </button>
                  </form>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>
    </>
  )
}

/**
 * Subscription section showing the current plan and future plan options.
 */
function SubscriptionSection({
  business,
  subscription,
}: {
  business: BusinessSettingsRow
  subscription: SubscriptionRow | null
}) {
  const activePlan = subscription?.plan ?? business.subscription_plan
  const activeStatus = subscription?.status ?? business.subscription_status
  const activeCurrency = business.currency

  return (
    <Card padding="md">
      <CardHeader title="Subscription" />
      <div
        className="rounded-xl"
        style={{
          border: '1px solid var(--color-border)',
          backgroundColor: 'var(--color-background)',
          padding: 16,
          marginBottom: 16,
        }}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          {/* Current plan summary */}
          <div>
            <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text-primary)', margin: 0 }}>
              Current plan: {formatStatusLabel(activePlan)}
            </p>
            <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 6 }}>
              {subscription?.branch_count ?? 0} branches, {formatMoney(Number(subscription?.monthly_amount ?? 0), activeCurrency)} monthly
            </p>
            <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 4 }}>
              Renewal date: {formatDateLabel(subscription?.current_period_end ?? null)}
            </p>
          </div>
          <Badge variant={activeStatus === 'active' ? 'success' : 'warning'}>{formatStatusLabel(activeStatus)}</Badge>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {PLAN_OPTIONS.map((plan) => {
          const isCurrent = plan.key === activePlan

          return (
            <div
              key={plan.key}
              className="rounded-xl"
              style={{
                border: `1px solid ${isCurrent ? 'var(--color-success)' : 'var(--color-border)'}`,
                backgroundColor: isCurrent ? 'var(--color-success-light)' : 'var(--color-background)',
                padding: 16,
              }}
            >
              {/* Plan card header */}
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text-primary)', margin: 0 }}>
                    {plan.label}
                  </p>
                  <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 6 }}>
                    {formatMoney(plan.monthlyAmount, activeCurrency)}/mo
                  </p>
                </div>
                {isCurrent ? <Badge variant="success">Current</Badge> : <Badge variant="muted">Coming soon</Badge>}
              </div>

              <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 12 }}>{plan.branchLimit}</p>
              <button
                type="button"
                disabled
                className={isCurrent ? 'btn-success' : 'btn-outline'}
                style={{ padding: '8px 16px', borderRadius: 8, marginTop: 14, width: '100%', opacity: isCurrent ? 1 : 0.65 }}
              >
                {isCurrent ? 'Active plan' : 'Upgrade coming soon'}
              </button>
            </div>
          )
        })}
      </div>
    </Card>
  )
}

/**
 * Appearance section that toggles theme locally.
 */
function AppearanceSection({ userId }: { userId: string }) {
  const toggleRef = useRef<HTMLInputElement>(null)

  /**
   * Applies persisted appearance without React state to avoid hydration issues.
   */
  useEffect(() => {
    const savedMode = window.localStorage.getItem(getDashboardThemeKey(userId))
    const shouldUseDarkMode = savedMode === 'dark'
    applyDashboardTheme(savedMode)

    if (toggleRef.current) {
      toggleRef.current.checked = shouldUseDarkMode
    }
  }, [userId])

  /**
   * Saves and applies appearance immediately.
   */
  const onToggle = () => {
    const shouldUseDarkMode = Boolean(toggleRef.current?.checked)
    const nextTheme = shouldUseDarkMode ? 'dark' : 'light'
    applyDashboardTheme(nextTheme)
    window.localStorage.setItem(getDashboardThemeKey(userId), nextTheme)
  }

  return (
    <Card padding="md">
      <CardHeader title="Appearance" />
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        {/* Appearance explanation */}
        <div>
          <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)', margin: 0 }}>
            Dark mode
          </p>
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 6 }}>
            Saves to this browser for your account only and applies immediately.
          </p>
        </div>

        <label
          className="flex items-center gap-3"
          style={{
            border: '1px solid var(--color-border)',
            backgroundColor: 'var(--color-background)',
            borderRadius: 999,
            padding: '8px 14px',
            color: 'var(--color-text-primary)',
            fontSize: 13,
          }}
        >
          <input ref={toggleRef} type="checkbox" onChange={onToggle} />
          Enable dark mode
        </label>
      </div>
    </Card>
  )
}

/**
 * Danger zone with logout and account deactivation placeholder.
 */
function DangerZoneSection() {
  const [deactivateOpen, setDeactivateOpen] = useState(false)

  return (
    <Card padding="md">
      <CardHeader title="Danger zone" />
      <div
        className="rounded-xl"
        style={{
          border: '1px solid var(--color-danger)',
          backgroundColor: 'var(--color-danger-light)',
          padding: 16,
        }}
      >
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          {/* Danger zone explanation */}
          <div>
            <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-danger)', margin: 0 }}>
              Account access
            </p>
            <p style={{ fontSize: 13, color: 'var(--color-danger)', marginTop: 6 }}>
              Log out immediately or preview the future account deactivation flow.
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <form action={logoutFromSettings}>
              <button type="submit" className="btn-outline" style={{ padding: '10px 20px', borderRadius: 8 }}>
                Log out
              </button>
            </form>
            <button
              type="button"
              className="btn-danger"
              style={{ padding: '10px 20px', borderRadius: 8 }}
              onClick={() => setDeactivateOpen(true)}
            >
              Deactivate account
            </button>
          </div>
        </div>
      </div>

      <Modal isOpen={deactivateOpen} title="Deactivate account" onClose={() => setDeactivateOpen(false)}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Badge variant="warning">Coming soon</Badge>
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: 0 }}>
            Account deactivation will require additional verification and recovery safeguards before it is enabled.
          </p>
          <button
            type="button"
            className="btn-outline"
            style={{ padding: '10px 20px', borderRadius: 8 }}
            onClick={() => setDeactivateOpen(false)}
          >
            Close
          </button>
        </div>
      </Modal>
    </Card>
  )
}

/**
 * Owner settings dashboard client component.
 */
export default function SettingsPageClient({ business, ownerProfile, subscription, loginReviews }: Props) {
  return (
    <div className="flex flex-col gap-6" data-currency={business.currency}>
      {/* Page header */}
      <div>
        <h1
          className="font-bold"
          style={{
            fontSize: '22px',
            color: 'var(--color-text-primary)',
            letterSpacing: '-0.3px',
          }}
        >
          Settings
        </h1>
        <p style={{ fontSize: '14px', color: 'var(--color-text-muted)', marginTop: '4px' }}>
          Manage your business profile, security, subscription, appearance, and account access.
        </p>
      </div>

      <BusinessProfileSection business={business} />
      <AccountSecuritySection ownerProfile={ownerProfile} />
      <LoginReviewsSection reviews={loginReviews} />
      <SubscriptionSection business={business} subscription={subscription} />
      <AppearanceSection userId={ownerProfile.id} />
      <DangerZoneSection />
    </div>
  )
}
