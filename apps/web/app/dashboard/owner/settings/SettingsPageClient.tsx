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
import type { BusinessSettingsRow, FormState, LoginReviewRow, SubscriptionPaymentRequestRow, SubscriptionPlanOption, SubscriptionRow, UserProfileRow } from './types'

/**
 * Props for the settings page client.
 */
type Props = {
  billingAsOf: string
  business: BusinessSettingsRow
  ownerProfile: UserProfileRow
  subscription: SubscriptionRow | null
  subscriptionPlans: SubscriptionPlanOption[]
  subscriptionPaymentRequests: SubscriptionPaymentRequestRow[]
  loginReviews: LoginReviewRow[]
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

function getPaymentMethodLabel(method: SubscriptionPaymentRequestRow['payment_method']) {
  if (method === 'mpesa_stk') return 'M-Pesa STK Push'
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
        refreshTimer = setTimeout(() => {
          setReviewerTitle('')
          setQuote('')
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
  billingAsOf,
  business,
  subscription,
  plans,
  paymentRequests,
}: {
  billingAsOf: string
  business: BusinessSettingsRow
  subscription: SubscriptionRow | null
  plans: SubscriptionPlanOption[]
  paymentRequests: SubscriptionPaymentRequestRow[]
}) {
  const router = useRouter()
  const [paymentMethod, setPaymentMethod] = useState<SubscriptionPaymentRequestRow['payment_method']>('mpesa_stk')
  const [billingInterval, setBillingInterval] = useState<'monthly' | 'yearly'>(subscription?.next_billing_interval ?? subscription?.billing_interval ?? 'monthly')
  const activePlan = subscription?.plan ?? business.subscription_plan
  const [selectedPlanKey, setSelectedPlanKey] = useState(subscription?.next_plan_key ?? (activePlan === 'trial' ? '' : activePlan))
  const [referenceCode, setReferenceCode] = useState('')
  const [payerPhone, setPayerPhone] = useState('')
  const [stkPhone, setStkPhone] = useState('')
  const [billingClock, setBillingClock] = useState(() => new Date(billingAsOf).getTime())
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
  const activeStatus = subscription?.status ?? business.subscription_status
  const now = billingClock
  const scheduledPeriodStartTime = subscription?.next_period_start ? new Date(subscription.next_period_start).getTime() : null
  const verifiedPlanIsDue = Boolean(subscription?.next_plan_key && scheduledPeriodStartTime !== null && scheduledPeriodStartTime <= now)
  const displayPlanKey = verifiedPlanIsDue ? subscription?.next_plan_key ?? activePlan : activePlan
  const displayBillingInterval = verifiedPlanIsDue ? subscription?.next_billing_interval ?? 'monthly' : subscription?.billing_interval ?? 'monthly'
  const selectedPlan = plans.find((plan) => plan.plan_key === selectedPlanKey) ?? null
  const selectedAmount = selectedPlan
    ? billingInterval === 'yearly'
      ? Math.round(Number(selectedPlan.monthly_amount) * 12 * (1 - Number(selectedPlan.annual_discount_percent) / 100) * 100) / 100
      : Number(selectedPlan.monthly_amount)
    : 0
  const periodEndTime = subscription?.current_period_end ? new Date(subscription.current_period_end).getTime() : null
  const displayPeriodEndTime = verifiedPlanIsDue
    ? now + (displayBillingInterval === 'yearly' ? 365 : 30) * 86400000
    : periodEndTime
  const daysUntilRenewal = displayPeriodEndTime === null ? null : Math.max(0, Math.ceil((displayPeriodEndTime - now) / 86400000))
  const isPeriodOver = periodEndTime !== null && periodEndTime <= now && !verifiedPlanIsDue
  const graceEndsAt = periodEndTime === null ? null : periodEndTime + 3 * 86400000
  const graceDaysRemaining = graceEndsAt === null ? 0 : Math.max(0, Math.ceil((graceEndsAt - now) / 86400000))
  const pendingPlan = subscription?.next_plan_key ? plans.find((plan) => plan.plan_key === subscription.next_plan_key) : null

  useEffect(() => {
    const interval = window.setInterval(() => setBillingClock(Date.now()), 60_000)
    return () => window.clearInterval(interval)
  }, [])

  useEffect(() => {
    let refreshTimer: ReturnType<typeof setTimeout> | null = null

    if (previousPending.current && !isPending) {
      if (state.success) {
        toast.success('Payment reference submitted for verification')
        refreshTimer = setTimeout(() => {
          setReferenceCode('')
          setPayerPhone('')
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
        toast.success(stkState.message ?? 'M-Pesa prompt sent. Complete it on your phone.')
        refreshTimer = setTimeout(() => {
          setStkPhone('')
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
  }, [isStkPending, router, stkState.error, stkState.message, stkState.success, toast])

  const onSubmitPayment = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const formData = new FormData()
    formData.set('planKey', selectedPlanKey)
    formData.set('billingInterval', billingInterval)
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
    formData.set('planKey', selectedPlanKey)
    formData.set('billingInterval', billingInterval)

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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between" style={{ borderBottom: '1px solid var(--color-border)', paddingBottom: 16 }}>
        <div>
          <p style={{ fontSize: 16, fontWeight: 750, color: 'var(--color-text-primary)', margin: 0 }}>
            {displayPlanKey === 'trial' ? 'Free' : plans.find((plan) => plan.plan_key === displayPlanKey)?.name ?? formatStatusLabel(displayPlanKey)} plan
          </p>
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: '6px 0 0' }}>
              {displayPlanKey === 'trial'
              ? 'Free access for 30 days from registration.'
                : `${subscription?.branch_count ?? 0} branches · ${displayBillingInterval} billing`}
          </p>
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: '4px 0 0' }}>
            {verifiedPlanIsDue
              ? 'A verified payment is ready; access resumes with this paid plan.'
              : daysUntilRenewal === null
              ? 'Renewal date not available'
              : isPeriodOver
                ? graceDaysRemaining > 0 ? `Read-only grace period · ${graceDaysRemaining} days remaining` : 'Payment required to resume business activity'
                : `${daysUntilRenewal} days until renewal · ${formatDateLabel(subscription?.current_period_end ?? null)}`}
          </p>
          {pendingPlan && subscription?.next_period_start && (
            <p style={{ fontSize: 13, color: 'var(--color-primary)', margin: '5px 0 0' }}>
              {pendingPlan.name} {subscription.next_billing_interval} plan {verifiedPlanIsDue ? 'is ready to activate' : `is scheduled for ${formatDateLabel(subscription.next_period_start)} after payment verification`}.
            </p>
          )}
        </div>
        <Badge variant={isPeriodOver ? 'danger' : activeStatus === 'active' ? 'success' : 'warning'}>
          {isPeriodOver ? 'Read only' : formatStatusLabel(activeStatus)}
        </Badge>
      </div>

      {isPeriodOver && (
        <div role="status" style={{ border: '1px solid var(--color-warning)', backgroundColor: 'var(--color-warning-light)', borderRadius: 8, padding: 12, marginTop: 14, color: 'var(--color-text-primary)', fontSize: 13 }}>
          Transactions and business changes are paused until a subscription payment is verified. Settings and business data remain available.
        </div>
      )}

      <div className="flex flex-col gap-4" style={{ paddingTop: 18 }}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p style={{ fontSize: 14, fontWeight: 750, color: 'var(--color-text-primary)', margin: 0 }}>Choose a plan</p>
          <div className="flex gap-2" role="group" aria-label="Billing period">
            {(['monthly', 'yearly'] as const).map((interval) => (
              <button
                key={interval}
                type="button"
                aria-pressed={billingInterval === interval}
                className={billingInterval === interval ? 'btn-primary' : 'btn-outline'}
                onClick={() => setBillingInterval(interval)}
                style={{ borderRadius: 8, padding: '8px 12px' }}
              >
                {interval === 'monthly' ? 'Monthly' : 'Yearly'}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {plans.map((plan) => {
            const isCurrent = plan.plan_key === activePlan
            const isSelected = plan.plan_key === selectedPlanKey
            const annualAmount = Math.round(Number(plan.monthly_amount) * 12 * (1 - Number(plan.annual_discount_percent) / 100) * 100) / 100
            const price = billingInterval === 'yearly' ? annualAmount : Number(plan.monthly_amount)
            const unit = billingInterval === 'yearly' ? '/year' : '/month'

            return (
              <button
                key={plan.id}
                type="button"
                disabled={plan.plan_key === 'trial' && !isCurrent}
                aria-pressed={isSelected}
                onClick={() => {
                  if (plan.plan_key !== 'trial') setSelectedPlanKey(plan.plan_key)
                }}
                className="text-left"
                style={{
                  border: `1px solid ${isSelected || isCurrent ? 'var(--color-success)' : 'var(--color-border)'}`,
                  borderRadius: 8,
                  backgroundColor: isSelected || isCurrent ? 'var(--color-success-light)' : 'var(--color-background)',
                  padding: 14,
                  color: 'var(--color-text-primary)',
                }}
              >
                <span className="flex items-center justify-between gap-2">
                  <strong style={{ fontSize: 14 }}>{plan.plan_key === 'trial' ? 'Free' : plan.name}</strong>
                  {isCurrent && <Badge variant="success">Current</Badge>}
                </span>
                <span style={{ display: 'block', fontSize: 18, fontWeight: 800, marginTop: 10 }}>
                  {formatMoney(price, plan.currency)}<small style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-text-muted)' }}>{unit}</small>
                </span>
                {billingInterval === 'yearly' && plan.plan_key !== 'trial' && (
                  <span style={{ display: 'block', color: 'var(--color-success)', fontSize: 12, marginTop: 4 }}>
                    {plan.annual_discount_percent}% off monthly pricing
                  </span>
                )}
                <span style={{ display: 'block', color: 'var(--color-text-muted)', fontSize: 12, lineHeight: 1.5, marginTop: 8 }}>
                  {plan.description || (plan.branch_limit ? `Up to ${plan.branch_limit} branches` : 'Unlimited branches')}
                </span>
                <span style={{ display: 'block', color: 'var(--color-text-muted)', fontSize: 11, marginTop: 8 }}>
                  {plan.branch_limit ? `${plan.branch_limit} branch limit` : 'Unlimited branches'}
                </span>
              </button>
            )
          })}
        </div>

        {selectedPlan && selectedPlan.plan_key !== 'trial' && (
          <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 16 }}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p style={{ fontSize: 14, fontWeight: 750, color: 'var(--color-text-primary)', margin: 0 }}>
                {selectedPlan.name} · {billingInterval} · {formatMoney(selectedAmount, selectedPlan.currency)}
              </p>
              <span style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>
                {activePlan === 'trial' && !isPeriodOver ? 'Starts after your free month' : isPeriodOver ? 'Starts immediately after payment is verified' : 'Starts at your next renewal after payment is verified'}
              </span>
            </div>

            <div className="flex flex-wrap gap-2" style={{ marginTop: 14 }} role="group" aria-label="Subscription payment method">
              {([
                ['mpesa_stk', 'M-Pesa prompt'],
                ['mpesa_manual', 'M-Pesa reference'],
                ['bank_transfer', 'Bank transfer'],
                ['cash_deposit', 'Cash deposit'],
                ['other', 'Other'],
              ] as const).map(([method, label]) => (
                <button
                  key={method}
                  type="button"
                  aria-pressed={paymentMethod === method}
                  className={paymentMethod === method ? 'btn-primary' : 'btn-outline'}
                  onClick={() => setPaymentMethod(method)}
                  style={{ borderRadius: 8, padding: '8px 11px', fontSize: 12 }}
                >
                  {label}
                </button>
              ))}
            </div>

            {paymentMethod === 'mpesa_stk' ? (
              <form onSubmit={onSubmitStk} className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto] sm:items-end" style={{ marginTop: 14 }}>
                <label style={{ fontSize: 13 }}>
                  M-Pesa phone number
                  <input value={stkPhone} onChange={(event) => setStkPhone(event.target.value)} placeholder="07XXXXXXXX" required style={inputStyle} />
                </label>
                <button type="submit" className="btn-success" disabled={isStkPending || !Number.isInteger(selectedAmount)} style={{ borderRadius: 8, padding: '11px 18px' }}>
                  {isStkPending ? 'Sending prompt...' : `Pay ${formatMoney(selectedAmount, selectedPlan.currency)}`}
                </button>
                {stkState.error && <p style={{ margin: 0, fontSize: 13, color: 'var(--color-danger)' }}>{stkState.error}</p>}
                {!Number.isInteger(selectedAmount) && <p style={{ margin: 0, fontSize: 12, color: 'var(--color-text-muted)' }}>This amount is not a whole number; select a manual payment method.</p>}
                <p style={{ gridColumn: '1 / -1', margin: 0, fontSize: 12, color: 'var(--color-text-muted)' }}>
                  Complete the prompt on your phone. Retivox never asks for or stores your M-Pesa PIN.
                </p>
              </form>
            ) : (
              <form onSubmit={onSubmitPayment} className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end" style={{ marginTop: 14 }}>
                <label style={{ fontSize: 13 }}>
                  Payment reference
                  <input value={referenceCode} onChange={(event) => setReferenceCode(event.target.value.toUpperCase())} placeholder="Transaction or deposit reference" required style={inputStyle} />
                </label>
                <label style={{ fontSize: 13 }}>
                  Payer phone or note
                  <input value={payerPhone} onChange={(event) => setPayerPhone(event.target.value)} placeholder="Optional" style={inputStyle} />
                </label>
                <button type="submit" className="btn-primary" disabled={isPending} style={{ borderRadius: 8, padding: '11px 16px' }}>
                  {isPending ? 'Submitting...' : 'Submit for review'}
                </button>
                {state.error && <p style={{ gridColumn: '1 / -1', margin: 0, fontSize: 13, color: 'var(--color-danger)' }}>{state.error}</p>}
                <p style={{ gridColumn: '1 / -1', margin: 0, fontSize: 12, color: 'var(--color-text-muted)' }}>
                  Access resumes after a platform developer verifies the payment.
                </p>
              </form>
            )}
          </div>
        )}
      </div>

      <div style={{ borderTop: '1px solid var(--color-border)', marginTop: 20, paddingTop: 18 }}>
        <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-text-primary)', marginTop: 0 }}>
          Recent subscription payments
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
                  {['Date', 'Method', 'Reference / Receipt', 'Amount', 'Status'].map((heading) => (
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
                      {request.plan_key && (
                        <span style={{ display: 'block', color: 'var(--color-text-muted)', fontSize: 11, marginTop: 3 }}>
                          {formatStatusLabel(request.plan_key)} · {request.billing_interval}
                        </span>
                      )}
                    </td>
                    <td style={{ padding: 12, fontSize: 13, color: 'var(--color-text-primary)' }}>
                      <span style={{ display: 'block', fontWeight: 700 }}>
                        {request.provider_receipt_number ?? request.reference_code}
                      </span>
                      {request.provider_checkout_request_id && (
                        <span style={{ display: 'block', color: 'var(--color-text-muted)', fontSize: 11, marginTop: 3 }}>
                          Checkout {request.provider_checkout_request_id}
                        </span>
                      )}
                    </td>
                    <td style={{ padding: 12, fontSize: 13, color: 'var(--color-text-primary)' }}>
                      {formatMoney(Number(request.provider_paid_amount ?? request.amount), request.currency)}
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
export default function SettingsPageClient({ billingAsOf, business, ownerProfile, subscription, subscriptionPlans, subscriptionPaymentRequests, loginReviews }: Props) {
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
      <SubscriptionSection billingAsOf={billingAsOf} business={business} subscription={subscription} plans={subscriptionPlans} paymentRequests={subscriptionPaymentRequests} />
      <AppearanceSection userId={ownerProfile.id} />
      <DangerZoneSection />
    </div>
  )
}
