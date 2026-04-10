import { describe, expect, it } from 'vitest'
import {
  anyGrantMatches,
  hasConcreteCourseItemCreatePermission,
  permissionMatches,
} from './permissionMatch'

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

describe('hasConcreteCourseItemCreatePermission', () => {
  it('is true for a grant scoped to the course code', () => {
    expect(
      hasConcreteCourseItemCreatePermission(['course:C-1:item:create'], 'C-1'),
    ).toBe(true)
  })

  it('is false when only a wildcard course segment exists', () => {
    expect(hasConcreteCourseItemCreatePermission(['course:*:item:create'], 'C-1')).toBe(false)
  })
})
