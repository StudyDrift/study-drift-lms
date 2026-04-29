import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Sparkles } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ReadingFocusToggle } from '../../components/layout/reading-focus-toggle'
import { authorizedFetch } from '../../lib/api'
import { type CoursePublic } from '../../lib/courses-api'
import { readApiErrorMessage } from '../../lib/errors'
import {
  listStudentCourseNotebooks,
  subscribeStudentNotebooks,
} from '../../lib/student-notebook-storage'
import { LmsPage } from './lms-page'

type NotebookRagSource = {
  courseCode: string
  courseTitle: string
  excerpt: string
}

type NotebookRagResponse = {
  answerMarkdown: string
  sources: NotebookRagSource[]
}

export default function AskAiPage() {
  const [searchParams] = useSearchParams()
  const qParam = searchParams.get('q')?.trim() ?? ''

  const [courses, setCourses] = useState<CoursePublic[] | null>(null)
  const [coursesError, setCoursesError] = useState<string | null>(null)
  const [notebookVersion, setNotebookVersion] = useState(0)
  const [askText, setAskText] = useState(qParam)
  const [askLoading, setAskLoading] = useState(false)
  const [askError, setAskError] = useState<string | null>(null)
  const [ragResult, setRagResult] = useState<NotebookRagResponse | null>(null)
  const askTextareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (qParam) setAskText(qParam)
  }, [qParam])

  useEffect(() => {
    const t = window.setTimeout(() => askTextareaRef.current?.focus(), 0)
    return () => window.clearTimeout(t)
  }, [])

  const refreshNotebooks = useCallback(() => {
    setNotebookVersion((n) => n + 1)
  }, [])

  useEffect(() => {
    return subscribeStudentNotebooks(refreshNotebooks)
  }, [refreshNotebooks])

  useEffect(() => {
    let cancelled = false
    setCoursesError(null)
    void (async () => {
      try {
        const res = await authorizedFetch('/api/v1/courses')
        const raw: unknown = await res.json().catch(() => ({}))
        if (!res.ok) {
          if (!cancelled) {
            setCourses([])
            setCoursesError(readApiErrorMessage(raw))
          }
          return
        }
        const data = raw as { courses?: CoursePublic[] }
        if (!cancelled) setCourses(data.courses ?? [])
      } catch {
        if (!cancelled) {
          setCourses([])
          setCoursesError('Could not load courses.')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const titleByCode = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of courses ?? []) {
      m.set(c.courseCode, c.title)
    }
    return m
  }, [courses])

  const entries = useMemo(() => {
    void notebookVersion
    const stored = listStudentCourseNotebooks()
    const rows = Object.entries(stored)
      .map(([courseCode, row]) => ({
        courseCode,
        body: row.body,
        updatedAt: row.updatedAt,
        courseTitle: row.courseTitle ?? titleByCode.get(courseCode) ?? courseCode,
      }))
      .filter((r) => r.body.trim().length > 0)
    rows.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    return rows
  }, [titleByCode, notebookVersion])

  const hasNotes = entries.length > 0

  const submitAsk = useCallback(async () => {
    const q = askText.trim()
    if (!q || !hasNotes) return
    setAskLoading(true)
    setAskError(null)
    setRagResult(null)
    try {
      const res = await authorizedFetch('/api/v1/me/notebooks/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: q,
          notebooks: entries.map((e) => ({
            courseCode: e.courseCode,
            courseTitle: e.courseTitle,
            markdown: e.body,
          })),
        }),
      })
      const raw: unknown = await res.json().catch(() => ({}))
      if (!res.ok) {
        setAskError(readApiErrorMessage(raw))
        return
      }
      const data = raw as NotebookRagResponse
      if (typeof data.answerMarkdown !== 'string') {
        setAskError('Unexpected response from the server.')
        return
      }
      setRagResult({
        answerMarkdown: data.answerMarkdown,
        sources: Array.isArray(data.sources) ? data.sources : [],
      })
    } catch {
      setAskError('Could not reach the server.')
    } finally {
      setAskLoading(false)
    }
  }, [askText, entries, hasNotes])

  return (
    <LmsPage
      title="Ask AI"
      description="Ask questions grounded in your saved course notebooks on this device. Answers use only excerpts the model retrieves from your notes."
      actions={<ReadingFocusToggle />}
    >
      {coursesError && (
        <p className="mt-6 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/50 dark:text-rose-200">
          {coursesError}
        </p>
      )}

      {courses === null && !coursesError && (
        <p className="mt-8 text-sm text-slate-500 dark:text-neutral-400">Loading…</p>
      )}

      {courses !== null && (
        <div className="mt-6 max-w-[72ch] space-y-5 text-[1.0625rem] leading-relaxed">
          <div className="rounded-2xl border border-indigo-200/90 bg-gradient-to-b from-indigo-50/80 to-white p-4 shadow-sm dark:border-indigo-500/25 dark:from-indigo-950/40 dark:to-neutral-950 sm:p-5">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-100 text-indigo-700 dark:bg-indigo-900/60 dark:text-indigo-200">
                <Sparkles className="h-4 w-4" aria-hidden />
              </span>
              <div className="min-w-0 flex-1 space-y-3">
                <div>
                  <label htmlFor="ask-ai-prompt" className="text-sm font-medium text-slate-900 dark:text-neutral-100">
                    Your question
                  </label>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-neutral-400">
                    We search your notebooks for relevant passages, then the model answers using only those excerpts.
                  </p>
                </div>
                <textarea
                  ref={askTextareaRef}
                  id="ask-ai-prompt"
                  value={askText}
                  onChange={(e) => setAskText(e.target.value)}
                  rows={4}
                  disabled={!hasNotes || askLoading}
                  placeholder={
                    hasNotes
                      ? 'e.g. What themes did I write about across my courses?'
                      : 'Save notes in a course notebook first — then you can ask here.'
                  }
                  className="w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none ring-indigo-500/0 transition focus:border-indigo-300 focus:ring-4 focus:ring-indigo-500/15 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100 dark:focus:border-indigo-500/50 dark:disabled:bg-neutral-900 dark:disabled:text-neutral-500"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault()
                      void submitAsk()
                    }
                  }}
                />
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => void submitAsk()}
                    disabled={!hasNotes || askLoading || !askText.trim()}
                    className="inline-flex items-center justify-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-700 disabled:pointer-events-none disabled:opacity-50 dark:bg-indigo-500 dark:hover:bg-indigo-400"
                  >
                    {askLoading ? 'Thinking…' : 'Ask'}
                  </button>
                  {hasNotes ? (
                    <span className="text-xs text-slate-500 dark:text-neutral-500">⌘↵ or Ctrl+↵ to submit</span>
                  ) : (
                    <Link
                      to="/notebooks"
                      className="text-xs font-medium text-indigo-700 hover:underline dark:text-indigo-300"
                    >
                      Open My Notebooks
                    </Link>
                  )}
                </div>
                {askError && (
                  <p className="rounded-lg border border-rose-200 bg-rose-50/80 px-3 py-2 text-xs text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-200">
                    {askError}
                  </p>
                )}
              </div>
            </div>
          </div>

          {ragResult && (
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-neutral-700 dark:bg-neutral-950 sm:p-5">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-neutral-100">Answer</h2>
              <article className="mt-3 text-sm leading-relaxed text-slate-700 dark:text-neutral-200 [&_a]:text-indigo-600 [&_a]:underline dark:[&_a]:text-indigo-400 [&_li]:my-0.5 [&_ol]:my-2 [&_p]:my-2 [&_ul]:my-2">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{ragResult.answerMarkdown}</ReactMarkdown>
              </article>
              {ragResult.sources.length > 0 && (
                <div className="mt-5 border-t border-slate-100 pt-4 dark:border-neutral-800">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-neutral-400">
                    Sources used
                  </h3>
                  <ul className="mt-2 space-y-2">
                    {ragResult.sources.map((s, i) => (
                      <li key={`${s.courseCode}-${i}`} className="text-xs text-slate-600 dark:text-neutral-300">
                        <Link
                          to={`/courses/${encodeURIComponent(s.courseCode)}/notebook`}
                          className="font-medium text-indigo-700 hover:underline dark:text-indigo-300"
                        >
                          {s.courseTitle}
                        </Link>
                        <span className="text-slate-400 dark:text-neutral-500"> · {s.courseCode}</span>
                        <p className="mt-0.5 text-slate-500 dark:text-neutral-400">{s.excerpt}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </LmsPage>
  )
}
