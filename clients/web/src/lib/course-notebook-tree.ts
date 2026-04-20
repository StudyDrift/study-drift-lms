import { arrayMove } from '@dnd-kit/sortable'

export type CourseNotebookPage = {
  id: string
  title: string
  parentId: string | null
  sortOrder: number
  /** TipTap / MarkdownBodyEditor markdown */
  contentMd: string
}

export function newNotebookPageId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `nb-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function byId(pages: CourseNotebookPage[]): Map<string, CourseNotebookPage> {
  return new Map(pages.map((p) => [p.id, p]))
}

export function sortedChildren(pages: CourseNotebookPage[], parentId: string | null): CourseNotebookPage[] {
  return pages
    .filter((p) => p.parentId === parentId)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))
}

/** True if `targetId` is `ancestorId` or nested under it. */
export function isUnderAncestor(pages: CourseNotebookPage[], ancestorId: string, targetId: string): boolean {
  let cur: string | null = targetId
  const map = byId(pages)
  while (cur) {
    if (cur === ancestorId) return true
    cur = map.get(cur)?.parentId ?? null
  }
  return false
}

function renumberSiblings(pages: CourseNotebookPage[], parentId: string | null): CourseNotebookPage[] {
  const siblings = sortedChildren(pages, parentId)
  const order = new Map(siblings.map((p, i) => [p.id, i]))
  return pages.map((p) => {
    if (p.parentId !== parentId) return p
    const so = order.get(p.id)
    return so === undefined ? p : { ...p, sortOrder: so }
  })
}

export function reorderAmongSiblings(
  pages: CourseNotebookPage[],
  parentId: string | null,
  activeId: string,
  overId: string,
): CourseNotebookPage[] {
  const siblings = sortedChildren(pages, parentId)
  const ids = siblings.map((s) => s.id)
  const oldIndex = ids.indexOf(activeId)
  const newIndex = ids.indexOf(overId)
  if (oldIndex < 0 || newIndex < 0) return pages
  const nextIds = arrayMove(ids, oldIndex, newIndex)
  const order = new Map(nextIds.map((id, i) => [id, i]))
  return pages.map((p) => {
    if (p.parentId !== parentId) return p
    const so = order.get(p.id)
    return so === undefined ? p : { ...p, sortOrder: so }
  })
}

/**
 * Move `activeId` under `newParentId`, inserted before `beforeId` among new siblings (null = append).
 * Returns null if the move would create a cycle.
 */
export function reparentPage(
  pages: CourseNotebookPage[],
  activeId: string,
  newParentId: string | null,
  beforeId: string | null,
): CourseNotebookPage[] | null {
  if (activeId === newParentId) return null
  if (newParentId !== null && isUnderAncestor(pages, activeId, newParentId)) return null

  const active = pages.find((p) => p.id === activeId)
  if (!active) return null
  const oldParent = active.parentId

  let next = pages.map((p) =>
    p.id === activeId ? { ...p, parentId: newParentId, sortOrder: 999999 } : p,
  )
  next = renumberSiblings(next, oldParent)

  const siblings = sortedChildren(next, newParentId)
  const ids = siblings.map((s) => s.id)
  const from = ids.indexOf(activeId)
  if (from < 0) return null
  let to = beforeId === null ? ids.length - 1 : ids.indexOf(beforeId)
  if (to < 0) to = ids.length - 1
  const nextIds = arrayMove(ids, from, to)
  const order = new Map(nextIds.map((id, i) => [id, i]))
  next = next.map((p) => {
    if (p.parentId !== newParentId) return p
    const so = order.get(p.id)
    return so !== undefined ? { ...p, sortOrder: so } : p
  })
  return next
}

export function addNotebookPage(
  pages: CourseNotebookPage[],
  parentId: string | null,
  title = 'Untitled',
): { pages: CourseNotebookPage[]; newId: string } {
  const id = newNotebookPageId()
  const siblings = sortedChildren(pages, parentId)
  const maxOrder = siblings.length ? Math.max(...siblings.map((s) => s.sortOrder)) : -1
  const row: CourseNotebookPage = {
    id,
    title,
    parentId,
    sortOrder: maxOrder + 1,
    contentMd: '',
  }
  return { pages: [...pages, row], newId: id }
}

export function deleteNotebookPage(pages: CourseNotebookPage[], pageId: string): CourseNotebookPage[] {
  const toRemove = new Set<string>()
  function walk(id: string) {
    toRemove.add(id)
    for (const c of pages.filter((p) => p.parentId === id)) walk(c.id)
  }
  walk(pageId)
  const next = pages.filter((p) => !toRemove.has(p.id))
  const oldParent = pages.find((p) => p.id === pageId)?.parentId ?? null
  return renumberSiblings(next, oldParent)
}

export function updatePageTitle(pages: CourseNotebookPage[], pageId: string, title: string): CourseNotebookPage[] {
  return pages.map((p) => (p.id === pageId ? { ...p, title } : p))
}

export function updatePageContent(pages: CourseNotebookPage[], pageId: string, contentMd: string): CourseNotebookPage[] {
  return pages.map((p) => (p.id === pageId ? { ...p, contentMd } : p))
}
