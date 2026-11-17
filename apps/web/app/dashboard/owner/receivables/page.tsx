import Link from 'next/link'
import { GlobalRole, formatCurrency } from '@smartretail/shared'
import { requireRole } from '../../../../lib/auth/helpers'
import { createClient } from '../../../../lib/supabase/server'
import { Card, CardHeader } from '../../../../components/ui/Card'
import ReceivablePaymentForm from './ReceivablePaymentForm'

type ReceivableRow = {
  id: string; business_id: string; branch_id: string; transaction_id: string; due_date: string
  customer_name: string; customer_phone: string | null; customer_email: string | null
  branch_name: string; total_amount: number; amount_paid: number; balance_due: number; account_status: string
}

export default async function OwnerReceivablesPage() {
  const profile = await requireRole([GlobalRole.Owner])
  const businessId = profile.business_id
  if (!businessId) throw new Error('Owner profile missing business ID')
  const supabase = await createClient()
  const [{ data: business }, accountsResponse] = await Promise.all([
    supabase.from('businesses').select('currency').eq('id', businessId).single(),
    supabase.from('receivable_account_balances').select('*').eq('business_id', businessId).order('due_date'),
  ])
  const currency = business?.currency ?? 'KES'
  const accounts = (accountsResponse.data ?? []) as ReceivableRow[]
  const totalOutstanding = accounts.reduce((sum, account) => sum + Number(account.balance_due), 0)
  const accountCards = await Promise.all(accounts.map(async (account) => {
    const [saleItems, payments] = await Promise.all([
      supabase.from('transaction_items').select('quantity_in_uom,quantity,unit_price_at_sale,line_total,products(name,sku),units_of_measure(name)').eq('transaction_id', account.transaction_id),
      supabase.from('payments').select('payment_method,amount,status,payment_at,reference_code,mpesa_ref_code').eq('transaction_id', account.transaction_id).order('payment_at'),
    ])
    return <Card key={account.id} padding="md">
      <CardHeader title={`${account.customer_name} · ${account.branch_name}`} />
      <div className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <p>Phone: {account.customer_phone ?? '—'}</p><p>Email: {account.customer_email ?? '—'}</p>
        <p>Due: {account.due_date}</p><p>Status: <strong>{account.account_status}</strong></p>
        <p>Sale total: {formatCurrency(Number(account.total_amount), currency)}</p>
        <p>Payments: {formatCurrency(Number(account.amount_paid), currency)}</p>
        <p className="font-bold">Balance: {formatCurrency(Number(account.balance_due), currency)}</p>
        <span>Sale ID: <code>{account.transaction_id.slice(0, 8)}</code></span>
      </div>
      <details className="mt-3">
        <summary className="cursor-pointer font-semibold">Purchase and payment details</summary>
        <div className="mt-2 grid gap-4 lg:grid-cols-2">
          <div><h3 className="font-semibold">Purchased items</h3>{(saleItems.data ?? []).map((item, index) => {
            const product = Array.isArray(item.products) ? item.products[0] : item.products
            const uom = Array.isArray(item.units_of_measure) ? item.units_of_measure[0] : item.units_of_measure
            return <p key={index} className="text-sm">{product?.name ?? 'Product'} · {item.quantity_in_uom ?? item.quantity} {uom?.name ?? 'units'} · {formatCurrency(Number(item.line_total), currency)}</p>
          })}</div>
          <div><h3 className="font-semibold">Payment history</h3>{(payments.data ?? []).map((payment, index) => <p key={index} className="text-sm">{new Date(payment.payment_at).toLocaleString()} · {payment.payment_method.replace('_', ' ')} · {formatCurrency(Number(payment.amount), currency)} · {payment.status}{(payment.reference_code || payment.mpesa_ref_code) ? ` · ${payment.reference_code || payment.mpesa_ref_code}` : ''}</p>)}</div>
        </div>
      </details>
      {Number(account.balance_due) > 0 && <div className="mt-4 border-t pt-4"><ReceivablePaymentForm receivableId={account.id} balance={Number(account.balance_due)} /></div>}
    </Card>
  }))

  return <div className="flex flex-col gap-5">
    <div><Link href="/dashboard/owner/finances" className="text-sm underline">← Finances</Link>
      <h1 className="mt-2 text-2xl font-bold">Credit balances</h1>
      <p className="text-sm text-gray-500">Outstanding customer balances: {formatCurrency(totalOutstanding, currency)}. Payments recorded here immediately reduce the balance. Fully paid purchase histories remain listed below.</p>
    </div>
    {accounts.length === 0 ? <Card padding="md"><p className="m-0">There are no outstanding credit balances.</p></Card> : accountCards}
  </div>
}
