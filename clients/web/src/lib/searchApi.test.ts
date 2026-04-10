import { beforeEach, describe, expect, it } from 'vitest'
import { setAccessToken } from './auth'
import { fetchSearchIndex } from './searchApi'

describe('fetchSearchIndex', () => {
  beforeEach(() => {
    setAccessToken('test-token')
  })

  it('returns courses and people from the search API', async () => {
    const res = await fetchSearchIndex()
    expect(Array.isArray(res.courses)).toBe(true)
    expect(Array.isArray(res.people)).toBe(true)
  })
})
