/**
 * Owner transfers page.
 *
 * This page lets the owner create stock transfers, approve initiated transfers,
 * mark in-transit transfers as received, and review transfer history.
 */

import Link from 'next/link'
import { requireRole } from '../../../../lib/auth/helpers'
import type { UserProfile } from '../../../../lib/auth/helpers'
import { getAccessibleBranchIds } from '../../../../lib/auth/branchAccess'
import { GlobalRole } from '@smartretail/shared'
import { createClient } from '../../../../lib/supabase/server'
import { runSoftDeleteAwareQuery } from '../../../../lib/supabase/softDelete'
import { Card, CardHeader } from '../../../../components/ui/Card'
import { Badge } from '../../../../components/ui/Badge'
import { MetricCard } from '../../../../components/dashboard/MetricCard'
import { getBranchStock } from '../../../../lib/data/owner'
import logger from '../../../../lib/logger'
import TransferInitiateForm from './TransferInitiateForm'
import TransferRowActions from './TransferRowActions'
import type {
  BranchOption,
  RawTransferStockRow,
  StockProduct,
  TransferItemRow,
  TransferRow,
  TransferStatus,
  TransferStockRow,
  TransferUOMOption,
  TransferView,
  TransferViewItem,
} from './types'

type RawTransferUOMJoin = {
  id: string
  name: string
  abbreviation: string
  conversion_factor: string | number
  is_base_unit: boolean
}

type RawTransferUOMLinkRow = {
  product_id: string
  is_base_uom: boolean
  is_purchase_uom: boolean
  is_sale_uom: boolean
  is_default_sale_uom: boolean
  is_default_purchase_uom: boolean
  units_of_measure: RawTransferUOMJoin | RawTransferUOMJoin[] | null
}

/**
 * Supported filter statuses for the page tabs.
 */
type FilterStatus = 'all' | TransferStatus

/**
 * Validates the status filter coming from the URL.
 */
function isFilterStatus(value: string): value is FilterStatus {
  return value === 'all' || value === 'initiated' || value === 'in_transit' || value === 'received' || value === 'disputed'
}

/**
 * Returns the status badge variant.
 */
function getStatusVariant(status: TransferStatus): 'success' | 'warning' | 'danger' | 'info' | 'muted' {
  if (status === 'received') return 'success'
  if (status === 'in_transit') return 'info'
  if (status === 'disputed') return 'danger'
  return 'warning'
}

/**
 * Returns the display label for a transfer status.
 */
function getStatusLabel(status: TransferStatus): string {
  if (status === 'in_transit') return 'In Transit'
  if (status === 'received') return 'Received'
  if (status === 'disputed') return 'Disputed'
  return 'Initiated'
}

/**
 * Formats a date for the history table.
 */
