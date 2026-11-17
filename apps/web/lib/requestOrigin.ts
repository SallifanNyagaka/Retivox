/** Build an absolute origin from the reverse-proxy headers on this request. */
export function requestOrigin(requestHeaders: Pick<Headers, 'get'>) {
  const host = requestHeaders.get('x-forwarded-host')?.split(',')[0]?.trim()
    ?? requestHeaders.get('host')?.trim()
  if (!host || !/^[a-z0-9.-]+(?::\d{1,5})?$/i.test(host)) {
    throw new Error('Unable to determine the application host for this request.')
  }

  const forwardedProtocol = requestHeaders.get('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase()
  const isLocalHost = /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host)
  const protocol = forwardedProtocol === 'https' ? 'https' : isLocalHost ? 'http' : 'https'
  return `${protocol}://${host}`
}
