import { describe, expect, it } from 'vitest'
import type { CourseStructureItem } from '../lib/coursesApi'
import { filterTaggable, getMentionState, kindLabel } from './courseItemPromptMention'

describe('getMentionState', () => {
  it('returns null when there is no @', () => {
    expect(getMentionState('hello', 5)).toBeNull()
  })

  it('captures query after @ at word boundary', () => {
    const s = 'Hi @foo'
    const st = getMentionState(s, s.length)
    expect(st).toEqual({ start: 3, query: 'foo' })
  })

  it('returns null when @ is inside a token (no whitespace before)', () => {
    expect(getMentionState('a@b.com', 7)).toBeNull()
  })

  it('returns null when query contains a space', () => {
    const s = 'Hi @foo bar'
    expect(getMentionState(s, s.length)).toBeNull()
  })

  it('returns null when query spans a newline', () => {
    const s = 'Hi @foo\nbar'
    expect(getMentionState(s, 8)).toBeNull()
  })
})

describe('kindLabel', () => {
  it('maps known kinds to readable labels', () => {
    expect(kindLabel('content_page')).toBe('Content page')
    expect(kindLabel('assignment')).toBe('Assignment')
  })

  it('returns other kinds as-is', () => {
    expect(kindLabel('quiz')).toBe('quiz')
  })
})

describe('filterTaggable', () => {
  const items = [
    { id: '1', kind: 'content_page' as const, title: 'Alpha Page' },
    { id: '2', kind: 'assignment' as const, title: 'Beta Task' },
    { id: '3', kind: 'quiz' as const, title: 'Ignored' },
  ] as CourseStructureItem[]

  it('keeps only content pages and assignments when query is empty', () => {
    expect(filterTaggable(items, '')).toHaveLength(2)
  })

  it('filters by title substring', () => {
    expect(filterTaggable(items, 'alp')).toHaveLength(1)
    expect(filterTaggable(items, 'alp')[0]!.id).toBe('1')
  })

  it('matches content keyword to content_page', () => {
    const onlyQuiz = [{ id: '1', kind: 'quiz' as const, title: 'x' }] as CourseStructureItem[]
    expect(filterTaggable(onlyQuiz, 'content')).toHaveLength(0)
    expect(filterTaggable(items, 'content')).toHaveLength(1)
  })
})
