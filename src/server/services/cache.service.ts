import { caching, MemoryCache } from "cache-manager"
import { logService } from "./log.service"

let cache: MemoryCache | undefined

caching("memory", {
  max: 1000,
  ttl: 60 * 60 * 1000 /*milliseconds*/,
})
  .then((cache) => {
    cache = cache
  })
  .catch((err) => {
    logService.error(err)
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
