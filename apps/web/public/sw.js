/* Retivox PWA service worker. Private dashboard pages are cleared when accounts change. */
const VERSION = 'retivox-pwa-v2'
const STATIC_CACHE = `${VERSION}-static`
const PAGE_CACHE = `${VERSION}-pages`
const STATIC_URLS = ['/', '/login', '/offline', '/manifest.webmanifest', '/retivox-icon.svg']

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(STATIC_CACHE).then((cache) => cache.addAll(STATIC_URLS)))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys
        .filter((key) => key.startsWith('retivox-pwa-') && !key.startsWith(VERSION))
        .map((key) => caches.delete(key)),
    )),
  )
  self.clients.claim()
})

async function cacheNetworkResponse(cacheName, request) {
  const response = await fetch(request)

  if (response.ok) {
    const cache = await caches.open(cacheName)
    await cache.put(request, response.clone())
  }

  return response
}

async function networkFirst(request, fallbackUrl) {
  try {
    return await cacheNetworkResponse(PAGE_CACHE, request)
  } catch {
    const cache = await caches.open(PAGE_CACHE)
    const savedResponse = await cache.match(request)

    if (savedResponse) {
      return savedResponse
    }

    return (await caches.match(fallbackUrl)) || Response.error()
  }
}

async function cacheFirst(request) {
  const cachedResponse = await caches.match(request)

  if (cachedResponse) {
    return cachedResponse
  }

  try {
    return await cacheNetworkResponse(STATIC_CACHE, request)
  } catch {
    return Response.error()
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request

  if (request.method !== 'GET') {
    return
  }

  const url = new URL(request.url)

  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) {
    return
  }

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, '/offline'))
    return
  }

  if (url.pathname.startsWith('/_next/static/') || url.pathname === '/retivox-icon.svg') {
    event.respondWith(cacheFirst(request))
    return
  }

  // Next App Router navigation needs cached RSC payloads as well as HTML.
  if (url.searchParams.has('_rsc')) {
    event.respondWith(networkFirst(request, '/offline'))
  }
})

self.addEventListener('message', (event) => {
  if (event.data?.type === 'CACHE_CURRENT_PAGE' && typeof event.data.url === 'string') {
    event.waitUntil(
      cacheNetworkResponse(PAGE_CACHE, new Request(event.data.url, { credentials: 'include' })).catch(() => undefined),
    )
    return
  }

  if (event.data?.type === 'CACHE_STATIC_ASSETS' && Array.isArray(event.data.urls)) {
    const urls = event.data.urls.filter((url) => typeof url === 'string').slice(0, 100)
    event.waitUntil(
      Promise.all(
        urls.map((url) => cacheNetworkResponse(STATIC_CACHE, new Request(url)).catch(() => undefined)),
      ),
    )
    return
  }

  if (event.data?.type !== 'CLEAR_PRIVATE_PWA_CACHE') {
    return
  }

  event.waitUntil(caches.delete(PAGE_CACHE))
})
