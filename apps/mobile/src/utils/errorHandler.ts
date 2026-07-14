/**
 * Standardized mobile error handling utilities for Retivox.
 *
 * These helpers normalize unknown thrown values into user-safe messages and
 * provide a single logging point for async operations across the app.
 */

export type HandledError = {
  message: string
  originalError: unknown
}

/**
 * Converts an unknown error into a readable message.
 *
 * @param error - Unknown thrown value.
 * @returns User-safe error message.
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message
  }

  if (typeof error === 'string' && error.trim().length > 0) {
    return error
  }

  return 'Something went wrong. Please try again.'
}

/**
 * Logs and normalizes an error.
 *
 * @param scope - Where the error happened.
 * @param error - Unknown thrown value.
 * @returns Normalized error payload.
 */
export function handleError(scope: string, error: unknown): HandledError {
  const message = getErrorMessage(error)
  console.error(`[Retivox mobile] ${scope}`, error)

  return {
    message,
    originalError: error,
  }
}
