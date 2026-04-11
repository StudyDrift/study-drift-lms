/**
 * Reads the JWT `sub` claim without verifying the signature (namespacing only).
 */
export function decodeJwtSub(accessToken: string | null | undefined): string | null {
  if (!accessToken || typeof accessToken !== 'string') return null
  const parts = accessToken.split('.')
  if (parts.length < 2) return null
  try {
    const segment = parts[1]
    const b64 = segment.replace(/-/g, '+').replace(/_/g, '/')
    const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4))
    const json = atob(b64 + pad)
    const o = JSON.parse(json) as { sub?: unknown }
    return typeof o.sub === 'string' && o.sub.length > 0 ? o.sub : null
  } catch {
    return null
  }
}
