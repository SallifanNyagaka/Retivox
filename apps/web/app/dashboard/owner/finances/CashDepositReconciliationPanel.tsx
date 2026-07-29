'use client'
/**
 * Cash deposit reconciliation controls for owner finances.
 */

import { startTransition, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useActionState } from 'react'
import { formatCurrency } from '@smartretail/shared'
import { Card, CardHeader } from '../../../../components/ui/Card'
import LoadingOverlay from '../../../../components/ui/LoadingOverlay'
import Toast from '../../../../components/ui/Toast'
import { useToast } from '../../../../lib/hooks/useToast'
import {
  recordBranchCashDeposit,
  reviewBranchCashDeposit,
  type FinanceFormState,
} from './actions'

type BranchOption = {
  id: string
  name: string
}

export type BranchPaymentSummary = {
  branchId: string
  branchName: string
  cashRecorded: number
  cashVerified: number
  cashPending: number
  eMoneyRecorded: number
  eMoneyVerified: number
  eMoneyPending: number
  pendingDepositAmount: number
  verifiedDepositAmount: number
  varianceAmount: number
}

export type CashDepositRow = {
  id: string
  branchId: string
  branchName: string
  depositedByName: string | null
  depositDate: string
  amount: number
  expectedCashAmount: number
  varianceAmount: number
  depositReference: string
  note: string | null
  reviewNote: string | null
  status: 'pending' | 'verified' | 'rejected'
  createdAt: string
}

type Props = {
  branches: BranchOption[]
  summaries: BranchPaymentSummary[]
  deposits: CashDepositRow[]
  currency: string
  defaultDate: string
}

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

const emptyState: FinanceFormState = { success: false, error: null }

