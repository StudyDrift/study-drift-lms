import { authorizedFetch } from './api'
import { getJwtSubject } from './auth'
import { mapPool } from './async-pool'
import { fetchMailboxMessages, type MailboxMessage } from './communication-api'
import { fetchFeedChannels, fetchFeedMessages, type FeedMessage } from './course-feed-api'
import { getCourseViewAs } from './course-view-as'
import { readApiErrorMessage } from './errors'
import {
  fetchCourse,
  fetchCourseMyGrades,
  fetchCourseStructure,
  learnerCourseItemHref,
  viewerShouldShowMyGradesNav,
  type CourseMyGradesResponse,
  type CoursePublic,
  type CourseStructureItem,
} from './courses-api'

export type UnifiedNotificationKind = 'inbox' | 'feed_mention' | 'announcement' | 'graded'

export type UnifiedNotification = {
  id: string
  kind: UnifiedNotificationKind
  /** ISO 8601 for sorting (newest first). */
  sortAt: string
  title: string
  subtitle: string
  href: string
}

const FEED_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000
const MAX_CHANNELS_PER_COURSE = 6
const MAX_FEED_NODES_PER_COURSE = 200

function hasStudentRole(roles: readonly string[] | undefined): boolean {
  if (!roles?.length) return false
  return roles.some((r) => r.trim().toLowerCase() === 'student')
}

