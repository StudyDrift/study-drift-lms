import { describe, it, expect, beforeEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { db, addPendingSync, drainPendingSync, evictOldCacheItems, MAX_PENDING_SYNCS } from './schema'

beforeEach(async () => {
  await db.courses.clear()
  await db.course_items.clear()
  await db.quiz_attempts.clear()
  await db.pending_syncs.clear()
})

describe('db schema', () => {
  it('stores and retrieves a course item', async () => {
    await db.course_items.put({
      id: 'item-1',
      course_id: 'cs101',
      type: 'content_page',
      title: 'Intro',
      content: '# Hello',
      updated_at: '2024-01-01T00:00:00Z',
      cached_at: '2024-01-01T00:00:00Z',
    })
    const item = await db.course_items.get('item-1')
    expect(item?.title).toBe('Intro')
    expect(item?.content).toBe('# Hello')
  })

  it('stores and retrieves a quiz attempt', async () => {
    await db.quiz_attempts.put({
      id: 'attempt-1',
      quiz_id: 'quiz-1',
      course_id: 'cs101',
      status: 'draft',
      answers: { q1: 'A', q2: 'B' },
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    })
    const attempt = await db.quiz_attempts.get('attempt-1')
    expect(attempt?.status).toBe('draft')
    expect(attempt?.answers).toEqual({ q1: 'A', q2: 'B' })
  })
})

describe('addPendingSync', () => {
  it('adds an entry and sets default fields', async () => {
    const id = await addPendingSync({
      type: 'quiz_submission',
      payload: JSON.stringify({ answer: 'A' }),
      url: '/api/v1/quizzes/1/submit',
      method: 'POST',
    })
    const entry = await db.pending_syncs.get(id)
    expect(entry?.attempts).toBe(0)
    expect(entry?.type).toBe('quiz_submission')
    expect(typeof entry?.created_at).toBe('string')
  })

  it('evicts the oldest entry when at MAX_PENDING_SYNCS limit', async () => {
    for (let i = 0; i < MAX_PENDING_SYNCS; i++) {
      await db.pending_syncs.add({
        type: 'discussion_post',
        payload: '{}',
        url: '/api/v1/discussions',
        method: 'POST',
        created_at: new Date(i * 1000).toISOString(),
        attempts: 0,
      })
    }
    const countBefore = await db.pending_syncs.count()
    expect(countBefore).toBe(MAX_PENDING_SYNCS)

    await addPendingSync({
      type: 'quiz_submission',
      payload: '{}',
      url: '/api/v1/quiz/submit',
      method: 'POST',
    })

    const countAfter = await db.pending_syncs.count()
    expect(countAfter).toBe(MAX_PENDING_SYNCS)
  })
})

describe('drainPendingSync', () => {
  it('sends queued requests and removes them on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))

    await addPendingSync({
      type: 'quiz_submission',
      payload: JSON.stringify({ answer: 'A' }),
      url: '/api/v1/quiz/submit',
      method: 'POST',
    })

    const { sent, failed } = await drainPendingSync()
    expect(sent).toBe(1)
    expect(failed).toBe(0)
    const remaining = await db.pending_syncs.count()
    expect(remaining).toBe(0)
  })

  it('increments attempts on failed requests', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))

    await addPendingSync({
      type: 'discussion_post',
      payload: '{}',
      url: '/api/v1/discussions',
      method: 'POST',
    })

    const { sent, failed } = await drainPendingSync()
    expect(sent).toBe(0)
    expect(failed).toBe(1)

    const items = await db.pending_syncs.toArray()
    expect(items[0].attempts).toBe(1)
  })

  it('marks entries with 5+ attempts as permanently failed', async () => {
    await db.pending_syncs.add({
      type: 'quiz_submission',
      payload: '{}',
      url: '/api/v1/quiz/submit',
      method: 'POST',
      created_at: new Date().toISOString(),
      attempts: 5,
    })

    const { sent, failed } = await drainPendingSync()
    expect(sent).toBe(0)
    expect(failed).toBe(1)
    // fetch should not be called for max-attempts items
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
  })

  it('handles network errors by incrementing attempts', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')))

    await addPendingSync({
      type: 'quiz_submission',
      payload: '{}',
      url: '/api/v1/quiz/submit',
      method: 'POST',
    })

    const { sent, failed } = await drainPendingSync()
    expect(sent).toBe(0)
    expect(failed).toBe(1)

    const items = await db.pending_syncs.toArray()
    expect(items[0].attempts).toBe(1)
  })
})

describe('evictOldCacheItems', () => {
  it('does nothing when storage estimate is not available', async () => {
    Object.defineProperty(navigator, 'storage', { value: undefined, writable: true })
    await db.course_items.put({
      id: 'item-1',
      course_id: 'cs101',
      type: 'content_page',
      title: 'Test',
      content: 'content',
      updated_at: '2024-01-01T00:00:00Z',
      cached_at: '2024-01-01T00:00:00Z',
    })
    await evictOldCacheItems()
    expect(await db.course_items.count()).toBe(1)
  })
})
