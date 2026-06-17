/**
 * SmartRetail Shared Utility Functions
 *
 * This file contains framework-agnostic utility functions used across the SmartRetail
 * multi-tenant retail SaaS system. These functions are shared between the web app and
 * mobile app via the @smartretail/shared package.
 *
 * Framework Independence:
 * - No React imports or hooks
 * - No React Native imports
 * - No Node.js-specific modules (e.g., crypto)
 * - Pure TypeScript logic only
 *
 * Platform-Specific Behavior:
 * Some functions include base implementations that are intentionally stubbed or generic.
 * Platform-specific overrides (network detection, storage, etc.) are handled at the
 * app level (web app and mobile app) and should wrap or extend these utilities as needed.
 *
 * Examples:
 * - isOnline() returns a base implementation; apps override with their own detection
 * - formatCurrency() uses toLocaleString; apps may override for specific tenant needs
 */

/**
 * Generates a UUID v4 string using a Math.random() based implementation.
 *
 * @returns {string} A UUID v4 string in the format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
 *
 * @description
 * We avoid the crypto module here because:
 * 1. React Native does not have built-in crypto support
 * 2. Some browsers restrict crypto in insecure contexts (non-HTTPS)
 * 3. This implementation is sufficient for local ID generation and works everywhere
 *
 * The format follows RFC 4122 v4 spec with all the required bits in the right places.
 */
export function generateLocalId(): string {
  // Generate 4 random hex digits at a time, for efficiency
  const generateSegment = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');

  // RFC 4122 v4: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
  // Where x is any hex digit and y is one of 8, 9, A, or B
  const time_low = generateSegment() + generateSegment();
  const time_mid = generateSegment();
  const time_hi_and_version = '4' + generateSegment().slice(1); // Set version to 4
  const clock_seq = ((Math.random() * 0x4) | 0x8).toString(16) + generateSegment().slice(1); // Set variant to RFC 4122
  const node = generateSegment() + generateSegment() + generateSegment();

  return `${time_low}-${time_mid}-${time_hi_and_version}-${clock_seq}-${node}`;
}

/**
 * Generates a short, uppercase account reference code for M-Pesa payment processing.
 *
 * @param {string} businessId - The unique identifier of the business
 * @param {string} branchId - The unique identifier of the branch
 * @returns {string} A short reference code in format: "XXXX-YYYY"
 *
 * @example
 * generateAccountReference("kama-coffee-001", "nbi-branch-1")
 * // Returns: "KAMA-NBI1"
 *
 * @description
 * This reference code is what the customer enters directly into M-Pesa when paying
 * via paybill. The format must be concise and easy to communicate verbally.
 * We take the first 4 characters of each ID (uppercase) and join with a dash.
 */
export function generateAccountReference(businessId: string, branchId: string): string {
  // Extract first 4 characters and convert to uppercase
  const businessPart = businessId.slice(0, 4).toUpperCase();
  const branchPart = branchId.slice(0, 4).toUpperCase();

  return `${businessPart}-${branchPart}`;
}

/**
 * Calculates the total cost for a single line item.
 *
 * @param {number} quantity - The number of units sold
 * @param {number} unitPrice - The price per unit
 * @returns {number} The line total, rounded to 2 decimal places
 *
 * @example
 * calculateLineTotal(3, 150.50)
 * // Returns: 451.50
 *
 * @description
 * CRITICAL: The rounding here must match exactly what the server calculates.
 * Any discrepancy in rounding logic will cause reconciliation failures and
 * customer complaints. Always use 2 decimal places (standard for currency).
 * This calculation should never use currency-specific rounding rules.
 */
export function calculateLineTotal(quantity: number, unitPrice: number): number {
  const total = quantity * unitPrice;
  // Round to 2 decimal places: multiply, round integer, divide back
  return Math.round(total * 100) / 100;
}

/**
 * Calculates the total transaction value across all items with optional discount.
 *
 * @param {Array<{ quantity: number; unitPrice: number }>} items - Array of line items
 * @param {number} [discountAmount=0] - Optional discount amount to subtract
 * @returns {number} The total transaction value, never less than 0
 *
 * @example
 * calculateTransactionTotal(
 *   [
 *     { quantity: 2, unitPrice: 500 },
 *     { quantity: 1, unitPrice: 1500 }
 *   ],
 *   300
 * )
 * // Returns: 2200
 *
 * @description
 * The minimum 0 rule is important because:
 * 1. The system allows large discounts, sometimes discounts exceed the subtotal
 * 2. In such cases, we return 0 rather than allowing negative totals
 * 3. Negative transactions are nonsensical and break payment flow
 * 4. Any excess discount is handled as a credit on the customer's account, not as a negative charge
 */