function feedSnippet(body: string, max = 120): string {
  const t = body
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/[#*_`[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!t) return ''
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`
}

function* walkFeedMessages(msgs: FeedMessage[], budget: { n: number }): Generator<FeedMessage> {
  for (const m of msgs) {
    if (budget.n <= 0) return
    budget.n -= 1
    yield m
    if (m.replies?.length) yield* walkFeedMessages(m.replies, budget)
  }
}

function isRootMessage(m: FeedMessage): boolean {
  return m.parentMessageId == null || m.parentMessageId === ''
}

async function loadCourseCatalog(): Promise<CoursePublic[]> {
  const res = await authorizedFetch('/api/v1/courses')
  const raw: unknown = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  const data = raw as { courses?: CoursePublic[] }
  const list = data.courses ?? []
  if (!list.length) return []
  return mapPool(list, 4, async (c) => {
    try {
      return await fetchCourse(c.courseCode)
    } catch {
      return c
    }
  })
}

function inboxItems(msgs: MailboxMessage[]): UnifiedNotification[] {
  const unread = msgs.filter((m) => m.folder === 'inbox' && !m.read)
  unread.sort((a, b) => new Date(b.sent_at).getTime() - new Date(a.sent_at).getTime())
  const cut = unread.slice(0, 25)
  return cut.map((m) => ({
    id: `inbox:${m.id}`,
    kind: 'inbox' as const,
    sortAt: m.sent_at,
    title: m.subject?.trim() || '(No subject)',
    subtitle: `From ${m.from.name} · Inbox`,
    href: '/inbox',
  }))
}

async function gradedItems(courses: CoursePublic[]): Promise<UnifiedNotification[]> {
  const viewer = getJwtSubject()
  if (!viewer) return []

  const studentCourses = courses.filter((c) => hasStudentRole(c.viewerEnrollmentRoles))
  if (!studentCourses.length) return []

  const rows = await mapPool(studentCourses, 3, async (course) => {
    const code = course.courseCode
    const preview = getCourseViewAs(code)
    if (!viewerShouldShowMyGradesNav(course.viewerEnrollmentRoles, preview)) {
      return [] as UnifiedNotification[]
    }
    let structure: CourseStructureItem[] = []
    let my: CourseMyGradesResponse | null = null
    try {
      structure = await fetchCourseStructure(code)
    } catch {
      structure = []
    }
    try {
      my = await fetchCourseMyGrades(code)
    } catch {
      return []
    }
    const byId = new Map(structure.map((s) => [s.id, s]))
    const out: UnifiedNotification[] = []
    for (const col of my.columns) {
      if (col.kind !== 'quiz' && col.kind !== 'assignment') continue
      if (col.maxPoints == null || col.maxPoints <= 0) continue
      const raw = my.grades[col.id]
      if (raw == null || String(raw).trim() === '') continue
      const item = byId.get(col.id)
      if (!item || (item.kind !== 'quiz' && item.kind !== 'assignment')) continue
      const sortAt = item.updatedAt || course.updatedAt
      const href = learnerCourseItemHref(code, item)
      out.push({
        id: `graded:${code}:${col.id}`,
        kind: 'graded',
        sortAt,
        title: col.title,
        subtitle: `${String(raw).trim()} / ${col.maxPoints} pts · ${course.title}`,
        href,
      })
    }
    return out
  })

  return rows.flat()
}

async function feedDerivedItems(courses: CoursePublic[]): Promise<UnifiedNotification[]> {
  const viewer = getJwtSubject()
  if (!viewer) return []
  const vLower = viewer.toLowerCase()
  const cutoff = Date.now() - FEED_LOOKBACK_MS
  const feedCourses = courses.filter((c) => c.feedEnabled !== false)
  if (!feedCourses.length) return []

  const rows = await mapPool(feedCourses, 3, async (course) => {
    const code = course.courseCode
    const out: UnifiedNotification[] = []
    try {
      const channels = await fetchFeedChannels(code)
      if (!channels.length) return out
      const sorted = [...channels].sort((a, b) => a.sortOrder - b.sortOrder)
      const slice = sorted.slice(0, MAX_CHANNELS_PER_COURSE)
      for (const ch of slice) {
        let messages: FeedMessage[] = []
        try {
          messages = await fetchFeedMessages(code, ch.id)
        } catch {
          continue
        }
        const announceChannel = ch.name.toLowerCase().includes('announce')
        const budget = { n: MAX_FEED_NODES_PER_COURSE }
        for (const m of walkFeedMessages(messages, budget)) {
          if (m.authorUserId.toLowerCase() === vLower) continue
          const t = new Date(m.createdAt).getTime()
          if (Number.isNaN(t) || t < cutoff) continue

          const mentioned =
            m.mentionsEveryone ||
            m.mentionUserIds.some((id) => id.toLowerCase() === vLower)

          const root = isRootMessage(m)
          if (announceChannel && root) {
            const snip = feedSnippet(m.body)
            out.push({
              id: `feed:announce:${code}:${ch.id}:${m.id}`,
              kind: 'announcement',
              sortAt: m.createdAt,
              title: snip || `Announcement in #${ch.name}`,
              subtitle: `${m.authorDisplayName?.trim() || m.authorEmail || 'Someone'} · ${course.title}`,
              href: `/courses/${encodeURIComponent(code)}/feed`,
            })
            continue
          }

          if (mentioned) {
            const snip = feedSnippet(m.body)
            out.push({
              id: `feed:mention:${code}:${ch.id}:${m.id}`,
              kind: 'feed_mention',
              sortAt: m.createdAt,
              title: snip || 'You were mentioned',
              subtitle: `#${ch.name} · ${course.title}`,
              href: `/courses/${encodeURIComponent(code)}/feed`,
            })
          }
        }
      }
    } catch {
      /* skip course */
    }
    return out
  })

  return rows.flat()
}

/** Loads inbox, feed (mentions + announcements), and graded rows for merge in the notifications UI. */
export async function fetchUnifiedNotifications(): Promise<UnifiedNotification[]> {
  if (!getJwtSubject()) return []

  const [inboxMsgs, courses] = await Promise.all([
    fetchMailboxMessages('inbox', '').catch(() => [] as MailboxMessage[]),
    loadCourseCatalog().catch(() => [] as CoursePublic[]),
  ])

  const parts = await Promise.all([
    Promise.resolve(inboxItems(inboxMsgs)),
    gradedItems(courses),
    feedDerivedItems(courses),
  ])

  const merged = parts.flat()
  merged.sort((a, b) => new Date(b.sortAt).getTime() - new Date(a.sortAt).getTime())

  const seen = new Set<string>()
  const deduped: UnifiedNotification[] = []
  for (const row of merged) {
    if (seen.has(row.id)) continue
    seen.add(row.id)
    deduped.push(row)
    if (deduped.length >= 100) break
  }
  return deduped
}
