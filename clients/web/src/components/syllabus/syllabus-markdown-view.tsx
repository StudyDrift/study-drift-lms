import type { Components } from 'react-markdown'
import { forwardRef, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import 'katex/dist/katex.min.css'
import { CourseFileMarkdownImage } from './course-file-markdown-image'
import { normalizeMarkdownLists } from './normalize-markdown-lists'
import { remarkMergeAdjacentLists } from './remark-merge-adjacent-lists'
import type { SyllabusSection } from '../../lib/courses-api'
import type { ResolvedMarkdownTheme } from '../../lib/markdown-theme'
import { resolveMarkdownTheme } from '../../lib/markdown-theme'
import { useReducedData } from '../../context/reduced-data-context'
import { isMathRenderingEnabled } from '../../lib/math'
import { sectionsToMarkdown } from './syllabus-section-markdown'
import type { PluggableList } from 'unified'

const katexRehypePlugins: PluggableList = [
  [rehypeKatex, { output: 'htmlAndMathml', strict: 'ignore' }],
]

function mathPluginsFor(enabled: boolean) {
  return enabled && isMathRenderingEnabled()
    ? {
        remark: [remarkMath],
        rehype: katexRehypePlugins,
      }
    : { remark: [], rehype: [] as PluggableList }
}

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
function markdownLooksLikeMath(src: string): boolean {
  return /\$\$|\\\(|\\\[|\$[^$\s]/.test(src)
}

export const MarkdownArticleView = forwardRef<HTMLDivElement, MarkdownArticleViewProps>(
  function MarkdownArticleView(
    { markdown, emptyMessage = 'No content yet.', theme = defaultResolved, courseCode },
    ref,
  ) {
    const reducedData = useReducedData()
    const src = markdown.trim()
    const hasMath = useMemo(() => markdownLooksLikeMath(src), [src])
    const [userForcedMath, setUserForcedMath] = useState(false)
    const deferMath = reducedData && hasMath && !userForcedMath
    const mathPlugins = useMemo(() => mathPluginsFor(!deferMath), [deferMath])

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
        {deferMath ? (
          <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200">
            <span className="font-medium">Math formatting is paused</span> to save data.{' '}
            <button
              type="button"
              className="ml-2 font-semibold text-indigo-600 underline decoration-indigo-300 hover:text-indigo-500 dark:text-indigo-400"
              onClick={() => setUserForcedMath(true)}
            >
              Load math
            </button>
          </div>
        ) : null}
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkMergeAdjacentLists, ...mathPlugins.remark]}
          rehypePlugins={mathPlugins.rehype}
          components={components}
        >
          {normalized}
        </ReactMarkdown>
      </div>
    )
  },
)

export function SyllabusMarkdownView({ sections, theme = defaultResolved, courseCode }: SyllabusMarkdownViewProps) {
  const src = sectionsToMarkdown(sections)
  const reducedData = useReducedData()
  const hasMath = useMemo(() => markdownLooksLikeMath(src), [src])
  const [userForcedMath, setUserForcedMath] = useState(false)
  const deferMath = reducedData && hasMath && !userForcedMath
  const mathPlugins = useMemo(() => mathPluginsFor(!deferMath), [deferMath])

  if (!src.trim()) {
    return <p className="text-sm leading-relaxed text-slate-500">No syllabus content yet.</p>
  }
  const components = createMarkdownComponents(theme, { useCourseFileImages: Boolean(courseCode) })
  const normalized = normalizeMarkdownLists(src)
  return (
    <div className={`syllabus-md ${theme.classes.article}`}>
      {deferMath ? (
        <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200">
          <span className="font-medium">Math formatting is paused</span> to save data.{' '}
          <button
            type="button"
            className="ml-2 font-semibold text-indigo-600 underline decoration-indigo-300 hover:text-indigo-500 dark:text-indigo-400"
            onClick={() => setUserForcedMath(true)}
          >
            Load math
          </button>
        </div>
      ) : null}
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMergeAdjacentLists, ...mathPlugins.remark]}
        rehypePlugins={mathPlugins.rehype}
        components={components}
      >
        {normalized}
      </ReactMarkdown>
    </div>
  )
}
