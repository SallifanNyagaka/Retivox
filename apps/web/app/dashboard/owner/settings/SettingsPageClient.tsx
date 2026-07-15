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
import { changePassword, initiateSubscriptionStkPush, logoutFromSettings, submitOwnerLoginReview, submitSubscriptionPayment, updateBusinessProfile } from './actions'
import type { BusinessSettingsRow, FormState, LoginReviewRow, SubscriptionPaymentRequestRow, SubscriptionRow, UserProfileRow } from './types'

/**
 * Props for the settings page client.
 */
type Props = {
  business: BusinessSettingsRow
  ownerProfile: UserProfileRow
  subscription: SubscriptionRow | null
  subscriptionPaymentRequests: SubscriptionPaymentRequestRow[]
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
  { key: 'starter', label: 'Starter', monthlyAmount: 200, branchLimit: 'MVP rental plan' },
  { key: 'growth', label: 'Growth', monthlyAmount: 5000, branchLimit: 'Up to 10 branches' },
  { key: 'enterprise', label: 'Enterprise', monthlyAmount: 12000, branchLimit: 'Unlimited branches' },
]

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

function getPaymentMethodLabel(method: SubscriptionPaymentRequestRow['payment_method']) {
  if (method === 'mpesa_manual') return 'M-Pesa'
  if (method === 'bank_transfer') return 'Bank transfer'
  if (method === 'cash_deposit') return 'Cash deposit'
  return 'Other'
}

