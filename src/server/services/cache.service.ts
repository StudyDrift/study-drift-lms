import { createCache } from "cache-manager"
import { CacheableMemory } from "cacheable"
import { Keyv } from "keyv"

const cache = createCache({
  stores: [
    //  High performance in-memory cache with LRU and TTL
    new Keyv({
      store: new CacheableMemory({ ttl: 60000, lruSize: 5000 }),
    }),
  ],
})

export const getCacheItem = async <T>(key: string) => {
  return await cache!.get<T>(key)
}

export const setCacheItem = async <T>(
  key: string,
  value: T,
  ttl = 60 * 60 * 1000 /*milliseconds*/
) => {
  return await cache!.set(key, value, ttl)
}
