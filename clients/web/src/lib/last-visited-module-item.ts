const STORAGE_KEY = 'lextures:last-module-item:v1'

export type LastVisitedModuleKind = 'content_page' | 'assignment' | 'quiz' | 'external_link'

export type LastVisitedModuleEntry = {
  itemId: string
  kind: LastVisitedModuleKind
  title: string
  openedAt: string
}

type StoreShape = Record<string, LastVisitedModuleEntry>

function readStore(): StoreShape {
  if (typeof localStorage === 'undefined') return {}
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const o = JSON.parse(raw) as unknown
    if (!o || typeof o !== 'object') return {}
    return o as StoreShape
  } catch {
    return {}
  }
}

function writeStore(next: StoreShape) {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    /* quota / private mode */
  }
}

/** Remember the last module item the user opened (per course). */
export function recordLastVisitedModuleItem(
  courseCode: string,
  entry: Omit<LastVisitedModuleEntry, 'openedAt'> & { openedAt?: string },
): void {
  const code = courseCode.trim()
  if (!code || !entry.itemId.trim()) return
  const prev = readStore()
  writeStore({
    ...prev,
    [code]: {
      itemId: entry.itemId.trim(),
      kind: entry.kind,
      title: entry.title.trim() || 'Untitled',
      openedAt: entry.openedAt ?? new Date().toISOString(),
    },
  })
}

export function getLastVisitedForCourse(courseCode: string): LastVisitedModuleEntry | null {
  const code = courseCode.trim()
  if (!code) return null
  const row = readStore()[code]
  if (!row?.itemId) return null
  return row
}

/** Most recently opened item among the given course codes (catalog membership). */
export function getMostRecentLastVisited(
  courseCodes: readonly string[],
): (LastVisitedModuleEntry & { courseCode: string }) | null {
  const allowed = new Set(courseCodes.map((c) => c.trim()).filter(Boolean))
  let best: (LastVisitedModuleEntry & { courseCode: string }) | null = null
  const store = readStore()
  for (const [code, row] of Object.entries(store)) {
    if (!allowed.has(code) || !row?.itemId) continue
    const t = Date.parse(row.openedAt)
    if (!best || t > Date.parse(best.openedAt)) {
      best = { ...row, courseCode: code }
    }
  }
  return best
}

export function hrefForLastVisited(courseCode: string, kind: LastVisitedModuleKind, itemId: string): string {
  const cc = encodeURIComponent(courseCode)
  const id = encodeURIComponent(itemId)
  switch (kind) {
    case 'content_page':
      return `/courses/${cc}/modules/content/${id}`
    case 'assignment':
      return `/courses/${cc}/modules/assignment/${id}`
    case 'quiz':
      return `/courses/${cc}/modules/quiz/${id}`
    case 'external_link':
      return `/courses/${cc}/modules/external-link/${id}`
  }
}
