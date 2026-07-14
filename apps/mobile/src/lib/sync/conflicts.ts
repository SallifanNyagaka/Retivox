/**
 * Conflict resolution helpers for Retivox mobile offline sync.
 *
 * Encodes the business rules for stock shortages, price drift, duplicate local
 * IDs, and expired sessions during queued transaction processing.
 */

export type StockConflict = {
  type: 'stock_negative'
  availableQuantity: number
  requestedQuantity: number
  message: string
}

export type PriceConflict = {
  type: 'price_changed'
  queuedPrice: number
  serverPrice: number
  message: string
}

export type DuplicateConflict = {
  type: 'duplicate_local_id'
  serverId: string
  message: string
}

export type SessionConflict = {
  type: 'session_expired'
  message: string
}

export type SyncConflict = StockConflict | PriceConflict | DuplicateConflict | SessionConflict

/**
 * Creates a stock conflict payload.
 *
 * @param availableQuantity - Server-side available quantity.
 * @param requestedQuantity - Locally queued quantity.
 * @returns Stock conflict payload.
 */
export function createStockConflict(availableQuantity: number, requestedQuantity: number): StockConflict {
  return {
    type: 'stock_negative',
    availableQuantity,
    requestedQuantity,
    message: `Only ${availableQuantity} units are available for a queued sale of ${requestedQuantity}.`,
  }
}

/**
 * Creates a price conflict payload.
 *
 * @param queuedPrice - Price recorded at sale time.
 * @param serverPrice - Current server price.
 * @returns Price conflict payload.
 */
export function createPriceConflict(queuedPrice: number, serverPrice: number): PriceConflict {
  return {
    type: 'price_changed',
    queuedPrice,
    serverPrice,
    message: `Price changed from ${queuedPrice} to ${serverPrice}; queued price will be honored and flagged.`,
  }
}

/**
 * Creates a duplicate local ID conflict payload.
 *
 * @param serverId - Existing server record id.
 * @returns Duplicate conflict payload.
 */
export function createDuplicateConflict(serverId: string): DuplicateConflict {
  return {
    type: 'duplicate_local_id',
    serverId,
    message: 'This local transaction was already synced.',
  }
}

/**
 * Creates an expired session conflict payload.
 *
 * @returns Session conflict payload.
 */
export function createSessionConflict(): SessionConflict {
  return {
    type: 'session_expired',
    message: 'Your session expired while offline. Log in again to resume sync.',
  }
}
