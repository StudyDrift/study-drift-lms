const STORAGE_KEY = 'lextures:canvas-import-credentials:v1'

type StoredShape = {
  v: 1
  canvasBaseUrl: string
  accessToken: string
}

export function loadCanvasImportCredentials(): {
  canvasBaseUrl: string
  accessToken: string
} | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const o = JSON.parse(raw) as unknown
    if (!o || typeof o !== 'object') return null
    const rec = o as Partial<StoredShape>
    if (rec.v !== 1) return null
    if (typeof rec.canvasBaseUrl !== 'string' || typeof rec.accessToken !== 'string') return null
    const canvasBaseUrl = rec.canvasBaseUrl.trim()
    const accessToken = rec.accessToken.trim()
    if (!canvasBaseUrl || !accessToken) return null
    return { canvasBaseUrl, accessToken }
  } catch {
    return null
  }
}

export function saveCanvasImportCredentials(canvasBaseUrl: string, accessToken: string): void {
  if (typeof localStorage === 'undefined') return
  try {
    const payload: StoredShape = {
      v: 1,
      canvasBaseUrl: canvasBaseUrl.trim(),
      accessToken: accessToken.trim(),
    }
    if (!payload.canvasBaseUrl || !payload.accessToken) return
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  } catch {
    /* quota / private mode */
  }
}

export function clearCanvasImportCredentials(): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
}
