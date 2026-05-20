import Dexie, { type EntityTable } from 'dexie'

export interface OfflineCourse {
  id: string
  org_id: string
  name: string
  updated_at: string
  cached_at: string
}

export interface OfflineCourseItem {
  id: string
  course_id: string
  type: 'content_page' | 'quiz'
  title: string
  content: string
  updated_at: string
  cached_at: string
}

export interface OfflineQuizAttempt {
  id: string
  quiz_id: string
  course_id: string
  status: 'draft' | 'pending_sync'
  answers: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface PendingSync {
  id?: number
  type: 'quiz_submission' | 'discussion_post'
  payload: string
  url: string
  method: string
  created_at: string
  attempts: number
}

class LexturesDB extends Dexie {
  courses!: EntityTable<OfflineCourse, 'id'>
  course_items!: EntityTable<OfflineCourseItem, 'id'>
  quiz_attempts!: EntityTable<OfflineQuizAttempt, 'id'>
  pending_syncs!: EntityTable<PendingSync, 'id'>

  constructor() {
    super('LexturesOfflineDB')
    this.version(1).stores({
      courses: 'id, org_id, name, updated_at, cached_at',
      course_items: 'id, course_id, type, updated_at, cached_at',
      quiz_attempts: 'id, quiz_id, course_id, status, created_at',
      pending_syncs: '++id, type, created_at, attempts',
    })
  }
}

export const db = new LexturesDB()

export const MAX_PENDING_SYNCS = 50

export async function addPendingSync(
  entry: Omit<PendingSync, 'id' | 'attempts' | 'created_at'>,
): Promise<number> {
  const count = await db.pending_syncs.count()
  if (count >= MAX_PENDING_SYNCS) {
    const oldest = await db.pending_syncs.orderBy('created_at').first()
    if (oldest?.id != null) await db.pending_syncs.delete(oldest.id)
  }
  return db.pending_syncs.add({
    ...entry,
    attempts: 0,
    created_at: new Date().toISOString(),
  }) as Promise<number>
}

export async function drainPendingSync(): Promise<{ sent: number; failed: number }> {
  const items = await db.pending_syncs.orderBy('created_at').toArray()
  let sent = 0
  let failed = 0
  for (const item of items) {
    if (item.attempts >= 5) {
      failed++
      continue
    }
    try {
      const res = await fetch(item.url, {
        method: item.method,
        headers: { 'Content-Type': 'application/json' },
        body: item.payload,
      })
      if (res.ok) {
        if (item.id != null) await db.pending_syncs.delete(item.id)
        sent++
      } else {
        if (item.id != null) await db.pending_syncs.update(item.id, { attempts: item.attempts + 1 })
        failed++
      }
    } catch {
      if (item.id != null) await db.pending_syncs.update(item.id, { attempts: item.attempts + 1 })
      failed++
    }
  }
  return { sent, failed }
}

export async function evictOldCacheItems(): Promise<void> {
  const QUOTA_THRESHOLD = 80
  if (!navigator.storage?.estimate) return
  const { usage, quota } = await navigator.storage.estimate()
  if (!usage || !quota) return
  const usedPercent = (usage / quota) * 100
  if (usedPercent < QUOTA_THRESHOLD) return

  const oldestItems = await db.course_items.orderBy('cached_at').limit(20).toArray()
  const ids = oldestItems.map((i) => i.id)
  await db.course_items.bulkDelete(ids)
}
