import { describe, expect, it, vi } from 'vitest'
import {
  decodeTitleFromToken,
  encodeRefToken,
  encodeTitleForToken,
  expandQuizPromptWithRefs,
  hrefForModuleCourseItem,
} from './courseItemRefTokens'
import * as coursesApi from './coursesApi'

describe('courseItemRefTokens', () => {
  it('round-trips title through base64url', () => {
    const t = 'Hello: 世界'
    expect(decodeTitleFromToken(encodeTitleForToken(t))).toBe(t)
  })

  it('hrefForModuleCourseItem builds LMS paths', () => {
    expect(hrefForModuleCourseItem('CS 101', 'assignment', 'abc')).toBe(
      '/courses/CS%20101/modules/assignment/abc',
    )
    expect(hrefForModuleCourseItem('X', 'content_page', 'id-1')).toBe(
      '/courses/X/modules/content/id-1',
    )
  })

  it('encodeRefToken matches parser', () => {
    const id = '550e8400-e29b-41d4-a716-446655440000'
    const tok = encodeRefToken('assignment', id, 'HW 1')
    expect(tok).toMatch(/^<<REF:assignment:550e8400-e29b-41d4-a716-446655440000:[A-Za-z0-9_-]+>>$/)
  })

  it('expandQuizPromptWithRefs fetches and wraps with markers', async () => {
    const fetchPage = vi.spyOn(coursesApi, 'fetchModuleContentPage').mockResolvedValue({
      itemId: '1',
      title: 'Page',
      markdown: '# Hello',
      dueAt: null,
      pointsWorth: null,
      assignmentGroupId: null,
      updatedAt: new Date().toISOString(),
      availableFrom: null,
      availableUntil: null,
      requiresAssignmentAccessCode: false,
      assignmentAccessCode: null,
      submissionAllowText: true,
      submissionAllowFileUpload: false,
      submissionAllowUrl: false,
    })
    const fetchAssign = vi.spyOn(coursesApi, 'fetchModuleAssignment').mockResolvedValue({
      itemId: '2',
      title: 'A',
      markdown: 'Body',
      dueAt: null,
      pointsWorth: null,
      assignmentGroupId: null,
      updatedAt: new Date().toISOString(),
      availableFrom: null,
      availableUntil: null,
      requiresAssignmentAccessCode: false,
      assignmentAccessCode: null,
      submissionAllowText: true,
      submissionAllowFileUpload: false,
      submissionAllowUrl: false,
    })
    const id1 = 'a1b2c3d4-e5f6-4789-a012-345678901234'
    const id2 = 'b2c3d4e5-f6a7-4890-b123-456789012345'
    const t1 = encodeRefToken('content_page', id1, 'Read')
    const t2 = encodeRefToken('assignment', id2, 'Turn in')
    const prompt = `Study ${t1} then ${t2}.`
    const out = await expandQuizPromptWithRefs('CS-101', prompt)
    expect(out).toContain('BEGIN CONTENT FROM CONTENT PAGE: "Read"')
    expect(out).toContain('# Hello')
    expect(out).toContain('END CONTENT FROM CONTENT PAGE: "Read"')
    expect(out).toContain('BEGIN CONTENT FROM ASSIGNMENT: "Turn in"')
    expect(out).toContain('Body')
    expect(out).toContain('END CONTENT FROM ASSIGNMENT: "Turn in"')
    expect(fetchPage).toHaveBeenCalledWith('CS-101', id1)
    expect(fetchAssign).toHaveBeenCalledWith('CS-101', id2)
    fetchPage.mockRestore()
    fetchAssign.mockRestore()
  })
})
