import { describe, expect, it } from 'vitest'
import { joinApiBase } from './api'

describe('joinApiBase', () => {
  it('strips trailing slash from base and ensures leading slash on path', () => {
    expect(joinApiBase('http://localhost:8080/', '/api/v1/auth/login')).toBe(
      'http://localhost:8080/api/v1/auth/login',
    )
  })

  it('adds leading slash when path omits it', () => {
    expect(joinApiBase('http://localhost:8080', 'health')).toBe('http://localhost:8080/health')
  })
})
