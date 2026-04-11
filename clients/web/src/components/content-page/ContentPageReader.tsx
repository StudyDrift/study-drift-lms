import Mark from 'mark.js'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Highlighter, StickyNote, Trash2, X } from 'lucide-react'
import { MarkdownArticleView } from '../syllabus/SyllabusMarkdownView'
import type { ContentPageMarkup } from '../../lib/coursesApi'
import {
  deleteContentPageMarkup,
  postContentPageMarkup,
} from '../../lib/coursesApi'
import { sortedChildren, type CourseNotebookPage } from '../../lib/courseNotebookTree'
import { appendContentQuoteToNotebookPage, loadCourseNotebook } from '../../lib/studentNotebookStorage'
import type { ResolvedMarkdownTheme } from '../../lib/markdownTheme'

function flattenNotebookPages(pages: CourseNotebookPage[]): { id: string; label: string }[] {
  const out: { id: string; label: string }[] = []
  function walk(parentId: string | null, depth: number) {
    for (const p of sortedChildren(pages, parentId)) {
      const pad = depth > 0 ? `${'· '.repeat(depth)}` : ''
      out.push({ id: p.id, label: `${pad}${p.title || 'Untitled'}` })
      walk(p.id, depth + 1)
    }
  }
  walk(null, 0)
  return out
}

type ReaderToolbar =
  | { kind: 'selection'; x: number; y: number; text: string }
  | { kind: 'highlight'; x: number; y: number; markupId: string; quoteText: string }

type ContentPageReaderProps = {
  markdown: string
  theme: ResolvedMarkdownTheme
  markups: ContentPageMarkup[]
  onMarkupsChange: () => void | Promise<void>
  courseCode: string
  itemId: string
  contentTitle: string
  disabled?: boolean
}

