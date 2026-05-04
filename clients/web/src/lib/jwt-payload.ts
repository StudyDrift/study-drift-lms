/**
 * Reads the JWT `sub` claim without verifying the signature (namespacing only).
 */
export function decodeJwtSub(accessToken: string | null | undefined): string | null {
  const p = decodeJwtPayload(accessToken)
  return p?.sub ?? null
}

/** Reads JWT claims without verifying the signature (client-side convenience only). */
export function decodeJwtPayload(accessToken: string | null | undefined): {
  sub?: string
  org_id?: string
  org_slug?: string
} | null {
  if (!accessToken || typeof accessToken !== 'string') return null
  const parts = accessToken.split('.')
  if (parts.length < 2) return null
  try {
    const segment = parts[1]
    const b64 = segment.replace(/-/g, '+').replace(/_/g, '/')
    const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4))
    const json = atob(b64 + pad)
    const o = JSON.parse(json) as { sub?: unknown; org_id?: unknown; org_slug?: unknown }
    const out: { sub?: string; org_id?: string; org_slug?: string } = {}
    if (typeof o.sub === 'string' && o.sub.length > 0) out.sub = o.sub
    if (typeof o.org_id === 'string' && o.org_id.length > 0) out.org_id = o.org_id
    if (typeof o.org_slug === 'string' && o.org_slug.length > 0) out.org_slug = o.org_slug
    return out
  } catch {
    return null
  }
}
