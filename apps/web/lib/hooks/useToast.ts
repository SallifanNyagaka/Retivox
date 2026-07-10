'use client'
/**
 * Hook for displaying toast notifications throughout the app.
 *
 * Usage:
 *   const { toast } = useToast()
 *   toast.success('Saved!')
 *   toast.error('Failed to save')
 */

import { useState, useCallback } from 'react'

export type ToastOptions = {
  message: string
  type?: 'success' | 'error' | 'info'
  duration?: number
}

type ToastState = (ToastOptions & { id: string }) | null

export function useToast() {
  const [toastState, setToastState] = useState<ToastState>(null)

  const dismiss = useCallback(() => {
    setToastState(null)
  }, [])

  const show = useCallback((options: ToastOptions) => {
    const id = Math.random().toString(36).slice(2)
    setToastState({ ...options, id })
  }, [])

  return {
    toast: {
      success: (message: string, duration = 3000) => show({ message, type: 'success', duration }),
      error: (message: string, duration = 4000) => show({ message, type: 'error', duration }),
      info: (message: string, duration = 3000) => show({ message, type: 'info', duration }),
    },
    toastState,
    dismiss,
  }
}
