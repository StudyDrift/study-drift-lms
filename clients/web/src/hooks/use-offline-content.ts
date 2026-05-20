import { useCallback, useEffect, useState } from 'react'
import { db, evictOldCacheItems, type OfflineCourseItem } from '../db/schema'

export type CacheStatus = 'uncached' | 'cached' | 'saving'

export function useOfflineContent(itemId: string | undefined) {
  const [status, setStatus] = useState<CacheStatus>('uncached')

  useEffect(() => {
    if (!itemId) return
    void db.course_items.get(itemId).then((item) => {
      setStatus(item ? 'cached' : 'uncached')
    })
  }, [itemId])

  const saveForOffline = useCallback(
    async (entry: Omit<OfflineCourseItem, 'cached_at'>) => {
      if (!itemId) return
      setStatus('saving')
      try {
        await evictOldCacheItems()
        await db.course_items.put({ ...entry, cached_at: new Date().toISOString() })
        setStatus('cached')
      } catch {
        setStatus('uncached')
      }
    },
    [itemId],
  )

  const removeFromOffline = useCallback(async () => {
    if (!itemId) return
    await db.course_items.delete(itemId)
    setStatus('uncached')
  }, [itemId])

  const getCachedContent = useCallback(async (): Promise<OfflineCourseItem | undefined> => {
    if (!itemId) return undefined
    return db.course_items.get(itemId)
  }, [itemId])

  return { status, saveForOffline, removeFromOffline, getCachedContent }
}
