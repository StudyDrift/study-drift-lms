import { apiUrl } from './api'

/** Turns API-relative paths into absolute URLs against `VITE_API_URL`. */
export function resolveOrgBrandAssetUrl(pathOrUrl: string | null | undefined): string | null {
  if (!pathOrUrl?.trim()) return null
  const s = pathOrUrl.trim()
  if (s.startsWith('http://') || s.startsWith('https://')) return s
  const p = s.startsWith('/') ? s : `/${s}`
  return apiUrl(p)
}
