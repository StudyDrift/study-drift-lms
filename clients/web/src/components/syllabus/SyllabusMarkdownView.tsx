import type { Components } from 'react-markdown'
import { forwardRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { CourseFileMarkdownImage } from './CourseFileMarkdownImage'
import { normalizeMarkdownLists } from './normalizeMarkdownLists'
import { remarkMergeAdjacentLists } from './remarkMergeAdjacentLists'
import type { SyllabusSection } from '../../lib/coursesApi'
import type { ResolvedMarkdownTheme } from '../../lib/markdownTheme'
import { resolveMarkdownTheme } from '../../lib/markdownTheme'
import { sectionsToMarkdown } from './syllabusSectionMarkdown'

function createMarkdownComponents(
  theme: ResolvedMarkdownTheme,
  opts?: { useCourseFileImages?: boolean },
): Components {
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
    img: ({ src, alt }) =>
      opts?.useCourseFileImages ? (
        <CourseFileMarkdownImage
          src={src}
          alt={alt}
          className="max-h-[min(28rem,80vh)] w-auto max-w-full rounded-lg border border-slate-200 dark:border-neutral-700"
        />
      ) : (
        <img
          src={src ?? undefined}
          alt={alt ?? ''}
          className="max-h-[min(28rem,80vh)] w-auto max-w-full rounded-lg border border-slate-200 dark:border-neutral-700"
          loading="lazy"
        />
      ),
  }
}

const defaultResolved = resolveMarkdownTheme('classic', null)

type SyllabusMarkdownViewProps = {
  sections: SyllabusSection[]
  /** From GET course: `markdownThemePreset` + `markdownThemeCustom` */
  theme?: ResolvedMarkdownTheme
  courseCode?: string
}

type MarkdownArticleViewProps = {
  markdown: string
  emptyMessage?: string
  theme?: ResolvedMarkdownTheme
  /** When set, images under `/api/v1/.../course-files/.../content` load with the signed-in session. */
  courseCode?: string
}

/** Renders a single Markdown document with the same styling as the syllabus. */
export const MarkdownArticleView = forwardRef<HTMLDivElement, MarkdownArticleViewProps>(
  function MarkdownArticleView(
    { markdown, emptyMessage = 'No content yet.', theme = defaultResolved, courseCode },
    ref,
  ) {
    const src = markdown.trim()
    if (!src) {
      return (
        <div ref={ref} className={`syllabus-md ${theme.classes.article}`}>
          <p className="text-sm leading-relaxed text-slate-500">{emptyMessage}</p>
        </div>
      )
    }
    const components = createMarkdownComponents(theme, { useCourseFileImages: Boolean(courseCode) })
    const normalized = normalizeMarkdownLists(markdown)
    return (
      <div ref={ref} className={`syllabus-md ${theme.classes.article}`}>
        <ReactMarkdown remarkPlugins={[remarkGfm, remarkMergeAdjacentLists]} components={components}>
          {normalized}
        </ReactMarkdown>
      </div>
    )
  },
)

export function SyllabusMarkdownView({ sections, theme = defaultResolved, courseCode }: SyllabusMarkdownViewProps) {
  const src = sectionsToMarkdown(sections)
  if (!src.trim()) {
    return <p className="text-sm leading-relaxed text-slate-500">No syllabus content yet.</p>
  }
  const components = createMarkdownComponents(theme, { useCourseFileImages: Boolean(courseCode) })
  const normalized = normalizeMarkdownLists(src)
  return (
    <div className={`syllabus-md ${theme.classes.article}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMergeAdjacentLists]} components={components}>
        {normalized}
      </ReactMarkdown>
    </div>
  )
}
