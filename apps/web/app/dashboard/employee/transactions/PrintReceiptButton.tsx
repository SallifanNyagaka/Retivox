'use client'

import { useState } from 'react'

type ReceiptLine = {
  name: string
  quantity: number
  unit: string | null
  amount: number
}

export default function PrintReceiptButton({
  receiptNumber,
  store,
  currency,
  recordedAt,
  items,
  subtotal,
  discount,
  total,
}: {
  receiptNumber: string
  store: string
  currency: string
  recordedAt: string
  items: ReceiptLine[]
  subtotal: number
  discount: number
  total: number
}) {
  const [printing, setPrinting] = useState(false)
  const money = (value: number) => `${currency} ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  return (
    <>
      <button type="button" className="btn-outline" onClick={() => { setPrinting(true); window.setTimeout(() => { window.print(); setPrinting(false) }, 80) }} style={{ padding: '6px 10px', borderRadius: 7, fontSize: 12 }}>
        Print receipt
      </button>
      <article className={`receipt-print-sheet${printing ? ' print-target' : ''}`} aria-hidden="true">
        <header>
          <h1>RECEIPT</h1>
          <p>{store}</p>
          <p>{new Date(recordedAt).toLocaleString()}</p>
          <p>Receipt: {receiptNumber}</p>
        </header>
        <hr />
        <table>
          <thead><tr><th>Item</th><th>Qty</th><th>Amount</th></tr></thead>
          <tbody>{items.map((item, index) => (
            <tr key={`${item.name}-${index}`}>
              <td>{item.name}{item.unit ? <small>{item.unit}</small> : null}</td>
              <td>{item.quantity}</td>
              <td>{money(item.amount)}</td>
            </tr>
          ))}</tbody>
        </table>
        <hr />
        <div className="receipt-total"><span>Subtotal</span><span>{money(subtotal)}</span></div>
        {discount > 0 && <div className="receipt-total"><span>Discount</span><span>-{money(discount)}</span></div>}
        <div className="receipt-total receipt-grand-total"><span>Total paid</span><span>{money(total)}</span></div>
        <p className="receipt-thanks">Thank you for shopping with us.</p>
      </article>
      <style>{`
        .receipt-print-sheet { display: none; }
        @media print {
          body * { visibility: hidden !important; }
          .receipt-print-sheet { display: none !important; }
          .receipt-print-sheet.print-target, .receipt-print-sheet.print-target * { visibility: visible !important; }
          .receipt-print-sheet.print-target { display: block !important; position: fixed; inset: 0 auto auto 0; width: 76mm; padding: 5mm; background: white; color: #111; font: 12px/1.4 Arial, sans-serif; }
          .receipt-print-sheet header { text-align: center; }
          .receipt-print-sheet h1 { font-size: 18px; margin: 0 0 5px; }
          .receipt-print-sheet p { margin: 2px 0; }
          .receipt-print-sheet table { width: 100%; border-collapse: collapse; }
          .receipt-print-sheet th, .receipt-print-sheet td { padding: 4px 0; text-align: left; vertical-align: top; }
          .receipt-print-sheet th:last-child, .receipt-print-sheet td:last-child { text-align: right; }
          .receipt-print-sheet small { display: block; color: #555; }
          .receipt-total { display: flex; justify-content: space-between; margin: 4px 0; }
          .receipt-grand-total { border-top: 1px solid #111; padding-top: 6px; font-weight: 700; font-size: 14px; }
          .receipt-thanks { margin-top: 14px !important; text-align: center; }
        }
      `}</style>
    </>
  )
}
