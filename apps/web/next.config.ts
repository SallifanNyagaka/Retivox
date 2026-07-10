/**
 * @fileoverview Next.js configuration for the Retivox web app.
 * Part of a Turborepo monorepo.
 * Performance and security settings configured here.
 */

import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Empty turbopack config — silences the turbopack/webpack warning
  turbopack: {},

  images: {
    // AVIF is up to 50% smaller than WebP, WebP up to 30% smaller than JPEG
    formats: ['image/avif', 'image/webp'],
    minimumCacheTTL: 60,
  },

  // Remove X-Powered-By header — prevents exposing tech stack to attackers
  poweredByHeader: false,

  // Enable gzip compression for faster page delivery
  compress: true,

  // Strict mode catches potential React issues early in development
  reactStrictMode: true,
}

export default nextConfig