import type { MetadataRoute } from 'next'

/**
 * Declares Retivox as an installable web application on supported browsers.
 * The same manifest is used by Android Chrome and desktop browsers.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Retivox',
    short_name: 'Retivox',
    description: 'Retail operations, inventory, and sales for every store.',
    start_url: '/',
    display: 'standalone',
    background_color: '#f8fafc',
    theme_color: '#0f766e',
    icons: [
      {
        src: '/retivox-icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'maskable',
      },
    ],
  }
}
