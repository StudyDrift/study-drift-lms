import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { NotebookPen, Search, Sparkles, X } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { authorizedFetch } from '../../lib/api'
import { type Course } from '../../lib/coursesApi'
import { readApiErrorMessage } from '../../lib/errors'
import {
  listStudentCourseNotebooks,
  subscribeStudentNotebooks,
} from '../../lib/studentNotebookStorage'
import { LmsPage } from './LmsPage'

function snippet(text: string, max = 140): string {
  const t = text.replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  return `${t.slice(0, max - 1)}…`
}

type NotebookRagSource = {
  courseCode: string
  courseTitle: string
  excerpt: string
}

type NotebookRagResponse = {
  answerMarkdown: string
  sources: NotebookRagSource[]
}

export default function MyNotebooksPage() {
  const [courses, setCourses] = useState<Course[] | null>(null)
  const [coursesError, setCoursesError] = useState<string | null>(null)
  const [notebookVersion, setNotebookVersion] = useState(0)
  const [searchQuery, setSearchQuery] = useState('')
  const [askText, setAskText] = useState('')
  const [askLoading, setAskLoading] = useState(false)
  const [askError, setAskError] = useState<string | null>(null)
  const [ragResult, setRagResult] = useState<NotebookRagResponse | null>(null)
  const [askCardOpen, setAskCardOpen] = useState(false)
  const askTextareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (askCardOpen) {
      askTextareaRef.current?.focus()
    }
  }, [askCardOpen])

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
        const data = raw as { courses?: Course[] }
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
  }, [titleByCode, courses, notebookVersion])

  const filteredEntries = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return entries
    return entries.filter(
      (e) =>
        e.courseTitle.toLowerCase().includes(q) ||
        e.courseCode.toLowerCase().includes(q) ||
        e.body.toLowerCase().includes(q),
    )
  }, [entries, searchQuery])

  const hasNotes = entries.length > 0
  const coursesReady = courses !== null

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
      title="My Notebooks"
      description="Your private notes from each course, on this device."
    >
      {coursesError && (
        <p className="mt-6 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/50 dark:text-rose-200">
          {coursesError}
        </p>
      )}

      {courses === null && !coursesError && (
        <p className="mt-8 text-sm text-slate-500 dark:text-neutral-400">Loading…</p>
      )}

      {coursesReady && (
        <div className="mt-6 max-w-4xl space-y-5">
          <div>
            <label htmlFor="notebook-search" className="sr-only">
              Search my notes
            </label>
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-neutral-500"
                aria-hidden
              />
              <input
                id="notebook-search"
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search my notes…"
                autoComplete="off"
                className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-3 text-sm text-slate-900 shadow-sm outline-none ring-indigo-500/0 transition placeholder:text-slate-400 focus:border-indigo-300 focus:ring-4 focus:ring-indigo-500/15 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100 dark:placeholder:text-neutral-500 dark:focus:border-indigo-500/50"
              />
            </div>
          </div>

          {!askCardOpen ? (
            <button
              type="button"
              onClick={() => setAskCardOpen(true)}
              aria-expanded={false}
              className="flex w-full items-start gap-3 rounded-2xl border border-indigo-200/90 bg-gradient-to-b from-indigo-50/80 to-white p-4 text-left shadow-sm transition hover:border-indigo-300 hover:shadow-md dark:border-indigo-500/25 dark:from-indigo-950/40 dark:to-neutral-950 dark:hover:border-indigo-400/40 sm:p-5"
            >
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-100 text-indigo-700 dark:bg-indigo-900/60 dark:text-indigo-200">
                <Sparkles className="h-4 w-4" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-slate-900 dark:text-neutral-100">
                  Ask my notes anything
                </span>
                <span className="mt-0.5 block text-xs text-slate-500 dark:text-neutral-400">
                  We find the most relevant passages across your notebooks, then answer with AI using
                  only those excerpts.
                </span>
              </span>
            </button>
          ) : (
            <div className="rounded-2xl border border-indigo-200/90 bg-gradient-to-b from-indigo-50/80 to-white p-4 shadow-sm dark:border-indigo-500/25 dark:from-indigo-950/40 dark:to-neutral-950 sm:p-5">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-100 text-indigo-700 dark:bg-indigo-900/60 dark:text-indigo-200">
                  <Sparkles className="h-4 w-4" aria-hidden />
                </span>
                <div className="min-w-0 flex-1 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900 dark:text-neutral-100">
                        Ask my notes anything
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500 dark:text-neutral-400">
                        We find the most relevant passages across your notebooks, then answer with AI
                        using only those excerpts.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setAskCardOpen(false)}
                      aria-label="Close ask panel"
                      className="-mr-1 -mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
                    >
                      <X className="h-4 w-4" aria-hidden />
                    </button>
                  </div>
                  <textarea
                    ref={askTextareaRef}
                    value={askText}
                    onChange={(e) => setAskText(e.target.value)}
                    rows={2}
                    disabled={!hasNotes || askLoading}
                    placeholder={
                      hasNotes
                        ? 'e.g. What themes did I write about in my literature course?'
                        : 'Save notes in a course notebook to use this.'
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
                    <span className="text-xs text-slate-500 dark:text-neutral-500">
                      {hasNotes ? '⌘↵ or Ctrl+↵ to submit' : ''}
                    </span>
                  </div>
                  {askError && (
                    <p className="rounded-lg border border-rose-200 bg-rose-50/80 px-3 py-2 text-xs text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-200">
                      {askError}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

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

      {courses !== null && entries.length === 0 && (
        <p className="mt-8 max-w-xl text-sm text-slate-600 dark:text-neutral-300">
          You do not have any saved notes yet. Open a course and use{' '}
          <span className="font-medium text-slate-800 dark:text-neutral-100">Notebook</span> in the
          course menu to write thoughts while you learn.
        </p>
      )}

      {courses !== null && hasNotes && filteredEntries.length === 0 && (
        <p className="mt-8 text-sm text-slate-600 dark:text-neutral-300">
          No notebooks match your search.
        </p>
      )}

      {filteredEntries.length > 0 && (
        <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredEntries.map((e) => (
            <li key={e.courseCode}>
              <Link
                to={`/courses/${encodeURIComponent(e.courseCode)}/notebook`}
                className="flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-indigo-200 hover:shadow-md dark:border-neutral-700 dark:bg-neutral-950 dark:hover:border-indigo-500/40"
              >
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-700 dark:bg-indigo-950/80 dark:text-indigo-200">
                    <NotebookPen className="h-5 w-5" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-slate-900 dark:text-neutral-100">
                      {e.courseTitle}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-neutral-400">
                      {e.courseCode} ·{' '}
                      {new Date(e.updatedAt).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </p>
                  </div>
                </div>
                <p className="mt-3 line-clamp-4 text-sm leading-relaxed text-slate-600 dark:text-neutral-300">
                  {snippet(e.body)}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </LmsPage>
  )
}
