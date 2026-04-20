import type { SyllabusSection } from '../../lib/courses-api'

/** Joins syllabus-style sections into one Markdown document (same shape the syllabus viewer uses). */
export function sectionsToMarkdown(sections: SyllabusSection[]): string {
  return sections
    .map((s) => {
      const h = s.heading.trim()
      const body = s.markdown.replace(/\s+$/u, '')
      if (h) return `## ${h}\n\n${body}`
      return body
    })
    .filter((chunk) => chunk.trim().length > 0)
    .join('\n\n')
}

/**
 * Inverse of {@link sectionsToMarkdown} for loading a stored document into the block editor.
 * Best-effort: content that never used section headings stays a single block; ambiguous `##` in body can split.
 */
export function markdownToSectionsForEditor(markdown: string, newId: () => string): SyllabusSection[] {
  const trimmed = markdown.replace(/\s+$/u, '')
  if (!trimmed) return [{ id: newId(), heading: '', markdown: '' }]

  const parts = trimmed.split(/\n\n## /)
  const sections: SyllabusSection[] = []

  const parseFirst = (chunk: string): SyllabusSection => {
    if (chunk.startsWith('## ')) {
      const rest = chunk.slice(3)
      const sep = rest.indexOf('\n\n')
      if (sep === -1) {
        const lineEnd = rest.indexOf('\n')
        if (lineEnd === -1) {
          return { id: newId(), heading: rest.trim(), markdown: '' }
        }
        const heading = rest.slice(0, lineEnd).trim()
        const after = rest.slice(lineEnd + 1)
        return { id: newId(), heading, markdown: after.replace(/^\n/u, '').replace(/\s+$/u, '') }
      }
      return {
        id: newId(),
        heading: rest.slice(0, sep).trim(),
        markdown: rest.slice(sep + 2).replace(/\s+$/u, ''),
      }
    }
    return { id: newId(), heading: '', markdown: chunk }
  }

  sections.push(parseFirst(parts[0]!))

  for (let i = 1; i < parts.length; i++) {
    const chunk = parts[i]!
    const sep = chunk.indexOf('\n\n')
    if (sep === -1) {
      sections.push({ id: newId(), heading: chunk.trim(), markdown: '' })
    } else {
      sections.push({
        id: newId(),
        heading: chunk.slice(0, sep).trim(),
        markdown: chunk.slice(sep + 2).replace(/\s+$/u, ''),
      })
    }
  }

  return sections
}