export default function CashDepositReconciliationPanel({
  branches,
  summaries,
  deposits,
  currency,
  defaultDate,
}: Props) {
  const { toast, toastState, dismiss } = useToast()
  const [depositState, depositAction, depositPending] = useActionState<FinanceFormState, FormData>(
    recordBranchCashDeposit,
    emptyState
  )
  const [reviewState, reviewAction, reviewPending] = useActionState<FinanceFormState, FormData>(
    reviewBranchCashDeposit,
    emptyState
  )
  const previousDepositPending = useRef(depositPending)
  const previousReviewPending = useRef(reviewPending)
  const [branchId, setBranchId] = useState(branches[0]?.id ?? '')
  const [depositDate, setDepositDate] = useState(defaultDate)
  const [amount, setAmount] = useState('')
  const [depositReference, setDepositReference] = useState('')
  const [note, setNote] = useState('')

  const selectedSummary = useMemo(
    () => summaries.find((summary) => summary.branchId === branchId) ?? null,
    [branchId, summaries]
  )
  const pendingDeposits = deposits.filter((deposit) => deposit.status === 'pending')

  useEffect(() => {
    if (previousDepositPending.current && !depositPending) {
      if (depositState.success) {
        toast.success('Cash deposit recorded')
        setAmount('')
        setDepositReference('')
        setNote('')
      } else if (depositState.error) {
        toast.error(depositState.error)
      }
    }

    previousDepositPending.current = depositPending
  }, [depositPending, depositState.error, depositState.success, toast])

  useEffect(() => {
    if (previousReviewPending.current && !reviewPending) {
      if (reviewState.success) {
        toast.success('Cash deposit review saved')
      } else if (reviewState.error) {
        toast.error(reviewState.error)
      }
    }

    previousReviewPending.current = reviewPending
  }, [reviewPending, reviewState.error, reviewState.success, toast])

  const onDepositSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const formData = new FormData()
    formData.set('branchId', branchId)
    formData.set('depositDate', depositDate)
    formData.set('amount', amount)
    formData.set('depositReference', depositReference)
    formData.set('note', note)

    startTransition(() => {
      depositAction(formData)
    })
  }

  const submitReview = (depositId: string, action: 'approve' | 'reject') => {
    const formData = new FormData()
    formData.set('depositId', depositId)
    formData.set('action', action)

    startTransition(() => {
      reviewAction(formData)
    })
  }

  return (
    <>
      {(depositPending || reviewPending) && (
        <LoadingOverlay message={depositPending ? 'Recording cash deposit...' : 'Reviewing cash deposit...'} />
      )}
      {toastState && <Toast message={toastState.message} type={toastState.type} duration={toastState.duration} onDismiss={dismiss} />}

      <Card padding="md">
        <CardHeader title="Branch payment totals" />
        {summaries.length === 0 ? (
          <p style={{ margin: 0, fontSize: 14, color: 'var(--color-text-muted)' }}>
            No cash or M-Pesa payments were recorded for this period.
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                  {['Branch', 'Cash recorded', 'Cash verified', 'Cash pending', 'M-Pesa/e-money', 'Deposits', 'Variance'].map((heading) => (
                    <th key={heading} style={{ padding: 12, textAlign: 'left', color: 'var(--color-text-muted)' }}>{heading}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {summaries.map((summary) => (
                  <tr key={summary.branchId} style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <td style={{ padding: 12, color: 'var(--color-text-primary)', fontWeight: 700 }}>{summary.branchName}</td>
                    <td style={{ padding: 12, color: 'var(--color-text-primary)' }}>{formatCurrency(summary.cashRecorded, currency)}</td>
                    <td style={{ padding: 12, color: 'var(--color-success)', fontWeight: 700 }}>{formatCurrency(summary.cashVerified, currency)}</td>
                    <td style={{ padding: 12, color: summary.cashPending > 0 ? 'var(--color-warning)' : 'var(--color-text-muted)', fontWeight: 700 }}>
                      {formatCurrency(summary.cashPending, currency)}
                    </td>
                    <td style={{ padding: 12, color: 'var(--color-text-primary)' }}>
                      {formatCurrency(summary.eMoneyRecorded, currency)}
                      <span style={{ display: 'block', marginTop: 3, color: 'var(--color-text-muted)', fontSize: 12 }}>
                        {formatCurrency(summary.eMoneyVerified, currency)} verified, {formatCurrency(summary.eMoneyPending, currency)} pending
                      </span>
                    </td>
                    <td style={{ padding: 12, color: 'var(--color-text-primary)' }}>
                      {formatCurrency(summary.verifiedDepositAmount, currency)} verified
                      <span style={{ display: 'block', marginTop: 3, color: 'var(--color-text-muted)', fontSize: 12 }}>
                        {formatCurrency(summary.pendingDepositAmount, currency)} pending
                      </span>
                    </td>
                    <td style={{ padding: 12, color: summary.varianceAmount === 0 ? 'var(--color-success)' : 'var(--color-danger)', fontWeight: 700 }}>
                      {formatCurrency(summary.varianceAmount, currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <Card padding="md">
          <CardHeader title="Record cash deposit" />
          <form onSubmit={onDepositSubmit} className="flex flex-col gap-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label style={{ fontSize: 13 }}>
                <span style={{ display: 'block', marginBottom: 6, fontWeight: 500 }}>Branch</span>
                <select value={branchId} onChange={(event) => setBranchId(event.target.value)} required style={inputStyle}>
                  <option value="">Select branch</option>
                  {branches.map((branch) => (
                    <option key={branch.id} value={branch.id}>{branch.name}</option>
                  ))}
                </select>
              </label>
              <label style={{ fontSize: 13 }}>
                <span style={{ display: 'block', marginBottom: 6, fontWeight: 500 }}>Deposit date</span>
                <input type="date" value={depositDate} onChange={(event) => setDepositDate(event.target.value)} required style={inputStyle} />
              </label>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label style={{ fontSize: 13 }}>
                <span style={{ display: 'block', marginBottom: 6, fontWeight: 500 }}>Amount deposited</span>
                <input type="number" min={1} step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} required style={inputStyle} />
              </label>
              <label style={{ fontSize: 13 }}>
                <span style={{ display: 'block', marginBottom: 6, fontWeight: 500 }}>Bank / agent reference</span>
                <input value={depositReference} onChange={(event) => setDepositReference(event.target.value)} required placeholder="e.g. MPESA agent or bank slip ref" style={inputStyle} />
              </label>
            </div>

            <label style={{ fontSize: 13 }}>
              <span style={{ display: 'block', marginBottom: 6, fontWeight: 500 }}>Note</span>
              <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Optional depositor note" style={inputStyle} />
            </label>

            <p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: 12, lineHeight: 1.5 }}>
              Current period cash for {selectedSummary?.branchName ?? 'this branch'}: {formatCurrency(selectedSummary?.cashRecorded ?? 0, currency)}.
              The owner can approve the deposit only when the deposited amount matches recorded cash for the selected date.
            </p>

            {depositState.error && <p style={{ margin: 0, color: 'var(--color-danger)', fontSize: 13 }}>{depositState.error}</p>}
            <button type="submit" className="btn-primary" disabled={depositPending || branches.length === 0} style={{ padding: '10px 16px', borderRadius: 8 }}>
              Record deposit
            </button>
          </form>
        </Card>

        <Card padding="md">
          <CardHeader title="Pending cash reviews" />
          {pendingDeposits.length === 0 ? (
            <p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: 14 }}>
              No cash deposits need review.
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {pendingDeposits.map((deposit) => (
                <div
                  key={deposit.id}
                  style={{
                    border: '1px solid var(--color-border)',
                    borderRadius: 12,
                    padding: 12,
                    backgroundColor: 'var(--color-background-subtle)',
                  }}
                >
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                    <div>
                      <p style={{ margin: 0, fontWeight: 800, color: 'var(--color-text-primary)' }}>{deposit.branchName}</p>
                      <p style={{ margin: '4px 0 0', color: 'var(--color-text-muted)', fontSize: 12 }}>
                        {deposit.depositDate} by {deposit.depositedByName ?? 'Unknown user'} - Ref {deposit.depositReference}
                      </p>
                      {deposit.note && (
                        <p style={{ margin: '6px 0 0', color: 'var(--color-text-muted)', fontSize: 12 }}>{deposit.note}</p>
                      )}
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <p style={{ margin: 0, color: 'var(--color-text-primary)', fontWeight: 800 }}>{formatCurrency(deposit.amount, currency)}</p>
                      <p style={{ margin: '4px 0 0', color: deposit.varianceAmount === 0 ? 'var(--color-success)' : 'var(--color-danger)', fontSize: 12, fontWeight: 700 }}>
                        Expected {formatCurrency(deposit.expectedCashAmount, currency)} - Variance {formatCurrency(deposit.varianceAmount, currency)}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2 mt-3">
                    <button
                      type="button"
                      className="btn-primary"
                      disabled={reviewPending || deposit.varianceAmount !== 0}
                      onClick={() => submitReview(deposit.id, 'approve')}
                      style={{ padding: '8px 12px', borderRadius: 8 }}
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      disabled={reviewPending}
                      onClick={() => submitReview(deposit.id, 'reject')}
                      style={{
                        padding: '8px 12px',
                        borderRadius: 8,
                        border: '1px solid var(--color-border)',
                        color: 'var(--color-danger)',
                        background: 'transparent',
                        fontWeight: 700,
                      }}
                    >
                      Reject
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {reviewState.error && <p style={{ margin: '12px 0 0', color: 'var(--color-danger)', fontSize: 13 }}>{reviewState.error}</p>}
        </Card>
      </div>
    </>
  )
}