export function ContentPageReader({
  markdown,
  theme,
  markups,
  onMarkupsChange,
  courseCode,
  itemId,
  contentTitle,
  disabled = false,
}: ContentPageReaderProps) {
  const articleRef = useRef<HTMLDivElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const [popover, setPopover] = useState<ReaderToolbar | null>(null)
  const [noteModal, setNoteModal] = useState(false)
  const [pendingQuote, setPendingQuote] = useState<string | null>(null)
  const [notePageId, setNotePageId] = useState('')
  const [noteComment, setNoteComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const highlightMarkups = useMemo(
    () => markups.filter((m) => m.kind === 'highlight'),
    [markups],
  )

  useLayoutEffect(() => {
    const root = articleRef.current
    if (!root || disabled) return
    const mk = new Mark(root)
    mk.unmark({
      done: () => {
        for (const m of highlightMarkups) {
          const quote = m.quoteText
          if (!quote.trim()) continue
          mk.mark(quote, {
            className:
              'content-page-user-highlight cursor-pointer rounded-sm bg-amber-200/90 px-0.5 text-inherit dark:bg-amber-500/35',
            acrossElements: true,
            separateWordSearch: false,
            diacritics: true,
            accuracy: 'partially',
            each: (el) => {
              el.setAttribute('data-markup-id', m.id)
            },
          })
        }
      },
    })
    return () => {
      mk.unmark()
    }
  }, [markdown, highlightMarkups, disabled])

  const closePopover = useCallback(() => setPopover(null), [])

  useEffect(() => {
    if (!popover && !noteModal) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setPopover(null)
        setNoteModal(false)
        setPendingQuote(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [popover, noteModal])

  useEffect(() => {
    if (!popover) return
    function onDocMouseDown(e: MouseEvent) {
      if (popoverRef.current?.contains(e.target as Node)) return
      setPopover(null)
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [popover])

  useEffect(() => {
    if (disabled) return
    function onMouseUp(e: MouseEvent) {
      // Clicking toolbar buttons collapses the selection on mousedown; the subsequent mouseup
      // would otherwise clear the popover before the button's click handler runs.
      const t = e.target
      if (t instanceof Node && popoverRef.current?.contains(t)) {
        return
      }
      const sel = window.getSelection()
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
        setPopover(null)
        return
      }
      const root = articleRef.current
      if (!root) return
      const text = sel.toString().trim()
      if (text.length < 2) {
        setPopover(null)
        return
      }
      const a = sel.anchorNode
      const f = sel.focusNode
      if (!a || !f || !root.contains(a) || !root.contains(f)) {
        setPopover(null)
        return
      }
      const range = sel.getRangeAt(0)
      const rect = range.getBoundingClientRect()
      setPopover({
        kind: 'selection',
        x: rect.left + rect.width / 2,
        y: rect.bottom + 6,
        text,
      })
    }
    document.addEventListener('mouseup', onMouseUp)
    return () => document.removeEventListener('mouseup', onMouseUp)
  }, [disabled])

  useEffect(() => {
    if (disabled) return
    function onArticleClick(e: MouseEvent) {
      const root = articleRef.current
      if (!root) return
      const target = e.target
      if (!(target instanceof HTMLElement)) return
      if (popoverRef.current?.contains(target)) return
      if (target.closest('a[href]')) return

      const sel = window.getSelection()
      if (sel && !sel.isCollapsed) return

      const markEl = target.closest('[data-markup-id]')
      if (!markEl || !(markEl instanceof HTMLElement)) return
      if (!root.contains(markEl)) return

      const markupId = markEl.getAttribute('data-markup-id')
      if (!markupId) return
      const m = markups.find((x) => x.id === markupId && x.kind === 'highlight')
      if (!m) return

      const rect = markEl.getBoundingClientRect()
      e.stopPropagation()
      setPopover({
        kind: 'highlight',
        x: rect.left + rect.width / 2,
        y: rect.bottom + 6,
        markupId: m.id,
        quoteText: m.quoteText,
      })
    }
    const root = articleRef.current
    if (!root) return
    root.addEventListener('click', onArticleClick)
    return () => root.removeEventListener('click', onArticleClick)
  }, [disabled, markups])

  const refresh = useCallback(async () => {
    await onMarkupsChange()
  }, [onMarkupsChange])

  const onHighlight = useCallback(async () => {
    if (!popover || popover.kind !== 'selection') return
    setBusy(true)
    setError(null)
    try {
      await postContentPageMarkup(courseCode, itemId, {
        kind: 'highlight',
        quoteText: popover.text,
      })
      window.getSelection()?.removeAllRanges()
      setPopover(null)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save highlight.')
    } finally {
      setBusy(false)
    }
  }, [courseCode, itemId, popover, refresh])

  const openNoteWithQuote = useCallback(
    (quote: string) => {
      setError(null)
      setPendingQuote(quote)
      setPopover(null)
      window.getSelection()?.removeAllRanges()
      setNoteModal(true)
      setNoteComment('')
      const opts = flattenNotebookPages(loadCourseNotebook(courseCode).pages)
      setNotePageId(opts[0]?.id ?? '')
    },
    [courseCode],
  )

  const openNoteModal = useCallback(() => {
    if (!popover || popover.kind !== 'selection') return
    openNoteWithQuote(popover.text)
  }, [popover, openNoteWithQuote])

  const openNoteFromHighlightToolbar = useCallback(() => {
    if (!popover || popover.kind !== 'highlight') return
    openNoteWithQuote(popover.quoteText)
  }, [popover, openNoteWithQuote])

  const removeCurrentHighlight = useCallback(async () => {
    if (!popover || popover.kind !== 'highlight') return
    const id = popover.markupId
    setPopover(null)
    setBusy(true)
    setError(null)
    try {
      await deleteContentPageMarkup(courseCode, itemId, id)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove highlight.')
    } finally {
      setBusy(false)
    }
  }, [courseCode, itemId, popover, refresh])

  const notebookOptions = useMemo(
    () => flattenNotebookPages(loadCourseNotebook(courseCode).pages),
    [courseCode],
  )

  const saveNote = useCallback(async () => {
    const quote = pendingQuote?.trim()
    if (!quote || !notePageId) return
    setBusy(true)
    setError(null)
    try {
      appendContentQuoteToNotebookPage(courseCode, notePageId, {
        sourcePageTitle: contentTitle,
        quoteText: quote,
        userNote: noteComment,
      })
      await postContentPageMarkup(courseCode, itemId, {
        kind: 'note',
        quoteText: quote,
        notebookPageId: notePageId,
        commentText: noteComment.trim() || null,
      })
      setNoteModal(false)
      setPendingQuote(null)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save note.')
    } finally {
      setBusy(false)
    }
  }, [courseCode, contentTitle, itemId, noteComment, notePageId, pendingQuote, refresh])

  const onDeleteMarkup = useCallback(
    async (id: string) => {
      setBusy(true)
      setError(null)
      try {
        await deleteContentPageMarkup(courseCode, itemId, id)
        await refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not remove.')
      } finally {
        setBusy(false)
      }
    },
    [courseCode, itemId, refresh],
  )

  return (
    <div className="relative">
      <MarkdownArticleView ref={articleRef} markdown={markdown} theme={theme} courseCode={courseCode} />

      {error && (
        <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-200">
          {error}
        </p>
      )}

      {popover && !disabled && (
        <div
          ref={popoverRef}
          className="fixed z-[60] flex -translate-x-1/2 flex-col gap-1 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
          style={{ left: popover.x, top: popover.y }}
          role="dialog"
          aria-label={popover.kind === 'selection' ? 'Selection actions' : 'Highlight actions'}
        >
          <div className="flex gap-1">
            {popover.kind === 'selection' ? (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void onHighlight()}
                  className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-amber-900 transition hover:bg-amber-50 disabled:opacity-50 dark:text-amber-100 dark:hover:bg-amber-950/50"
                >
                  <Highlighter className="h-3.5 w-3.5" aria-hidden />
                  Highlight
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={openNoteModal}
                  className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-indigo-800 transition hover:bg-indigo-50 disabled:opacity-50 dark:text-indigo-200 dark:hover:bg-indigo-950/40"
                >
                  <StickyNote className="h-3.5 w-3.5" aria-hidden />
                  Add note
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={openNoteFromHighlightToolbar}
                  className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-indigo-800 transition hover:bg-indigo-50 disabled:opacity-50 dark:text-indigo-200 dark:hover:bg-indigo-950/40"
                >
                  <StickyNote className="h-3.5 w-3.5" aria-hidden />
                  Add note
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void removeCurrentHighlight()}
                  className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-rose-800 transition hover:bg-rose-50 disabled:opacity-50 dark:text-rose-200 dark:hover:bg-rose-950/40"
                  aria-label="Remove highlight"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                </button>
              </>
            )}
            <button
              type="button"
              onClick={closePopover}
              className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-neutral-800"
              aria-label="Dismiss"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {noteModal && pendingQuote && !disabled && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/40 p-4 dark:bg-black/50"
          role="presentation"
          onClick={() => {
            if (!busy) {
              setNoteModal(false)
              setPendingQuote(null)
            }
          }}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-xl dark:border-neutral-700 dark:bg-neutral-900"
            role="dialog"
            aria-modal="true"
            aria-labelledby="content-note-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="content-note-modal-title" className="text-lg font-semibold text-slate-900 dark:text-neutral-100">
              Add to notebook
            </h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-neutral-400">
              The selection is appended as a blockquote under the page you pick.
            </p>
            {notebookOptions.length === 0 ? (
              <p className="mt-4 text-sm text-slate-600 dark:text-neutral-300">
                You do not have any notebook pages yet. Open{' '}
                <span className="font-medium">Notebook</span> in the course menu and add a page first.
              </p>
            ) : (
              <>
                <label className="mt-4 block text-sm font-medium text-slate-800 dark:text-neutral-200" htmlFor="nb-page">
                  Notebook page
                </label>
                <select
                  id="nb-page"
                  className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-neutral-600 dark:bg-neutral-950 dark:text-neutral-100"
                  value={notePageId}
                  onChange={(e) => setNotePageId(e.target.value)}
                >
                  {notebookOptions.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <label className="mt-3 block text-sm font-medium text-slate-800 dark:text-neutral-200" htmlFor="nb-comment">
                  Your note (optional)
                </label>
                <textarea
                  id="nb-comment"
                  rows={3}
                  value={noteComment}
                  onChange={(e) => setNoteComment(e.target.value)}
                  className="mt-1 w-full resize-y rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-neutral-600 dark:bg-neutral-950 dark:text-neutral-100"
                  placeholder="Reflections, reminders, or follow-ups…"
                />
                <div className="mt-3 rounded-lg border border-slate-100 bg-slate-50 p-2 text-xs text-slate-600 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-400">
                  <span className="font-semibold text-slate-700 dark:text-neutral-300">Quote</span>
                  <blockquote className="mt-1 border-l-2 border-amber-300 pl-2 italic dark:border-amber-600">
                    {pendingQuote}
                  </blockquote>
                </div>
              </>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setNoteModal(false)
                  setPendingQuote(null)
                }}
                className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50 dark:border-neutral-600 dark:text-neutral-100 dark:hover:bg-neutral-800"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy || notebookOptions.length === 0}
                onClick={() => void saveNote()}
                className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? 'Saving…' : 'Save to notebook'}
              </button>
            </div>
          </div>
        </div>
      )}

      {markups.length > 0 && (
        <div className="mt-8 rounded-xl border border-slate-200 bg-slate-50/80 p-4 dark:border-neutral-800 dark:bg-neutral-900/50">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-neutral-400">
            Your marks on this page
          </p>
          <ul className="mt-2 flex flex-col gap-2">
            {markups.map((m) => (
              <li
                key={m.id}
                className="flex items-start justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950"
              >
                <div className="min-w-0 flex-1">
                  <span className="text-[10px] font-semibold uppercase text-slate-400 dark:text-neutral-500">
                    {m.kind === 'highlight' ? 'Highlight' : 'Note'}
                  </span>
                  <p className="mt-0.5 line-clamp-2 text-slate-700 dark:text-neutral-200">{m.quoteText}</p>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void onDeleteMarkup(m.id)}
                  className="shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50 dark:hover:bg-rose-950/40 dark:hover:text-rose-300"
                  aria-label="Remove"
                >
                  <X className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
