import { caching, MemoryCache } from "cache-manager"
import { logService } from "./log.service"

let cache: MemoryCache | undefined

export const getCacheItem = async <T>(key: string) => {
  if (!cache) {
    try {
      cache = await caching("memory", {
        max: 1000,
        ttl: 60 * 60 * 1000 /*milliseconds*/,
      })
    } catch (err) {
      logService.error("Error initializing cache", err)
    }
  }

  return await cache!.get<T>(key)
}

export const setCacheItem = async <T>(
  key: string,
  value: T,
  ttl = 60 * 60 * 1000 /*milliseconds*/
) => {
  return await cache!.set(key, value, ttl)
}
