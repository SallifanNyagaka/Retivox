'use client'
/**
 * Owner UI for recurring monthly expense templates and pending reminders.
 */

import { startTransition, useEffect, useRef, useState, type FormEvent } from 'react'
import { useActionState } from 'react'
import { useRouter } from 'next/navigation'
import { formatCurrency } from '@smartretail/shared'
import { Card, CardHeader } from '../../../../components/ui/Card'
import LoadingOverlay from '../../../../components/ui/LoadingOverlay'
import Toast from '../../../../components/ui/Toast'
import { useToast } from '../../../../lib/hooks/useToast'
import {
  confirmRecurringFinanceExpense,
  skipRecurringFinanceExpense,
  upsertRecurringFinanceExpense,
  type FinanceFormState,
} from './actions'

type BranchOption = {
  id: string
  name: string
}

export type RecurringExpenseTemplate = {
  id: string
  branch_id: string | null
  category: string
  description: string
  default_amount: number | string
  due_day: number
  is_active: boolean
  branches: { name: string } | { name: string }[] | null
}

export type RecurringExpenseInstance = {
  id: string
  template_id: string
  branch_id: string | null
  category: string
  description: string
  amount: number | string
  due_on: string
  status: 'pending' | 'confirmed' | 'skipped'
  branches: { name: string } | { name: string }[] | null
}

type Props = {
  branches: BranchOption[]
  templates: RecurringExpenseTemplate[]
  pendingInstances: RecurringExpenseInstance[]
  currency: string
}

const emptyState: FinanceFormState = { success: false, error: null }

const inputStyle = {
  width: '100%',
  height: 42,
  border: '1px solid var(--color-border)',
  borderRadius: 8,
  padding: '0 12px',
  boxSizing: 'border-box' as const,
  fontSize: 13,
  color: 'var(--color-text-primary)',
  backgroundColor: 'var(--color-background)',
}

function joinedName(value: RecurringExpenseTemplate['branches']): string {
  if (!value) return 'All stores'
  return Array.isArray(value) ? value[0]?.name ?? 'All stores' : value.name
}

/**
 * RecurringExpensePanel keeps recurring bills lightweight: add/edit templates,
 * then confirm or skip generated monthly reminders.
 */