export function calculateTransactionTotal(
  items: Array<{ quantity: number; unitPrice: number }>,
  discountAmount: number = 0
): number {
  // Sum all line totals using the line calculation function
  const subtotal = items.reduce((sum, item) => {
    return sum + calculateLineTotal(item.quantity, item.unitPrice);
  }, 0);

  // Apply discount and ensure we never go below zero
  const total = subtotal - discountAmount;
  return Math.max(0, total);
}

/**
 * Validates whether a price falls within an acceptable range.
 *
 * @param {number} price - The price to validate
 * @param {number} minPrice - The minimum acceptable price (inclusive)
 * @param {number} maxPrice - The maximum acceptable price (inclusive)
 * @returns {boolean} True if price >= minPrice AND price <= maxPrice
 *
 * @example
 * isPriceWithinBounds(500, 100, 1000)
 * // Returns: true
 *
 * isPriceWithinBounds(50, 100, 1000)
 * // Returns: false
 *
 * @description
 * This mirrors the server-side validation in the pricing approval flow.
 * Both must use identical logic to ensure a price approved on mobile is
 * not rejected on the server, and vice versa.
 */
export function isPriceWithinBounds(price: number, minPrice: number, maxPrice: number): boolean {
  return price >= minPrice && price <= maxPrice;
}

/**
 * Calculates the stock level after a sale and flags issues.
 *
 * @param {number} currentStock - The stock quantity before the sale
 * @param {number} quantitySold - The quantity being sold
 * @returns {Object} Object containing:
 *   - newStock: The stock level after the sale
 *   - isNegative: True if stock goes below zero
 *   - requiresReview: True if the transaction needs admin attention
 *
 * @example
 * calculateStockAfterSale(10, 15)
 * // Returns: { newStock: -5, isNegative: true, requiresReview: true }
 *
 * @description
 * Why stock can go negative:
 * - The mobile app may not have the latest stock levels (operates offline)
 * - A sale might be recorded locally, then synced after inventory was depleted elsewhere
 * - This is NOT a crash; it's a valid state that must be handled gracefully
 *
 * The requiresReview flag tells the sync engine to:
 * 1. Queue the transaction for admin attention
 * 2. Allow the sale to complete locally (optimistic UI)
 * 3. Let the server decide whether to accept or reject the transaction
 * 4. Notify the admin for manual intervention if needed
 */
export function calculateStockAfterSale(
  currentStock: number,
  quantitySold: number
): {
  newStock: number;
  isNegative: boolean;
  requiresReview: boolean;
} {
  const newStock = currentStock - quantitySold;
  const isNegative = newStock < 0;

  return {
    newStock,
    isNegative,
    // Flag for review if stock went negative
    requiresReview: isNegative,
  };
}

/**
 * Formats a numeric amount as a human-readable currency string.
 *
 * @param {number} amount - The numeric amount to format
 * @param {string} currency - The ISO 4217 currency code (e.g., "KES", "USD", "GBP")
 * @returns {string} Formatted currency string
 *
 * @example
 * formatCurrency(1240, "KES")
 * // Returns: "KES 1,240.00"
 *
 * formatCurrency(99.5, "USD")
 * // Returns: "USD 99.50"
 *
 * @description
 * The currency code comes from the Business record and varies per tenant.
 * Using toLocaleString ensures:
 * 1. Proper thousands separators for the locale
 * 2. Consistent 2-decimal formatting
 * 3. Readable numbers in the dashboard and mobile UI
 *
 * Note: The format is "CODE amount" for consistency across all regions,
 * not locale-specific (which might put $ before or after).
 */
export function formatCurrency(amount: number, currency: string): string {
  // Format the number with 2 decimal places and thousand separators
  const formattedAmount = amount.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  return `${currency} ${formattedAmount}`;
}

/**
 * Returns the online status of the app.
 *
 * @returns {boolean} True if the app is online, false otherwise
 *
 * @description
 * This is a base implementation that always returns true.
 * Platform-specific implementations:
 *
 * WEB APP: Should override this by wrapping with navigator.onLine
 *   - Monitors the 'online' and 'offline' events
 *   - Updates based on network connectivity
 *
 * MOBILE APP: Should override this by wrapping with Expo NetInfo
 *   - Monitors network status changes
 *   - Returns connection type (WiFi, cellular, none, etc.)
 *   - Can detect captive portals
 *
 * This base stub ensures the app doesn't crash if the override is missing.
 * Always check isOnline() at the app level before performing sync operations.
 */
