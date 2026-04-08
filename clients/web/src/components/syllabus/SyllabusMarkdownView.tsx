import type { Components } from 'react-markdown'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { normalizeMarkdownLists } from './normalizeMarkdownLists'
import { remarkMergeAdjacentLists } from './remarkMergeAdjacentLists'
import type { SyllabusSection } from '../../lib/coursesApi'
import type { ResolvedMarkdownTheme } from '../../lib/markdownTheme'
import { resolveMarkdownTheme } from '../../lib/markdownTheme'

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

function createMarkdownComponents(theme: ResolvedMarkdownTheme): Components {
  const o = theme.styleOverrides
  const c = theme.classes
  return {
    h1: ({ children }) => (
      <h1 className={c.h1} style={o.h1}>
        {children}
      </h1>
    ),
    h2: ({ children }) => (
      <h2 className={c.h2} style={o.h2}>
        {children}
      </h2>
    ),
    h3: ({ children }) => (
      <h3 className={c.h3} style={o.h3}>
        {children}
      </h3>
    ),
    p: ({ children }) => (
      <p className={c.p} style={o.p}>
        {children}
      </p>
    ),
    ul: ({ children }) => (
      <ul className={c.ul} style={o.ul}>
        {children}
      </ul>
    ),
    ol: ({ children }) => (
      <ol className={c.ol} style={o.ol}>
        {children}
      </ol>
    ),
    li: ({ children }) => (
      <li className={c.li} style={o.li}>
        {children}
      </li>
    ),
    a: ({ children, href }) => (
      <a
        href={href}
        className={c.a}
        style={o.a}
        target="_blank"
        rel="noreferrer noopener"
      >
        {children}
      </a>
    ),
    blockquote: ({ children }) => (
      <blockquote className={c.blockquote} style={o.blockquote}>
        {children}
      </blockquote>
    ),
    code: ({ className, children }) => {
      const inline = !className
      if (inline) {
        return (
          <code className={c.codeInline} style={o.codeInline}>
            {children}
          </code>
        )
      }
      return <code className={className}>{children}</code>
    },
    pre: ({ children }) => (
      <pre className={c.pre} style={o.pre}>
        {children}
      </pre>
    ),
    table: ({ children }) => (
      <div className={c.tableWrap}>
        <table className={c.table} style={o.table}>
          {children}
        </table>
      </div>
    ),
    thead: ({ children }) => (
      <thead className={c.thead} style={o.thead}>
        {children}
      </thead>
    ),
    th: ({ children }) => (
      <th className={c.th} style={o.th}>
        {children}
      </th>
    ),
    td: ({ children }) => (
      <td className={c.td} style={o.td}>
        {children}
      </td>
    ),
    hr: () => <hr className={c.hr} style={o.hr} />,
  }
}

const defaultResolved = resolveMarkdownTheme('classic', null)

type SyllabusMarkdownViewProps = {
  sections: SyllabusSection[]
  /** From GET course: `markdownThemePreset` + `markdownThemeCustom` */
  theme?: ResolvedMarkdownTheme
}

type MarkdownArticleViewProps = {
  markdown: string
  emptyMessage?: string
  theme?: ResolvedMarkdownTheme
}

/** Renders a single Markdown document with the same styling as the syllabus. */
export function MarkdownArticleView({
  markdown,
  emptyMessage = 'No content yet.',
  theme = defaultResolved,
}: MarkdownArticleViewProps) {
  const src = markdown.trim()
  if (!src) {
    return <p className="text-sm leading-relaxed text-slate-500">{emptyMessage}</p>
  }
  const components = createMarkdownComponents(theme)
  const normalized = normalizeMarkdownLists(markdown)
  return (
    <div className={`syllabus-md ${theme.classes.article}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMergeAdjacentLists]} components={components}>
        {normalized}
      </ReactMarkdown>
    </div>
  )
}

export function SyllabusMarkdownView({ sections, theme = defaultResolved }: SyllabusMarkdownViewProps) {
  const src = sectionsToMarkdown(sections)
  if (!src.trim()) {
    return <p className="text-sm leading-relaxed text-slate-500">No syllabus content yet.</p>
  }
  const components = createMarkdownComponents(theme)
  const normalized = normalizeMarkdownLists(src)
  return (
    <div className={`syllabus-md ${theme.classes.article}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMergeAdjacentLists]} components={components}>
        {normalized}
      </ReactMarkdown>
    </div>
  )
}