export default function RecurringExpensePanel({ branches, templates, pendingInstances, currency }: Props) {
  const router = useRouter()
  const { toast, toastState, dismiss } = useToast()
  const [templateState, templateAction, templatePending] = useActionState<FinanceFormState, FormData>(upsertRecurringFinanceExpense, emptyState)
  const [confirmState, confirmAction, confirmPending] = useActionState<FinanceFormState, FormData>(confirmRecurringFinanceExpense, emptyState)
  const [skipState, skipAction, skipPending] = useActionState<FinanceFormState, FormData>(skipRecurringFinanceExpense, emptyState)
  const previousTemplatePending = useRef(templatePending)
  const previousConfirmPending = useRef(confirmPending)
  const previousSkipPending = useRef(skipPending)
  const [templateId, setTemplateId] = useState('')
  const [branchId, setBranchId] = useState('')
  const [category, setCategory] = useState('Rent')
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const [dueDay, setDueDay] = useState('28')
  const [isActive, setIsActive] = useState(true)

  useEffect(() => {
    if (previousTemplatePending.current && !templatePending) {
      if (templateState.success) {
        toast.success(templateId ? 'Recurring expense updated' : 'Recurring expense saved')
        setTemplateId('')
        setBranchId('')
        setCategory('Rent')
        setDescription('')
        setAmount('')
        setDueDay('28')
        setIsActive(true)
        router.refresh()
      } else if (templateState.error) {
        toast.error(templateState.error)
      }
    }

    previousTemplatePending.current = templatePending
  }, [router, templateId, templatePending, templateState.error, templateState.success, toast])

  useEffect(() => {
    if (previousConfirmPending.current && !confirmPending) {
      if (confirmState.success) {
        toast.success('Expense confirmed')
        router.refresh()
      } else if (confirmState.error) {
        toast.error(confirmState.error)
      }
    }

    previousConfirmPending.current = confirmPending
  }, [confirmPending, confirmState.error, confirmState.success, router, toast])

  useEffect(() => {
    if (previousSkipPending.current && !skipPending) {
      if (skipState.success) {
        toast.success('Expense skipped for this month')
        router.refresh()
      } else if (skipState.error) {
        toast.error(skipState.error)
      }
    }

    previousSkipPending.current = skipPending
  }, [router, skipPending, skipState.error, skipState.success, toast])

  const editTemplate = (template: RecurringExpenseTemplate) => {
    setTemplateId(template.id)
    setBranchId(template.branch_id ?? '')
    setCategory(template.category)
    setDescription(template.description)
    setAmount(String(template.default_amount))
    setDueDay(String(template.due_day))
    setIsActive(template.is_active)
  }

  const submitTemplate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const formData = new FormData()
    formData.set('templateId', templateId)
    formData.set('branchId', branchId)
    formData.set('category', category)
    formData.set('description', description)
    formData.set('amount', amount)
    formData.set('dueDay', dueDay)
    formData.set('isActive', String(isActive))

    startTransition(() => templateAction(formData))
  }

  const isBusy = templatePending || confirmPending || skipPending

  return (
    <>
      {isBusy && <LoadingOverlay message="Updating recurring expenses..." />}
      {toastState && <Toast message={toastState.message} type={toastState.type} duration={toastState.duration} onDismiss={dismiss} />}

      <Card padding="md">
        <CardHeader title="Recurring monthly expenses" />
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_1.2fr]">
          <form onSubmit={submitTemplate} className="flex flex-col gap-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label style={{ fontSize: 13 }}>
                <span style={{ display: 'block', marginBottom: 6, fontWeight: 500 }}>Store</span>
                <select value={branchId} onChange={(event) => setBranchId(event.target.value)} style={inputStyle}>
                  <option value="">All stores</option>
                  {branches.map((branch) => (
                    <option key={branch.id} value={branch.id}>{branch.name}</option>
                  ))}
                </select>
              </label>
              <label style={{ fontSize: 13 }}>
                <span style={{ display: 'block', marginBottom: 6, fontWeight: 500 }}>Category</span>
                <input value={category} onChange={(event) => setCategory(event.target.value)} required style={inputStyle} />
              </label>
            </div>

            <label style={{ fontSize: 13 }}>
              <span style={{ display: 'block', marginBottom: 6, fontWeight: 500 }}>Description</span>
              <input value={description} onChange={(event) => setDescription(event.target.value)} required placeholder="e.g. Main store rent" style={inputStyle} />
            </label>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <label style={{ fontSize: 13 }}>
                <span style={{ display: 'block', marginBottom: 6, fontWeight: 500 }}>Amount</span>
                <input type="number" min={0.01} step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} required style={inputStyle} />
              </label>
              <label style={{ fontSize: 13 }}>
                <span style={{ display: 'block', marginBottom: 6, fontWeight: 500 }}>Due day</span>
                <input type="number" min={1} max={31} step={1} value={dueDay} onChange={(event) => setDueDay(event.target.value)} required style={inputStyle} />
              </label>
              <label className="flex items-center gap-2" style={{ fontSize: 13, paddingTop: 24 }}>
                <input type="checkbox" checked={isActive} onChange={(event) => setIsActive(event.target.checked)} />
                Active
              </label>
            </div>

            <div className="flex flex-wrap gap-2">
              <button type="submit" className="btn-primary" disabled={templatePending} style={{ padding: '9px 14px', borderRadius: 8 }}>
                {templateId ? 'Update recurring expense' : 'Save recurring expense'}
              </button>
              {templateId && (
                <button type="button" className="btn-outline" style={{ padding: '9px 14px', borderRadius: 8 }} onClick={() => setTemplateId('')}>
                  New
                </button>
              )}
            </div>
          </form>

          <div className="flex flex-col gap-3">
            <div>
              <p style={{ margin: 0, color: 'var(--color-text-primary)', fontWeight: 800 }}>Pending this month</p>
              <p style={{ margin: '3px 0 0', color: 'var(--color-text-muted)', fontSize: 12 }}>
                Confirm to include it in profit. Edit amount if the bill changed.
              </p>
            </div>

            {pendingInstances.length === 0 ? (
              <p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: 13 }}>No pending recurring expenses for this period.</p>
            ) : (
              pendingInstances.map((instance) => (
                <div key={instance.id} className="rounded-xl border p-3" style={{ borderColor: 'var(--color-border)' }}>
                  <p style={{ margin: 0, color: 'var(--color-text-primary)', fontWeight: 800 }}>
                    {instance.description}
                  </p>
                  <p style={{ margin: '3px 0 10px', color: 'var(--color-text-muted)', fontSize: 12 }}>
                    {instance.category} · {joinedName(instance.branches)} · due {new Date(instance.due_on).toLocaleDateString()}
                  </p>

                  <form action={confirmAction} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto_auto]">
                    <input type="hidden" name="instanceId" value={instance.id} />
                    <input name="amount" type="number" min={0.01} step="0.01" defaultValue={String(instance.amount)} style={inputStyle} />
                    <input name="incurredOn" type="date" defaultValue={instance.due_on} style={inputStyle} />
                    <button type="submit" className="btn-primary" style={{ padding: '8px 12px', borderRadius: 8 }}>
                      Confirm
                    </button>
                    <button
                      type="button"
                      className="btn-outline"
                      style={{ padding: '8px 12px', borderRadius: 8 }}
                      onClick={() => {
                        const formData = new FormData()
                        formData.set('instanceId', instance.id)
                        startTransition(() => skipAction(formData))
                      }}
                    >
                      Skip
                    </button>
                  </form>
                </div>
              ))
            )}
          </div>
        </div>

        {templates.length > 0 && (
          <div className="mt-5 flex flex-wrap gap-2">
            {templates.slice(0, 8).map((template) => (
              <button
                key={template.id}
                type="button"
                className="btn-outline"
                style={{ borderRadius: 999, padding: '6px 10px', fontSize: 12 }}
                onClick={() => editTemplate(template)}
              >
                {template.description} · {formatCurrency(Number(template.default_amount), currency)}
              </button>
            ))}
          </div>
        )}
      </Card>
    </>
  )
}
