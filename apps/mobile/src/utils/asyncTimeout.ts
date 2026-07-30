/**
 * Async timeout helpers for Retivox mobile.
 *
 * Network calls on mobile can occasionally hang instead of failing promptly.
 * Racing them against a timer lets the UI recover and show a useful message.
 */

/**
 * Rejects an async operation if it takes longer than the configured timeout.
 *
 * @param promise - Async operation to guard.
 * @param timeoutMs - Maximum time to wait in milliseconds.
 * @param message - Error message used when the timeout is reached.
 * @returns The original promise result.
 */
export async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(message))
    }, timeoutMs)
  })

  try {
    return await Promise.race([promise, timeoutPromise])
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
  }
}