function getPaymentStatusVariant(status: SubscriptionPaymentRequestRow['status']): 'success' | 'warning' | 'danger' | 'muted' {
  if (status === 'verified') return 'success'
  if (status === 'rejected') return 'danger'
  return 'warning'
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

function reviewStatusBadgeVariant(status: LoginReviewRow['status']) {
  if (status === 'approved') return 'success'
  if (status === 'rejected') return 'danger'
  return 'warning'
}

function reviewStatusLabel(status: LoginReviewRow['status']) {
  if (status === 'approved') return 'Approved'
  if (status === 'rejected') return 'Rejected'
  return 'Pending approval'
}

/**
 * Owner review submission shown in settings.
 */
function LoginReviewsSection({ reviews }: { reviews: LoginReviewRow[] }) {
  const router = useRouter()
  const [reviewerTitle, setReviewerTitle] = useState('')
  const [quote, setQuote] = useState('')
  const { toast, toastState, dismiss } = useToast()
  const [state, action, isPending] = useActionState<FormState, FormData>(submitOwnerLoginReview, {
    error: null,
    success: false,
  })
  const previousPending = useRef(isPending)

  useEffect(() => {
    let refreshTimer: ReturnType<typeof setTimeout> | null = null

    if (previousPending.current && !isPending) {
      if (state.success) {
        toast.success('Review submitted for platform approval')
        setReviewerTitle('')
        setQuote('')
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
    formData.set('reviewerTitle', reviewerTitle)
    formData.set('quote', quote)

    startTransition(() => {
      action(formData)
    })
  }

  return (
    <>
      {isPending && <LoadingOverlay message="Submitting review..." />}
      {toastState && (
        <Toast
          message={toastState.message}
          type={toastState.type}
          duration={toastState.duration}
          onDismiss={dismiss}
        />
      )}

      <Card padding="md">
        <CardHeader title="My login review" />
        <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 0, marginBottom: 16 }}>
          Share a short owner review. It appears on the owner login page only after the Retivox platform team approves it.
        </p>

        <form onSubmit={onSubmit}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label style={{ fontSize: 13 }}>
              <span style={{ display: 'block', marginBottom: 6, fontWeight: 500, color: 'var(--color-text-primary)' }}>
                Your display title
              </span>
              <input
                value={reviewerTitle}
                onChange={(event) => setReviewerTitle(event.target.value)}
                required
                placeholder="Owner, Founder, Retail operator..."
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
            {isPending ? 'Submitting review...' : 'Submit review for approval'}
          </button>
        </form>

        <div style={{ borderTop: '1px solid var(--color-border)', marginTop: 20, paddingTop: 18 }}>
          <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)', marginTop: 0 }}>
            My submitted reviews
          </p>

          {reviews.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: 0 }}>
              You have not submitted a review yet.
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
                    <Badge variant={reviewStatusBadgeVariant(review.status)}>
                      {reviewStatusLabel(review.status)}
                    </Badge>
                    {review.status === 'approved' && (
                      <Badge variant="info">Visible on owner login</Badge>
                    )}
                  </div>
                  <p style={{ fontSize: 14, color: 'var(--color-text-primary)', lineHeight: 1.55, marginTop: 12 }}>
                    &ldquo;{review.quote}&rdquo;
                  </p>
                  <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: 2 }}>
                    {review.reviewer_name}
                  </p>
                  <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 0 }}>
                    {review.reviewer_title} - Submitted {formatDateLabel(review.created_at)}
                  </p>

                  {review.approved_at && (
                    <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 6, marginBottom: 0 }}>
                      Approved {formatDateLabel(review.approved_at)}
                    </p>
                  )}
                  {review.review_note && (
                    <p
                      style={{
                        border: '1px solid var(--color-border)',
                        borderRadius: 8,
                        color: 'var(--color-text-muted)',
                        fontSize: 12,
                        lineHeight: 1.5,
                        marginTop: 10,
                        padding: '8px 10px',
                      }}
                    >
                      Platform note: {review.review_note}
                    </p>
                  )}
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
  paymentRequests,
}: {
  business: BusinessSettingsRow
  subscription: SubscriptionRow | null
  paymentRequests: SubscriptionPaymentRequestRow[]
}) {
  const router = useRouter()
  const [paymentMethod, setPaymentMethod] = useState<SubscriptionPaymentRequestRow['payment_method']>('mpesa_manual')
  const [referenceCode, setReferenceCode] = useState('')
  const [payerPhone, setPayerPhone] = useState('')
  const [stkPhone, setStkPhone] = useState('')
  const { toast, toastState, dismiss } = useToast()
  const [state, action, isPending] = useActionState<FormState, FormData>(submitSubscriptionPayment, {
    error: null,
    success: false,
  })
  const [stkState, stkAction, isStkPending] = useActionState<FormState, FormData>(initiateSubscriptionStkPush, {
    error: null,
    success: false,
  })
  const previousPending = useRef(isPending)
  const previousStkPending = useRef(isStkPending)
  const activePlan = subscription?.plan ?? business.subscription_plan
  const activeStatus = subscription?.status ?? business.subscription_status
  const activeCurrency = subscription?.currency ?? business.currency

  useEffect(() => {
    let refreshTimer: ReturnType<typeof setTimeout> | null = null

    if (previousPending.current && !isPending) {
      if (state.success) {
        toast.success('Payment reference submitted for verification')
        setReferenceCode('')
        setPayerPhone('')
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

  useEffect(() => {
    let refreshTimer: ReturnType<typeof setTimeout> | null = null

    if (previousStkPending.current && !isStkPending) {
      if (stkState.success) {
        toast.success('M-Pesa prompt sent. Complete it on your phone.')
        setStkPhone('')
        refreshTimer = setTimeout(() => {
          router.refresh()
        }, 0)
      } else if (stkState.error) {
        toast.error(stkState.error)
      }
    }

    previousStkPending.current = isStkPending
    return () => {
      if (refreshTimer) {
        clearTimeout(refreshTimer)
      }
    }
  }, [isStkPending, router, stkState.error, stkState.success, toast])

  const onSubmitPayment = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const formData = new FormData()
    formData.set('paymentMethod', paymentMethod)
    formData.set('referenceCode', referenceCode)
    formData.set('payerPhone', payerPhone)

    startTransition(() => {
      action(formData)
    })
  }

  const onSubmitStk = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const formData = new FormData()
    formData.set('phone', stkPhone)

    startTransition(() => {
      stkAction(formData)
    })
  }

  return (
    <>
    {(isPending || isStkPending) && <LoadingOverlay message={isStkPending ? 'Sending M-Pesa prompt...' : 'Submitting payment reference...'} />}
    {toastState && (
      <Toast
        message={toastState.message}
        type={toastState.type}
        duration={toastState.duration}
        onDismiss={dismiss}
      />
    )}
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

      <div
        className="rounded-xl"
        style={{
          border: '1px solid var(--color-border)',
          backgroundColor: 'var(--color-background)',
          padding: 16,
          marginTop: 18,
        }}
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--color-text-primary)', margin: 0 }}>
              Submit rental payment
            </p>
            <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 6 }}>
              Pay {formatMoney(Number(subscription?.monthly_amount ?? 200), activeCurrency)} for this month, then enter the transaction reference here.
            </p>
          </div>
          <Badge variant="info">Manual verification</Badge>
        </div>

        <form
          onSubmit={onSubmitStk}
          className="rounded-xl"
          style={{
            border: '1px solid var(--color-success)',
            backgroundColor: 'var(--color-success-light)',
            padding: 14,
            marginTop: 16,
          }}
        >
          <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_auto] md:items-end">
            <label style={{ fontSize: 13 }}>
              <span style={{ display: 'block', marginBottom: 6, fontWeight: 700, color: 'var(--color-text-primary)' }}>
                Pay with M-Pesa STK Push
              </span>
              <input
                value={stkPhone}
                onChange={(event) => setStkPhone(event.target.value)}
                placeholder="07XXXXXXXX"
                required
                style={inputStyle}
              />
            </label>
            <button
              type="submit"
              className="btn-success"
              disabled={isStkPending}
              style={{ padding: '11px 18px', borderRadius: 8, opacity: isStkPending ? 0.8 : 1 }}
            >
              {isStkPending ? 'Sending...' : `Pay ${formatMoney(Number(subscription?.monthly_amount ?? 200), activeCurrency)}`}
            </button>
          </div>
          {stkState.error && (
            <p style={{ margin: '10px 0 0', fontSize: 13, color: 'var(--color-danger)' }}>
              {stkState.error}
            </p>
          )}
          <p style={{ margin: '10px 0 0', fontSize: 12, color: 'var(--color-text-muted)' }}>
            You will receive an M-Pesa prompt on this phone. After payment, Daraja confirms it automatically.
          </p>
        </form>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 16 }}>
          <div style={{ height: 1, backgroundColor: 'var(--color-border)', flex: 1 }} />
          <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Manual fallback</span>
          <div style={{ height: 1, backgroundColor: 'var(--color-border)', flex: 1 }} />
        </div>

        <form onSubmit={onSubmitPayment} style={{ marginTop: 16 }}>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <label style={{ fontSize: 13 }}>
              <span style={{ display: 'block', marginBottom: 6, fontWeight: 500, color: 'var(--color-text-primary)' }}>
                Payment method
              </span>
              <select
                value={paymentMethod}
                onChange={(event) => setPaymentMethod(event.target.value as SubscriptionPaymentRequestRow['payment_method'])}
                style={inputStyle}
              >
                <option value="mpesa_manual">M-Pesa</option>
                <option value="bank_transfer">Bank transfer</option>
                <option value="cash_deposit">Cash deposit</option>
                <option value="other">Other</option>
              </select>
            </label>

            <label style={{ fontSize: 13 }}>
              <span style={{ display: 'block', marginBottom: 6, fontWeight: 500, color: 'var(--color-text-primary)' }}>
                Reference code
              </span>
              <input
                value={referenceCode}
                onChange={(event) => setReferenceCode(event.target.value.toUpperCase())}
                placeholder="e.g. QG12ABC345"
                required
                style={inputStyle}
              />
            </label>

            <label style={{ fontSize: 13 }}>
              <span style={{ display: 'block', marginBottom: 6, fontWeight: 500, color: 'var(--color-text-primary)' }}>
                Phone / payer note
              </span>
              <input
                value={payerPhone}
                onChange={(event) => setPayerPhone(event.target.value)}
                placeholder="Optional"
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
            {isPending ? 'Submitting...' : 'Submit payment reference'}
          </button>
        </form>
      </div>

      <div style={{ borderTop: '1px solid var(--color-border)', marginTop: 20, paddingTop: 18 }}>
        <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-text-primary)', marginTop: 0 }}>
          Recent payment references
        </p>
        {paymentRequests.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: 0 }}>
            No rental payment references have been submitted yet.
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderSpacing: 0 }}>
              <thead>
                <tr style={{ textAlign: 'left' }}>
                  {['Date', 'Method', 'Reference', 'Amount', 'Status'].map((heading) => (
                    <th key={heading} style={{ padding: 12, fontSize: 12, color: 'var(--color-text-muted)' }}>
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paymentRequests.map((request, index) => (
                  <tr
                    key={request.id}
                    style={{ backgroundColor: index % 2 === 0 ? 'var(--color-background)' : 'var(--color-surface)' }}
                  >
                    <td style={{ padding: 12, fontSize: 13, color: 'var(--color-text-primary)' }}>
                      {formatDateLabel(request.submitted_at)}
                    </td>
                    <td style={{ padding: 12, fontSize: 13, color: 'var(--color-text-primary)' }}>
                      {getPaymentMethodLabel(request.payment_method)}
                    </td>
                    <td style={{ padding: 12, fontSize: 13, color: 'var(--color-text-primary)' }}>
                      {request.reference_code}
                    </td>
                    <td style={{ padding: 12, fontSize: 13, color: 'var(--color-text-primary)' }}>
                      {formatMoney(Number(request.amount), request.currency)}
                    </td>
                    <td style={{ padding: 12 }}>
                      <Badge variant={getPaymentStatusVariant(request.status)}>
                        {formatStatusLabel(request.status)}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Card>
    </>
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
export default function SettingsPageClient({ business, ownerProfile, subscription, subscriptionPaymentRequests, loginReviews }: Props) {
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
      <SubscriptionSection business={business} subscription={subscription} paymentRequests={subscriptionPaymentRequests} />
      <AppearanceSection userId={ownerProfile.id} />
      <DangerZoneSection />
    </div>
  )
}