function formatDateLabel(isoDate: string) {
  return new Date(isoDate).toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

/**
 * Formats a date and time for the detail panel.
 */
function formatDateTimeLabel(isoDate: string | null) {
  if (!isoDate) return '—'

  return new Date(isoDate).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Renders a transfer item label.
 */
function formatItemLabel(item: TransferViewItem) {
  return item.product_sku ? `${item.product_name} · ${item.product_sku}` : item.product_name
}

/**
 * Formats transfer quantities with the selected UOM and base-unit equivalent.
 */
function formatTransferQuantity(item: TransferViewItem, direction: 'sent' | 'received') {
  const baseQuantity = direction === 'sent'
    ? Number(item.base_quantity_sent ?? item.quantity_sent)
    : Number(item.base_quantity_received ?? item.quantity_received ?? 0)
  const displayQuantity = Number(item.quantity_in_uom ?? item.quantity_sent)
  const uomLabel = item.uom_name ?? 'base units'

  if (!item.uom_name || item.uom_conversion_factor === 1) {
    return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).format(baseQuantity)} ${uomLabel}`
  }

  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).format(displayQuantity)} ${uomLabel} (${new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).format(baseQuantity)} base units)`
}

/**
 * Converts Supabase one-to-one join results into arrays for shared UI code.
 */
function normalizeJoin<Row>(value: Row | Row[] | null | undefined): Row[] | null {
  if (!value) {
    return null
  }

  return Array.isArray(value) ? value : [value]
}

/**
 * Groups product/UOM links by product for transfer conversion displays.
 */
function groupUOMLinksByProduct(rows: RawTransferUOMLinkRow[]): Map<string, TransferUOMOption[]> {
  const grouped = new Map<string, TransferUOMOption[]>()

  rows.forEach((row) => {
    const uom = normalizeJoin(row.units_of_measure)?.[0]

    if (!uom) {
      return
    }

    const current = grouped.get(row.product_id) ?? []
    grouped.set(row.product_id, [
      ...current,
      {
        id: uom.id,
        name: uom.name,
        abbreviation: uom.abbreviation,
        conversion_factor: Number(uom.conversion_factor),
        is_base_unit: uom.is_base_unit,
        is_base_uom: row.is_base_uom,
        is_purchase_uom: row.is_purchase_uom,
        is_sale_uom: row.is_sale_uom,
        is_default_sale_uom: row.is_default_sale_uom,
        is_default_purchase_uom: row.is_default_purchase_uom,
      },
    ])
  })

  grouped.forEach((options, productId) => {
    grouped.set(
      productId,
      [...options].sort((first, second) =>
        Number(second.is_default_purchase_uom) - Number(first.is_default_purchase_uom) ||
        Number(second.is_base_uom) - Number(first.is_base_uom) ||
        first.conversion_factor - second.conversion_factor
      )
    )
  })

  return grouped
}

/**
 * Normalizes branch stock joins used by the initiate transfer modal.
 */
function normalizeTransferStockRows(rows: RawTransferStockRow[], uomsByProduct: Map<string, TransferUOMOption[]>): TransferStockRow[] {
  return rows.map((row) => ({
    ...row,
    base_quantity_on_hand: Number(row.base_quantity_on_hand ?? row.quantity_on_hand),
    base_quantity_reserved: Number(row.base_quantity_reserved ?? row.quantity_reserved ?? 0),
    products: normalizeJoin(row.products),
    branches: normalizeJoin(row.branches),
    uom_options: uomsByProduct.get(row.product_id) ?? [],
  }))
}

/**
 * Hydrates raw transfer rows into view models with names and items.
 */
function hydrateTransfers(
  transfers: TransferRow[],
  items: TransferItemRow[],
  branchMap: Record<string, string>,
  userMap: Record<string, string>,
  productMap: Record<string, { name: string; sku: string | null }>,
  uomMap: Record<string, TransferUOMOption>
): TransferView[] {
  return transfers.map((transfer) => {
    const transferItems = items
      .filter((item) => item.transfer_id === transfer.id)
      .map((item) => ({
        id: item.id,
        product_id: item.product_id,
        product_name: productMap[item.product_id]?.name ?? 'Unknown product',
        product_sku: productMap[item.product_id]?.sku ?? null,
        quantity_sent: item.quantity_sent,
        quantity_received: item.quantity_received,
        quantity_discrepancy: item.quantity_discrepancy,
        uom_id: item.uom_id,
        uom_name: item.uom_id ? uomMap[item.uom_id]?.name ?? null : null,
        uom_conversion_factor: item.uom_id ? uomMap[item.uom_id]?.conversion_factor ?? null : null,
        quantity_in_uom: item.quantity_in_uom,
        base_quantity_sent: item.base_quantity_sent,
        base_quantity_received: item.base_quantity_received,
      }))

    return {
      ...transfer,
      from_branch_name: branchMap[transfer.from_branch_id] ?? 'Unknown branch',
      to_branch_name: branchMap[transfer.to_branch_id] ?? 'Unknown branch',
      initiated_by_name: userMap[transfer.initiated_by] ?? 'Unknown user',
      received_by_name: transfer.received_by ? userMap[transfer.received_by] ?? null : null,
      items: transferItems,
    }
  })
}

/**
 * Shared transfers page content used by owner and admin route wrappers.
 */
export async function TransfersDashboardContent({
  searchParams,
  profile,
  basePath,
  subtitle,
}: {
  searchParams: Promise<{ status?: string; transfer?: string }>
  profile: UserProfile
  basePath: string
  subtitle: string
}) {
  const params = await searchParams
  const statusParam = params.status ?? 'all'
  const filterStatus: FilterStatus = isFilterStatus(statusParam) ? statusParam : 'all'
  const selectedTransferId = params.transfer ?? ''

  const businessId = profile.business_id

  if (!businessId) {
    throw new Error('Owner profile missing business ID')
  }

  const supabase = await createClient()
  let branches: BranchOption[] = []
  let branchStockRows: TransferStockRow[] = []
  let products: StockProduct[] = []
  let managedBranchIds: string[] = []
  let transferViews: TransferView[] = []
  let currency = ''
  let loadError = false

  try {
    const accessibleBranchIds = await getAccessibleBranchIds(profile.id, 'admin')
    managedBranchIds = accessibleBranchIds

    if (accessibleBranchIds.length === 0) {
      throw new Error('No branch access available for transfers')
    }

    const [transferResponse, branchResponse, productResponse, businessResponse, branchStockResponse] = await Promise.all([
      supabase
        .from('stock_transfers')
        .select('id, from_branch_id, to_branch_id, initiated_by, received_by, status, notes, initiated_at, received_at')
        .eq('business_id', businessId)
        .or(`from_branch_id.in.(${accessibleBranchIds.join(',')}),to_branch_id.in.(${accessibleBranchIds.join(',')})`)
        .order('initiated_at', { ascending: false })
        .range(0, 49),
      runSoftDeleteAwareQuery<BranchOption>(
        () =>
          supabase
            .from('branches')
            .select('id, name, branch_type, is_active')
            .eq('business_id', businessId)
            .eq('is_active', true)
            .is('deleted_at', null)
            .order('name'),
        () =>
          supabase
            .from('branches')
            .select('id, name, branch_type, is_active')
            .eq('business_id', businessId)
            .eq('is_active', true)
            .order('name'),
        { table: 'branches', businessId, page: 'owner_transfers' }
      ),
      runSoftDeleteAwareQuery<StockProduct>(
        () =>
          supabase
            .from('products')
            .select('id, name, sku')
            .eq('business_id', businessId)
            .eq('is_active', true)
            .is('deleted_at', null)
            .order('name'),
        () =>
          supabase
            .from('products')
            .select('id, name, sku')
            .eq('business_id', businessId)
            .eq('is_active', true)
            .order('name'),
        { table: 'products', businessId, page: 'owner_transfers' }
      ),
      supabase.from('businesses').select('currency').eq('id', businessId).single(),
      getBranchStock(businessId),
    ])

    const transferRows = (transferResponse.data ?? []) as TransferRow[]
    branches = (branchResponse.data ?? []) as BranchOption[]
    products = (productResponse.data ?? []) as StockProduct[]
    const rawBranchStockRows = (branchStockResponse ?? []) as RawTransferStockRow[]
    const productIds = Array.from(
      new Set([
        ...rawBranchStockRows.map((row) => row.product_id),
        ...products.map((product) => product.id),
      ].filter(Boolean))
    )
    let uomsByProduct = new Map<string, TransferUOMOption[]>()
    const uomMap: Record<string, TransferUOMOption> = {}

    if (productIds.length > 0) {
      const uomResponse = await supabase
        .from('product_uom_links')
        .select(
          `
          product_id,
          is_base_uom,
          is_purchase_uom,
          is_sale_uom,
          is_default_sale_uom,
          is_default_purchase_uom,
          units_of_measure!inner(id, name, abbreviation, conversion_factor, is_base_unit)
        `
        )
        .eq('business_id', businessId)
        .in('product_id', productIds)
        .order('is_default_purchase_uom', { ascending: false })

      if (uomResponse.error) throw uomResponse.error

      uomsByProduct = groupUOMLinksByProduct((uomResponse.data ?? []) as RawTransferUOMLinkRow[])
      uomsByProduct.forEach((options) => {
        options.forEach((uom) => {
          uomMap[uom.id] = uom
        })
      })
    }

    branchStockRows = normalizeTransferStockRows(rawBranchStockRows, uomsByProduct).filter((row) =>
      accessibleBranchIds.includes(row.branch_id)
    )

    const transferIds = transferRows.map((transfer) => transfer.id)
    const actorIds = Array.from(
      new Set(
        transferRows
          .flatMap((transfer) => [transfer.initiated_by, transfer.received_by])
          .filter((id): id is string => Boolean(id))
      )
    )

    const [itemResponse, userResponse] =
      transferIds.length > 0
        ? await Promise.all([
            supabase
              .from('stock_transfer_items')
              .select('id, transfer_id, product_id, quantity_sent, quantity_received, quantity_discrepancy, uom_id, quantity_in_uom, base_quantity_sent, base_quantity_received')
              .eq('business_id', businessId)
              .in('transfer_id', transferIds),
            actorIds.length > 0
              ? supabase.from('users').select('id, name').eq('business_id', businessId).in('id', actorIds)
              : Promise.resolve({ data: [], error: null }),
          ])
        : [
            { data: [], error: null },
            { data: [], error: null },
          ]

    if (transferResponse.error) throw transferResponse.error
    if (branchResponse.error) throw branchResponse.error
    if (productResponse.error) throw productResponse.error
    if (businessResponse.error) throw businessResponse.error
    if (itemResponse.error) throw itemResponse.error
    if (userResponse.error) throw userResponse.error

    const transferItems = (itemResponse.data ?? []) as TransferItemRow[]
    const users = (userResponse.data ?? []) as Array<{ id: string; name: string | null }>

    if (!businessResponse.data?.currency) {
      throw new Error('Business currency missing')
    }

    currency = businessResponse.data.currency

    const branchMap: Record<string, string> = {}
    branches.forEach((branch) => {
      branchMap[branch.id] = branch.name
    })

    const userMap: Record<string, string> = {}
    users.forEach((user) => {
      userMap[user.id] = user.name ?? 'Unknown user'
    })

    const productMap: Record<string, { name: string; sku: string | null }> = {}
    products.forEach((product) => {
      productMap[product.id] = { name: product.name, sku: product.sku ?? null }
    })

    transferViews = hydrateTransfers(transferRows, transferItems, branchMap, userMap, productMap, uomMap)
  } catch (error: unknown) {
    loadError = true
    logger.error('TransfersPage data fetch failed', { businessId, error })
  }

  if (loadError) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="font-bold" style={{ fontSize: '22px', color: 'var(--color-text-primary)' }}>
          Transfers
        </h1>
        <Card>
          <p style={{ fontSize: '14px', color: 'var(--color-danger)' }}>
            Failed to load transfers. Please refresh the page.
          </p>
        </Card>
      </div>
    )
  }

  const totalCount = transferViews.length
  const inTransitCount = transferViews.filter((transfer) => transfer.status === 'in_transit').length
  const receivedCount = transferViews.filter((transfer) => transfer.status === 'received').length
  const disputedCount = transferViews.filter((transfer) => transfer.status === 'disputed').length

  const filteredTransfers =
    filterStatus === 'all'
      ? transferViews
      : transferViews.filter((transfer) => transfer.status === filterStatus)

  const selectedTransfer = transferViews.find((transfer) => transfer.id === selectedTransferId) ?? null

  return (
    <div className="flex flex-col gap-6" aria-label={`Owner transfers dashboard in ${currency}`} data-currency={currency}>
      {/* Page header with CTA */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1
            className="font-bold"
            style={{
              fontSize: '22px',
              color: 'var(--color-text-primary)',
              letterSpacing: '-0.3px',
            }}
          >
            Transfers
          </h1>
          <p style={{ fontSize: '14px', color: 'var(--color-text-muted)', marginTop: '4px' }}>
            {subtitle}
          </p>
        </div>

        <TransferInitiateForm
          branches={branches}
          stockRows={branchStockRows}
          products={products}
          managedBranchIds={managedBranchIds}
        />
      </div>

      {/* Summary metrics */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <MetricCard label="Total transfers" value={String(totalCount)} deltaType="neutral" />
        <MetricCard label="In transit" value={String(inTransitCount)} deltaType="neutral" />
        <MetricCard label="Completed" value={String(receivedCount)} deltaType="neutral" />
        <MetricCard
          label="Disputed"
          value={String(disputedCount)}
          deltaType={disputedCount > 0 ? 'down' : 'neutral'}
          valueColor={disputedCount > 0 ? 'var(--color-danger)' : 'var(--color-text-primary)'}
        />
      </div>

      {/* Status filters */}
      <div className="flex flex-wrap gap-2">
        {([
          ['all', 'All'],
          ['initiated', 'Initiated'],
          ['in_transit', 'In Transit'],
          ['received', 'Received'],
          ['disputed', 'Disputed'],
        ] as Array<[FilterStatus, string]>).map(([status, label]) => {
          const active = filterStatus === status
          const href = status === 'all' ? basePath : `${basePath}?status=${status}`

          return (
            <Link
              key={status}
              href={href}
              className={active ? 'btn-primary' : 'btn-outline'}
              style={{
                padding: '8px 16px',
                fontSize: '13px',
                borderRadius: '8px',
              }}
            >
              {label}
            </Link>
          )
        })}
      </div>

      {/* Transfer history table */}
      <Card padding="md">
        <CardHeader title="Transfer history" />

        {filteredTransfers.length === 0 ? (
          <div
            className="flex flex-col items-center justify-center text-center"
            style={{
              padding: '48px 20px',
              gap: '16px',
            }}
          >
            <div
              className="rounded-2xl"
              style={{
                width: '84px',
                height: '84px',
                display: 'grid',
                placeItems: 'center',
                backgroundColor: 'var(--color-primary-light)',
                color: 'var(--color-primary)',
              }}
            >
              <svg width="36" height="36" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path d="M4 7h16v10H4z" />
                <path d="M4 11h16" />
                <path d="M8 7v10" />
              </svg>
            </div>
            <div>
              <h2 style={{ fontSize: '20px', fontWeight: 600, color: 'var(--color-text-primary)', margin: 0 }}>
                No transfers yet
              </h2>
              <p style={{ fontSize: '14px', color: 'var(--color-text-muted)', marginTop: '8px' }}>
                Start a transfer to move stock between branches.
              </p>
            </div>
            <TransferInitiateForm
              branches={branches}
              stockRows={branchStockRows}
              products={products}
              managedBranchIds={managedBranchIds}
            />
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderSpacing: 0 }}>
              <thead>
                <tr style={{ textAlign: 'left' }}>
                  <th style={{ padding: '12px', fontSize: '12px', color: 'var(--color-text-muted)' }}>From</th>
                  <th style={{ padding: '12px', fontSize: '12px', color: 'var(--color-text-muted)' }}>To</th>
                  <th style={{ padding: '12px', fontSize: '12px', color: 'var(--color-text-muted)' }}>Items</th>
                  <th style={{ padding: '12px', fontSize: '12px', color: 'var(--color-text-muted)' }}>Initiated by</th>
                  <th style={{ padding: '12px', fontSize: '12px', color: 'var(--color-text-muted)' }}>Date</th>
                  <th style={{ padding: '12px', fontSize: '12px', color: 'var(--color-text-muted)' }}>Status</th>
                  <th style={{ padding: '12px', fontSize: '12px', color: 'var(--color-text-muted)' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredTransfers.map((transfer, index) => {
                  const isSelected = selectedTransfer?.id === transfer.id
                  const canApproveTransfer = profile.global_role === GlobalRole.Owner && transfer.status === 'initiated'
                  const canReceiveTransfer = transfer.status === 'in_transit' && managedBranchIds.includes(transfer.to_branch_id)
                  const detailsHref =
                    filterStatus === 'all'
                      ? `${basePath}?transfer=${transfer.id}`
                      : `${basePath}?status=${filterStatus}&transfer=${transfer.id}`

                  return (
                    <tr
                      key={transfer.id}
                      style={{
                        backgroundColor: index % 2 === 0 ? 'var(--color-background)' : 'var(--color-surface)',
                      }}
                    >
                      <td style={{ padding: '12px', fontSize: '13px', color: 'var(--color-text-primary)' }}>
                        {transfer.from_branch_name}
                      </td>
                      <td style={{ padding: '12px', fontSize: '13px', color: 'var(--color-text-primary)' }}>
                        {transfer.to_branch_name}
                      </td>
                      <td style={{ padding: '12px', fontSize: '13px', color: 'var(--color-text-primary)' }}>
                        {transfer.items.length}
                      </td>
                      <td style={{ padding: '12px', fontSize: '13px', color: 'var(--color-text-primary)' }}>
                        {transfer.initiated_by_name}
                      </td>
                      <td style={{ padding: '12px', fontSize: '13px', color: 'var(--color-text-primary)' }}>
                        {formatDateLabel(transfer.initiated_at)}
                      </td>
                      <td style={{ padding: '12px' }}>
                        <Badge variant={getStatusVariant(transfer.status)}>{getStatusLabel(transfer.status)}</Badge>
                      </td>
                      <td style={{ padding: '12px' }}>
                        <div className="flex flex-wrap items-center gap-2">
                          {(canApproveTransfer || canReceiveTransfer) && (
                            <TransferRowActions transferId={transfer.id} status={transfer.status} />
                          )}
                          {!canApproveTransfer && !canReceiveTransfer && (transfer.status === 'received' || transfer.status === 'disputed') && (
                            <span style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>—</span>
                          )}
                          <Link
                            href={detailsHref}
                            className={isSelected ? 'btn-primary' : 'btn-outline'}
                            style={{ padding: '5px 14px', borderRadius: '8px', fontSize: '12px' }}
                          >
                            View details
                          </Link>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Transfer detail panel */}
      {selectedTransfer && (
        <Card padding="md">
          <CardHeader title="Transfer details" />

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-1">
              <p style={{ fontSize: '13px', color: 'var(--color-text-muted)', marginBottom: '6px' }}>Route</p>
              <p style={{ fontSize: '15px', fontWeight: 600, color: 'var(--color-text-primary)', margin: 0 }}>
                {selectedTransfer.from_branch_name} → {selectedTransfer.to_branch_name}
              </p>
              <p style={{ fontSize: '13px', color: 'var(--color-text-muted)', marginTop: '8px' }}>
                Initiated by {selectedTransfer.initiated_by_name}
              </p>
              <p style={{ fontSize: '13px', color: 'var(--color-text-muted)', marginTop: '4px' }}>
                Initiated {formatDateTimeLabel(selectedTransfer.initiated_at)}
              </p>
              <p style={{ fontSize: '13px', color: 'var(--color-text-muted)', marginTop: '4px' }}>
                Received {formatDateTimeLabel(selectedTransfer.received_at)}
              </p>
              {selectedTransfer.received_by_name && (
                <p style={{ fontSize: '13px', color: 'var(--color-text-muted)', marginTop: '4px' }}>
                  Received by {selectedTransfer.received_by_name}
                </p>
              )}
              <div style={{ marginTop: '12px' }}>
                <Badge variant={getStatusVariant(selectedTransfer.status)}>
                  {getStatusLabel(selectedTransfer.status)}
                </Badge>
              </div>
            </div>

            <div className="lg:col-span-2">
              <p style={{ fontSize: '13px', color: 'var(--color-text-muted)', marginBottom: '8px' }}>Items</p>
              <div className="flex flex-col gap-2">
                {selectedTransfer.items.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between gap-3 rounded-lg"
                    style={{
                      padding: '12px 14px',
                      backgroundColor: 'var(--color-background)',
                      border: '1px solid var(--color-border)',
                    }}
                  >
                    <div>
                      <p style={{ fontSize: '13px', fontWeight: 500, color: 'var(--color-text-primary)', margin: 0 }}>
                        {formatItemLabel(item)}
                      </p>
                      <p style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginTop: '4px' }}>
                        Sent {formatTransferQuantity(item, 'sent')}
                        {item.quantity_received !== null ? ` · Received ${formatTransferQuantity(item, 'received')}` : ''}
                        {item.quantity_discrepancy !== null ? ` · Discrepancy ${item.quantity_discrepancy}` : ''}
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              {selectedTransfer.notes && (
                <div style={{ marginTop: '16px' }}>
                  <p style={{ fontSize: '13px', color: 'var(--color-text-muted)', marginBottom: '8px' }}>Notes</p>
                  <p
                    style={{
                      fontSize: '13px',
                      color: 'var(--color-text-primary)',
                      padding: '12px 14px',
                      border: '1px solid var(--color-border)',
                      borderRadius: '8px',
                      backgroundColor: 'var(--color-background)',
                      margin: 0,
                    }}
                  >
                    {selectedTransfer.notes}
                  </p>
                </div>
              )}
            </div>
          </div>
        </Card>
      )}
    </div>
  )
}

/**
 * Owner transfers page component.
 */
export default async function TransfersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; transfer?: string }>
}) {
  const profile = await requireRole([GlobalRole.Owner])

  return (
    <TransfersDashboardContent
      searchParams={searchParams}
      profile={profile}
      basePath="/dashboard/owner/transfers"
      subtitle="Move stock between branches and track every transfer from initiation to receipt."
    />
  )
}
