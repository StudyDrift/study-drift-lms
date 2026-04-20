import type { CourseStructureItem } from '../lib/courses-api'

export type MentionState = {
  start: number
  query: string
}

/** @mention in serialized prompt (after whitespace or start; query has no spaces). */
export function getMentionState(text: string, caret: number): MentionState | null {
  const before = text.slice(0, caret)
  const at = before.lastIndexOf('@')
  if (at < 0) return null
  if (at > 0 && !/\s/.test(before[at - 1]!)) return null
  const afterAt = before.slice(at + 1)
  if (afterAt.includes('\n') || afterAt.includes(' ')) return null
  return { start: at, query: afterAt }
}

export function kindLabel(kind: CourseStructureItem['kind']): string {
  if (kind === 'content_page') return 'Content page'
  if (kind === 'assignment') return 'Assignment'
  return kind
}

export function filterTaggable(items: CourseStructureItem[], query: string): CourseStructureItem[] {
  const taggable = items.filter((i) => i.kind === 'content_page' || i.kind === 'assignment')
  const q = query.trim().toLowerCase()
  if (!q) return taggable
  return taggable.filter((i) => {
    const title = i.title.toLowerCase()
    const kl = kindLabel(i.kind).toLowerCase()
    return title.includes(q) || kl.includes(q) || (q === 'content' && i.kind === 'content_page')
  })
}
