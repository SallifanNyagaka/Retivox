'use client'

import { useActionState, useState } from 'react'
import { applyPlatformLicenseAdjustment } from '../actions'
import type { PlatformLicenseAdjustmentState } from './license-adjustment-types'

type Props = {
  businessId: string
  businessName: string
  isSuspended: boolean
  plans: Array<{ key: string; name: string }>
}

type AdjustmentAction =
  | 'suspend'
  | 'reactivate'
  | 'extend_period'
  | 'complimentary'
  | 'assign_lifetime'
  | 'change_plan'

const initialState: PlatformLicenseAdjustmentState = {
  success: false,
  error: null,
  message: null,
}

const controlStyle = {
  width: '100%',
  minHeight: 36,
  border: '1px solid var(--color-border)',
  borderRadius: 8,
  padding: '0 8px',
  background: 'var(--color-background)',
  color: 'var(--color-text-primary)',
  fontSize: 12,
} as const

export default function LicenseAdjustmentForm({
  businessId,
  businessName,
  isSuspended,
  plans,
}: Props) {
  const [action, setAction] = useState<AdjustmentAction>(
    isSuspended ? 'reactivate' : 'suspend',
  )
  const [state, formAction, isPending] = useActionState<
    PlatformLicenseAdjustmentState,
    FormData
  >(applyPlatformLicenseAdjustment, initialState)
  const needsDays = action === 'extend_period' || action === 'complimentary'
  const needsPlan = action === 'assign_lifetime' || action === 'change_plan'

  return (
    <form action={formAction} className="mt-3 grid gap-2">
      <input type="hidden" name="businessId" value={businessId} />
      <label className="grid gap-1" style={labelStyle}>
        License action
        <select
          name="action"
          value={action}
          onChange={(event) => setAction(event.target.value as AdjustmentAction)}
          required
          style={controlStyle}
        >
          <option value="suspend" disabled={isSuspended}>Suspend license</option>
          <option value="reactivate" disabled={!isSuspended}>Reactivate suspended license</option>
          <option value="extend_period">Extend paid period</option>
          <option value="complimentary">Grant complimentary access</option>
          <option value="assign_lifetime">Grant lifetime license</option>
          <option value="change_plan">Change package</option>
        </select>
      </label>

      {needsDays && (
        <label className="grid gap-1" style={labelStyle}>
          {action === 'extend_period' ? 'Days to extend' : 'Access duration in days'}
          <input
            name="days"
            type="number"
            min="1"
            max="365"
            required
            placeholder="1 to 365 days"
            style={controlStyle}
          />
        </label>
      )}

      {needsPlan && (
        <>
          <label className="grid gap-1" style={labelStyle}>
            Package
            <select name="planKey" required style={controlStyle} defaultValue="" disabled={plans.length === 0}>
              <option value="" disabled>Choose an active paid package</option>
              {plans.map((plan) => (
                <option key={plan.key} value={plan.key}>{plan.name}</option>
              ))}
            </select>
          </label>
          {plans.length === 0 && (
            <p role="alert" style={{ margin: 0, color: 'var(--color-danger)', fontSize: 12 }}>
              No active paid packages are available. Add a package in Platform → Pricing first.
            </p>
          )}
        </>
      )}

      {action === 'change_plan' && (
        <label className="grid gap-1" style={labelStyle}>
          Billing interval
          <select name="billingInterval" required style={controlStyle} defaultValue="monthly">
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
          </select>
        </label>
      )}

      {action === 'reactivate' && (
        <p style={helpStyle}>
          This removes the platform suspension. An expired or cancelled paid period may still need an extension or renewal.
        </p>
      )}

      <label className="grid gap-1" style={labelStyle}>
        Reason
        <textarea
          name="reason"
          minLength={10}
          maxLength={1000}
          required
          placeholder={`Why is this change being applied to ${businessName}?`}
          rows={2}
          style={{ ...controlStyle, height: 'auto', padding: 8, resize: 'vertical' }}
        />
      </label>

      {state.error && (
        <p role="alert" style={{ margin: 0, color: 'var(--color-danger)', fontSize: 12 }}>
          {state.error}
        </p>
      )}
      {state.success && state.message && (
        <p role="status" style={{ margin: 0, color: 'var(--color-success)', fontSize: 12 }}>
          {state.message}
        </p>
      )}

      <button
        type="submit"
        className="btn-primary"
        disabled={isPending || (needsPlan && plans.length === 0)}
        style={{ padding: '8px 12px', borderRadius: 8, opacity: isPending ? 0.65 : 1 }}
      >
        {isPending ? 'Applying license change…' : 'Apply change'}
      </button>
    </form>
  )
}

const labelStyle = {
  color: 'var(--color-text-primary)',
  fontSize: 12,
  fontWeight: 700,
} as const

const helpStyle = {
  margin: 0,
  color: 'var(--color-text-muted)',
  fontSize: 11,
  lineHeight: 1.5,
} as const
