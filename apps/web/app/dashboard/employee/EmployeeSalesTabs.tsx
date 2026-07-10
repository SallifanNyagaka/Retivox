'use client'
/**
 * Employee dashboard sale tabs.
 */

import { useState } from 'react'
import { Card, CardHeader } from '../../../components/ui/Card'
import RecordEmployeeTransactionForm, { type EmployeeProductOption } from './transactions/new/RecordEmployeeTransactionForm'

type Props = {
  normalProducts: EmployeeProductOption[]
  damagedProducts: EmployeeProductOption[]
  currency: string
}

export default function EmployeeSalesTabs({ normalProducts, damagedProducts, currency }: Props) {
  const [activeTab, setActiveTab] = useState<'normal' | 'damaged'>('normal')
  const showDamagedTab = damagedProducts.length > 0
  const selectedProducts = activeTab === 'damaged' ? damagedProducts : normalProducts

  return (
    <Card padding="md">
      <CardHeader title="Record sale" />

      <div className="mb-4 flex flex-wrap gap-2">
        <button
          type="button"
          className={activeTab === 'normal' ? 'btn-primary' : 'btn-outline'}
          style={{ padding: '8px 16px', borderRadius: 8 }}
          onClick={() => setActiveTab('normal')}
        >
          Normal stock
        </button>
        {showDamagedTab && (
          <button
            type="button"
            className={activeTab === 'damaged' ? 'btn-primary' : 'btn-outline'}
            style={{ padding: '8px 16px', borderRadius: 8 }}
            onClick={() => setActiveTab('damaged')}
          >
            Damaged stock
          </button>
        )}
      </div>

      {activeTab === 'damaged' && (
        <p style={{ margin: '0 0 14px', color: 'var(--color-text-muted)', fontSize: 13, lineHeight: 1.5 }}>
          These are owner-approved damaged items with recovery prices. The system will not allow selling more than the remaining damaged quantity.
        </p>
      )}

      {selectedProducts.length > 0 ? (
        <RecordEmployeeTransactionForm key={activeTab} products={selectedProducts} currency={currency} />
      ) : (
        <div style={{ padding: '28px 16px', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>
          No {activeTab === 'damaged' ? 'damaged' : 'normal'} stock is currently available to sell.
        </div>
      )}
    </Card>
  )
}
