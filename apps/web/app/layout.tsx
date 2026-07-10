/**
 * This is the root layout for the Retivox web app.
 * It wraps every page in the application.
 * It sets up the HTML document, metadata, font loading and theme provider.
 * Dark mode class is managed here.
 */

import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'
import './globals.css'

export const metadata: Metadata = {
  title: {
    default: 'Retivox',
    template: '%s | Retivox',
  },
  description: 'Retivox — Run every store. From anywhere.',
  keywords: ['retail', 'POS', 'inventory', 'multi-branch', 'Kenya', 'Africa'],
  authors: [{ name: 'Retivox' }],
  creator: 'Retivox',
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'),
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      {/* Dark mode class is NOT added by default — user preference toggles it */}
      <body
        suppressHydrationWarning
        className="antialiased min-h-screen"
        style={{
          backgroundColor: 'var(--color-background)',
          color: 'var(--color-text-primary)',
        }}
      >
        {children}
      </body>
    </html>
  )
}
