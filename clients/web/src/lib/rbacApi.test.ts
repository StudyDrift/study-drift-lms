import { describe, expect, it } from 'vitest'
import { isValidPermissionString } from './rbacApi'

describe('isValidPermissionString', () => {
  it('accepts exactly four colon-separated non-empty parts', () => {
    expect(isValidPermissionString('a:b:c:d')).toBe(true)
    expect(isValidPermissionString('global:app:course:create')).toBe(true)
  })

  it('rejects wrong segment count', () => {
    expect(isValidPermissionString('a:b:c')).toBe(false)
    expect(isValidPermissionString('a:b:c:d:e')).toBe(false)
  })

  it('rejects empty segments', () => {
    expect(isValidPermissionString('a:b::d')).toBe(false)
    expect(isValidPermissionString(' :b:c:d')).toBe(false)
  })

  it('trims whitespace before validating', () => {
    expect(isValidPermissionString('  a:b:c:d  ')).toBe(true)
  })
})
