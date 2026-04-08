import { describe, expect, it } from 'vitest'
import { courseGradebookViewPermission, courseItemCreatePermission } from './coursesApi'

describe('courseItemCreatePermission', () => {
  it('builds the server-aligned permission string from course code', () => {
    expect(courseItemCreatePermission('C-ABC123')).toBe('course:C-ABC123:item:create')
  })
})

describe('courseGradebookViewPermission', () => {
  it('builds the server-aligned permission string from course code', () => {
    expect(courseGradebookViewPermission('C-ABC123')).toBe('course:C-ABC123:gradebook:view')
  })
})
