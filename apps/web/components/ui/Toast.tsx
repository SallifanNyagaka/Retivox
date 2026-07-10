'use client'
/**
 * Toast notification component for temporary messages (success, error, info).
 *
 * Appears at the top of the screen and auto-dismisses after duration.
 */

import { useEffect } from 'react'

type ToastProps = {
  message: string
  type?: 'success' | 'error' | 'info'
  duration?: number
  onDismiss: () => void
}

export default function Toast({ message, type = 'info', duration = 3000, onDismiss }: ToastProps) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, duration)
    return () => clearTimeout(timer)
  }, [duration, onDismiss])

  const bgColor = type === 'success' ? '#059669' : type === 'error' ? '#dc2626' : '#3b82f6'
  const icon =
    type === 'success'
      ? '✓'
      : type === 'error'
        ? '✕'
        : 'ℹ'

  return (
    <div
      style={{
        position: 'fixed',
        top: 16,
        right: 16,
        zIndex: 70,
        background: bgColor,
        color: 'white',
        padding: '12px 16px',
        borderRadius: 6,
        fontSize: 13,
        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        animation: 'slideIn 0.3s ease-out',
      }}
    >
      <span style={{ fontWeight: 600 }}>{icon}</span>
      <span>{message}</span>
    </div>
  )
}
