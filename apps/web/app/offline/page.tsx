'use client'

import Link from 'next/link'

/**
 * Safe fallback for a route that has not yet been opened while online.
 * Previously visited dashboard pages are served from the PWA page cache.
 */
export default function OfflinePage() {
  return (
    <main
      className="flex min-h-screen items-center justify-center px-5 py-10"
      style={{ backgroundColor: 'var(--color-background)' }}
    >
      <section
        className="w-full max-w-md rounded-2xl border p-6 text-center"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
      >
        <p style={{ color: 'var(--color-primary)', fontSize: 14, fontWeight: 800, margin: 0 }}>
          RETIVOX OFFLINE
        </p>
        <h1 style={{ color: 'var(--color-text-primary)', fontSize: 24, fontWeight: 800, margin: '12px 0 0' }}>
          This screen has not been saved yet
        </h1>
        <p style={{ color: 'var(--color-text-muted)', fontSize: 14, lineHeight: 1.6, margin: '12px 0 0' }}>
          Connect once and open this screen to keep its latest view on this device. Previously opened Retivox screens remain available offline.
        </p>
        <Link href="/" className="btn-primary mt-5 inline-flex" style={{ borderRadius: 8, padding: '10px 16px' }}>
          Try the saved app
        </Link>
      </section>
    </main>
  )
}
