import { describe, expect, it } from 'vitest'
import { reorderAmongSiblings, reparentPage, type CourseNotebookPage } from '../course-notebook-tree'

function pagesSeed(): CourseNotebookPage[] {
  return [
    { id: 'a', title: 'A', parentId: null, sortOrder: 0, contentMd: '' },
    { id: 'b', title: 'B', parentId: null, sortOrder: 1, contentMd: '' },
    { id: 'c', title: 'C', parentId: null, sortOrder: 2, contentMd: '' },
  ]
}

describe('reorderAmongSiblings', () => {
  it('moves root pages', () => {
    const next = reorderAmongSiblings(pagesSeed(), null, 'c', 'a')
    const order = next.filter((p) => p.parentId === null).sort((x, y) => x.sortOrder - y.sortOrder)
    expect(order.map((p) => p.id)).toEqual(['c', 'a', 'b'])
  })
})

describe('reparentPage', () => {
  it('moves a page under another parent', () => {
    const pages: CourseNotebookPage[] = [
      { id: 'a', title: 'A', parentId: null, sortOrder: 0, contentMd: '' },
      { id: 'b', title: 'B', parentId: null, sortOrder: 1, contentMd: '' },
    ]
    const next = reparentPage(pages, 'b', 'a', 'a')
    expect(next).not.toBeNull()
    const b = next!.find((p) => p.id === 'b')
    expect(b?.parentId).toBe('a')
  })

  it('rejects nesting into own descendant', () => {
    const pages: CourseNotebookPage[] = [
      { id: 'a', title: 'A', parentId: null, sortOrder: 0, contentMd: '' },
      { id: 'b', title: 'B', parentId: 'a', sortOrder: 0, contentMd: '' },
    ]
    expect(reparentPage(pages, 'a', 'b', null)).toBeNull()
  })
})
