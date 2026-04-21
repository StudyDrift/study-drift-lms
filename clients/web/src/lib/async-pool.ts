/** Run async work on `items` with at most `limit` concurrent executions. */
export async function mapPool<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  if (items.length === 0) return []
  const results: R[] = new Array(items.length)
  let nextIndex = 0

  async function worker() {
    for (;;) {
      const i = nextIndex++
      if (i >= items.length) return
      results[i] = await fn(items[i]!)
    }
  }

  const n = Math.max(1, Math.min(limit, items.length))
  await Promise.all(Array.from({ length: n }, () => worker()))
  return results
}
