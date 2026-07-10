'use client'
/**
 * Full-screen centered loading overlay with spinning indicator.
 *
 * Displays while async operations (server actions) are in progress.
 */

type LoadingOverlayProps = {
  message?: string
}

/**
 * LoadingOverlay renders a blocking spinner with an optional action label.
 */
export default function LoadingOverlay({ message = 'Processing...' }: LoadingOverlayProps) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0,0,0,0.3)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 65,
      }}
    >
      <div
        style={{
          background: 'white',
          borderRadius: 8,
          padding: 24,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 12,
          boxShadow: '0 10px 40px rgba(0,0,0,0.2)',
        }}
      >
        <svg className="animate-spin h-8 w-8" viewBox="0 0 24 24" fill="none" style={{ color: '#059669' }}>
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
        </svg>
        <p style={{ fontSize: 13, color: '#666', margin: 0 }}>{message}</p>
      </div>
    </div>
  )
}