export function isOnline(): boolean {
  // Base implementation: assume online
  // This is overridden at the app level with actual network detection
  return true;
}

/**
 * Returns a human-readable label for a transaction status value.
 *
 * @param {string} status - The transaction status value (e.g., "pending_sync", "verified")
 * @returns {string} A human-readable label for display in the UI
 *
 * @example
 * transactionStatusLabel("pending_sync")
 * // Returns: "Pending Sync"
 *
 * transactionStatusLabel("verified")
 * // Returns: "Verified"
 *
 * transactionStatusLabel("unknown_status")
 * // Returns: "Unknown"
 *
 * @description
 * These labels are displayed in:
 * - Dashboard transaction history
 * - Mobile app transaction list
 * - Receipt/invoice details
 * - Admin reports
 *
 * If a status value doesn't match any known status, return "Unknown"
 * rather than showing the raw status code to the user.
 */
export function transactionStatusLabel(status: string): string {
  const statusMap: Record<string, string> = {
    pending_sync: 'Pending Sync',
    synced: 'Synced',
    pending_verify: 'Awaiting Verification',
    verified: 'Verified',
    rejected: 'Rejected',
    flagged: 'Flagged for Review',
    voided: 'Voided',
  };

  return statusMap[status] || 'Unknown';
}

/**
 * Calculates the absolute number of days between two ISO date strings.
 *
 * @param {string} dateA - An ISO 8601 date string (e.g., "2024-05-11")
 * @param {string} dateB - An ISO 8601 date string (e.g., "2024-05-18")
 * @returns {number} The absolute number of days between the dates, rounded down
 *
 * @example
 * daysBetween("2024-05-11", "2024-05-18")
 * // Returns: 7
 *
 * daysBetween("2024-05-18", "2024-05-11")
 * // Returns: 7 (order doesn't matter)
 *
 * @description
 * This function is used for:
 * - Subscription trial calculations (days remaining until expiry)
 * - Report date range calculations
 * - Tenure calculations for customer loyalty
 *
 * We use absolute value and Math.floor to ensure:
 * 1. The result is always positive (order-independent)
 * 2. Partial days are rounded down (consistent with business logic)
 */
export function daysBetween(dateA: string, dateB: string): number {
  // Parse the ISO date strings to Date objects
  const date1 = new Date(dateA);
  const date2 = new Date(dateB);

  // Calculate the time difference in milliseconds
  const timeDifference = Math.abs(date1.getTime() - date2.getTime());

  // Convert milliseconds to days (1 day = 24 * 60 * 60 * 1000 milliseconds)
  const daysDifference = timeDifference / (24 * 60 * 60 * 1000);

  // Round down to the nearest whole day
  return Math.floor(daysDifference);
}

/**
 * Truncates a text string to a maximum length, appending "..." if truncated.
 *
 * @param {string} text - The text to truncate
 * @param {number} maxLength - The maximum length before truncation
 * @returns {string} The original text, or truncated text with "..." appended
 *
 * @example
 * truncateText("Hello world, this is a test", 10)
 * // Returns: "Hello worl..."
 *
 * truncateText("Short", 10)
 * // Returns: "Short"
 *
 * @description
 * Used in the UI for:
 * - Notification message previews
 * - Table cell display (product names, descriptions)
 * - Toast message summaries
 *
 * The "..." suffix clearly indicates to the user that the text was truncated,
 * encouraging them to view the full content if needed.
 */
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }

  // Truncate to maxLength and append ellipsis
  return text.slice(0, maxLength) + '...';
}

/**
 * Validates whether a string matches the UUID v4 format.
 *
 * @param {string} value - The string to validate
 * @returns {boolean} True if the string is a valid UUID v4, false otherwise
 *
 * @example
 * isValidUUID("550e8400-e29b-41d4-a716-446655440000")
 * // Returns: true
 *
 * isValidUUID("invalid-uuid")
 * // Returns: false
 *
 * @description
 * This is used to validate localIds before:
 * 1. Adding them to the sync queue
 * 2. Sending them to the server
 * 3. Storing them in the database
 *
 * The regex pattern ensures:
 * - 8 hex digits, dash, 4 hex digits, dash, 4 hex digits, dash, 4 hex digits, dash, 12 hex digits
 * - Standard UUID v4 format per RFC 4122
 * - Rejects malformed IDs early, preventing downstream errors
 */
export function isValidUUID(value: string): boolean {
  // UUID v4 regex pattern: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
  // Where y is one of [8, 9, A, B] (case-insensitive)
  const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  return uuidV4Regex.test(value);
}
