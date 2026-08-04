/** Platform console fallback displayed while a console route is loading. */
export default function PlatformLoading() {
  return (
    <div className="flex min-h-screen w-full items-center justify-center" aria-busy="true" aria-live="polite">
      <div className="flex flex-col items-center gap-3 text-center">
        <span
          className="h-8 w-8 animate-spin rounded-full border-2 border-transparent"
          style={{ borderTopColor: 'var(--color-primary)', borderRightColor: 'var(--color-primary)' }}
        />
        <p style={{ color: 'var(--color-text-muted)', fontSize: 14, margin: 0 }}>Loading platform console...</p>
      </div>
    </div>
  )
}
