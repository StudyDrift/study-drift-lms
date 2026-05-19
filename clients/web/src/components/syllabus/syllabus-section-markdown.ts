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
  const trimmed = markdown.trim()
  if (!trimmed) return [{ id: newId(), heading: '', markdown: '' }]

  // Split by "## " at the start of a line, or double newline followed by "## "
  // We want to be inclusive of how users might paste content.
  // The split pattern looks for headers that would define a new section.
  const parts = trimmed.split(/\n+(?=## )/g)
  
  const sections: SyllabusSection[] = []

  for (const part of parts) {
    const chunk = part.trim()
    if (!chunk) continue

    if (chunk.startsWith('## ')) {
      // Find the end of the heading line
      const firstNewline = chunk.indexOf('\n')
      if (firstNewline === -1) {
        // Only a heading, no body
        sections.push({
          id: newId(),
          heading: chunk.slice(3).trim(),
          markdown: '',
        })
      } else {
        sections.push({
          id: newId(),
          heading: chunk.slice(3, firstNewline).trim(),
          markdown: chunk.slice(firstNewline + 1).trim(),
        })
      }
    } else {
      // Body content without a leading heading
      sections.push({
        id: newId(),
        heading: '',
        markdown: chunk,
      })
    }
  }

  return sections.length > 0 ? sections : [{ id: newId(), heading: '', markdown: '' }]
}
