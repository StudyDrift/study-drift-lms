import { describe, expect, it } from 'vitest'
import {
  courseEnrollmentsReadPermission,
  courseGradebookViewPermission,
  courseItemCreatePermission,
  courseItemsCreatePermission,
} from './coursesApi'

describe('courseItemCreatePermission', () => {
  it('builds the server-aligned permission string from course code', () => {
    expect(courseItemCreatePermission('C-ABC123')).toBe('course:C-ABC123:item:create')
  })
})

describe('courseItemsCreatePermission', () => {
  it('builds the server-aligned permission string from course code', () => {
    expect(courseItemsCreatePermission('C-ABC123')).toBe('course:C-ABC123:items:create')
  })
})

describe('courseGradebookViewPermission', () => {
  it('builds the server-aligned permission string from course code', () => {
    expect(courseGradebookViewPermission('C-ABC123')).toBe('course:C-ABC123:gradebook:view')
  })
})

describe('courseEnrollmentsReadPermission', () => {
  it('builds the server-aligned permission string from course code', () => {
    expect(courseEnrollmentsReadPermission('C-ABC123')).toBe('course:C-ABC123:enrollments:read')
  })
})
