'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import BusinessPaymentProgressDialog from './BusinessPaymentProgressDialog'

export default function PaymentProgressButton({ paymentId, currency }: {
  paymentId: string
  currency: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className="btn-outline" onClick={() => setOpen(true)} style={{ borderRadius: 7, padding: '5px 10px', fontSize: 12 }}>
        Check payment
      </button>
      <BusinessPaymentProgressDialog
        open={open}
        paymentId={paymentId}
        currency={currency}
        onClose={() => setOpen(false)}
        onViewTransactions={() => {
          setOpen(false)
          router.refresh()
        }}
      />
    </>
  )
}
