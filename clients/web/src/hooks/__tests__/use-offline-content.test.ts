import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import 'fake-indexeddb/auto'
import { useOfflineContent } from '../use-offline-content'
import { db } from '../../db/schema'

beforeEach(async () => {
  await db.course_items.clear()
})

describe('useOfflineContent', () => {
  it('starts with uncached status for unknown item', async () => {
    const { result } = renderHook(() => useOfflineContent('item-new'))
    await waitFor(() => expect(result.current.status).toBe('uncached'))
  })

  it('starts with cached status when item exists in db', async () => {
    await db.course_items.put({
      id: 'item-existing',
      course_id: 'cs101',
      type: 'content_page',
      title: 'Existing',
      content: '# content',
      updated_at: '2024-01-01T00:00:00Z',
      cached_at: '2024-01-01T00:00:00Z',
    })

    const { result } = renderHook(() => useOfflineContent('item-existing'))
    await waitFor(() => expect(result.current.status).toBe('cached'))
  })

  it('saveForOffline transitions status to cached', async () => {
    const { result } = renderHook(() => useOfflineContent('item-save'))
    await waitFor(() => expect(result.current.status).toBe('uncached'))

    await act(async () => {
      await result.current.saveForOffline({
        id: 'item-save',
        course_id: 'cs101',
        type: 'content_page',
        title: 'Save Test',
        content: '# Hello',
        updated_at: '2024-01-01T00:00:00Z',
      })
    })

    expect(result.current.status).toBe('cached')
    const stored = await db.course_items.get('item-save')
    expect(stored?.title).toBe('Save Test')
    expect(stored?.cached_at).toBeDefined()
  })

  it('removeFromOffline deletes item and sets uncached', async () => {
    await db.course_items.put({
      id: 'item-remove',
      course_id: 'cs101',
      type: 'content_page',
      title: 'To Remove',
      content: '# Remove me',
      updated_at: '2024-01-01T00:00:00Z',
      cached_at: '2024-01-01T00:00:00Z',
    })

    const { result } = renderHook(() => useOfflineContent('item-remove'))
    await waitFor(() => expect(result.current.status).toBe('cached'))

    await act(async () => {
      await result.current.removeFromOffline()
    })

    expect(result.current.status).toBe('uncached')
    const stored = await db.course_items.get('item-remove')
    expect(stored).toBeUndefined()
  })

  it('getCachedContent retrieves stored content', async () => {
    await db.course_items.put({
      id: 'item-get',
      course_id: 'cs101',
      type: 'content_page',
      title: 'Get Test',
      content: '# Get me',
      updated_at: '2024-01-01T00:00:00Z',
      cached_at: '2024-01-01T00:00:00Z',
    })

    const { result } = renderHook(() => useOfflineContent('item-get'))
    await waitFor(() => expect(result.current.status).toBe('cached'))

    let item
    await act(async () => {
      item = await result.current.getCachedContent()
    })
    expect((item as { title: string } | undefined)?.title).toBe('Get Test')
  })

  it('handles undefined itemId gracefully', async () => {
    const { result } = renderHook(() => useOfflineContent(undefined))
    await waitFor(() => expect(result.current.status).toBe('uncached'))

    await act(async () => {
      await result.current.saveForOffline({
        id: 'x',
        course_id: 'cs101',
        type: 'content_page',
        title: 'x',
        content: 'x',
        updated_at: '2024-01-01T00:00:00Z',
      })
    })
    // Should not throw or change status
    expect(result.current.status).toBe('uncached')
  })
})
