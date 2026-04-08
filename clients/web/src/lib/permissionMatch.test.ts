import { describe, expect, it } from 'vitest'
import { anyGrantMatches, permissionMatches } from './permissionMatch'

describe('permissionMatches', () => {
  it('matches exact strings', () => {
    expect(
      permissionMatches(
        'course:C-6F8192:enrollments:create',
        'course:C-6F8192:enrollments:create',
      ),
    ).toBe(true)
  })

  it('matches when granted uses wildcards', () => {
    expect(permissionMatches('course:*:enrollments:*', 'course:C-6F8192:enrollments:create')).toBe(
      true,
    )
  })

  it('rejects when action differs', () => {
    expect(permissionMatches('course:*:enrollments:read', 'course:*:enrollments:create')).toBe(
      false,
    )
  })
})

describe('anyGrantMatches', () => {
  it('returns true if any grant matches', () => {
    expect(
      anyGrantMatches(['global:other:perm:here', 'course:*:enrollments:create'], 'course:x:enrollments:create'),
    ).toBe(true)
  })
})
