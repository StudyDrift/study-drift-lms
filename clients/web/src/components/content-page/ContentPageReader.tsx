import Mark from 'mark.js'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Highlighter, StickyNote, Trash2, X } from 'lucide-react'
import { MarkdownArticleView } from '../syllabus/SyllabusMarkdownView'
import type { ContentPageMarkup, ReaderMarkupTarget } from '../../lib/coursesApi'
import { deleteReaderMarkup, postReaderMarkup } from '../../lib/coursesApi'
import { sortedChildren, type CourseNotebookPage } from '../../lib/courseNotebookTree'
import { appendContentQuoteToNotebookPage, loadCourseNotebook } from '../../lib/studentNotebookStorage'
import type { ResolvedMarkdownTheme } from '../../lib/markdownTheme'

type SelectionOverlayRect = { left: number; top: number; width: number; height: number }

type SelectionOverlaySnapshot = {
  rects: SelectionOverlayRect[]
  start: { left: number; top: number }
  end: { left: number; top: number }
}

function unionClientRect(rects: SelectionOverlayRect[]): { left: number; top: number; width: number; height: number } {
  let minL = Infinity
  let minT = Infinity
  let maxR = -Infinity
  let maxB = -Infinity
  for (const r of rects) {
    minL = Math.min(minL, r.left)
    minT = Math.min(minT, r.top)
    maxR = Math.max(maxR, r.left + r.width)
    maxB = Math.max(maxB, r.top + r.height)
  }
  if (!Number.isFinite(minL)) return { left: 0, top: 0, width: 0, height: 0 }
  return { left: minL, top: minT, width: maxR - minL, height: maxB - minT }
}

function collectSelectionOverlayRects(range: Range): SelectionOverlayRect[] {
  const raw = range.getClientRects()
  const out: SelectionOverlayRect[] = []
  for (let i = 0; i < raw.length; i++) {
    const r = raw[i]!
    if (r.width < 0.5 && r.height < 0.5) continue
    out.push({ left: r.left, top: r.top, width: r.width, height: r.height })
  }
  return out
}

function buildSelectionOverlaySnapshot(range: Range, root: HTMLElement): SelectionOverlaySnapshot | null {
  if (!root.contains(range.commonAncestorContainer)) return null
  const rects = collectSelectionOverlayRects(range)
  if (rects.length === 0) return null
  const first = rects[0]!
  const last = rects[rects.length - 1]!
  return {
    rects,
    start: { left: first.left, top: first.top + first.height / 2 },
    end: { left: last.left + last.width, top: last.top + last.height / 2 },
  }
}

/** Collapsed range at the caret closest to the viewport point (Chrome / Firefox). */
function rangeFromClientPoint(root: HTMLElement, clientX: number, clientY: number): Range | null {
  const doc = root.ownerDocument
  if (!doc) return null
  try {
    const d = doc as Document & {
      caretRangeFromPoint?: (x: number, y: number) => Range | null
      caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
    }
    if (typeof d.caretRangeFromPoint === 'function') {
      const r = d.caretRangeFromPoint(clientX, clientY)
      if (r && root.contains(r.startContainer)) return r.cloneRange()
    }
    if (typeof d.caretPositionFromPoint === 'function') {
      const p = d.caretPositionFromPoint(clientX, clientY)
      if (p?.offsetNode && root.contains(p.offsetNode)) {
        const r = doc.createRange()
        r.setStart(p.offsetNode, p.offset)
        r.collapse(true)
        return r
      }
    }
  } catch {
    return null
  }
  return null
}

function normalizeRangeEndpoints(range: Range): void {
  if (range.collapsed) return
  if (range.compareBoundaryPoints(Range.START_TO_END, range) <= 0) return
  const ec = range.endContainer
  const eo = range.endOffset
  range.setEnd(range.startContainer, range.startOffset)
  range.setStart(ec, eo)
}

function firstTextDescendant(n: Node): Text | null {
  if (n.nodeType === Node.TEXT_NODE) return n as Text
  for (let c = n.firstChild; c; c = c.nextSibling) {
    const t = firstTextDescendant(c)
    if (t) return t
  }
  return null
}

function lastTextDescendant(n: Node): Text | null {
  if (n.nodeType === Node.TEXT_NODE) return n as Text
  for (let c = n.lastChild; c; c = c.previousSibling) {
    const t = lastTextDescendant(c)
    if (t) return t
  }
  return null
}

/** Map a range boundary to a concrete text node + offset (0..length). */
function resolveBoundaryToTextPoint(
  container: Node,
  offset: number,
): { text: Text; offset: number } | null {
  try {
    if (container.nodeType === Node.TEXT_NODE) {
      const t = container as Text
      return { text: t, offset: Math.min(Math.max(0, offset), t.length) }
    }
    if (container.nodeType === Node.ELEMENT_NODE) {
      const el = container as Element
      if (offset < el.childNodes.length) {
        const first = firstTextDescendant(el.childNodes[offset]!)
        if (first) return { text: first, offset: 0 }
      }
      if (offset > 0 && offset <= el.childNodes.length) {
        const last = lastTextDescendant(el.childNodes[offset - 1]!)
        if (last) return { text: last, offset: last.length }
      }
    }
  } catch {
    return null
  }
  return null
}

function isWordChar(ch: string): boolean {
  return /[\p{L}\p{N}_]/u.test(ch)
}

/** Index of the first character in the word that contains the gap before `rangeOffset`. */
function wordStartOffsetInText(s: string, rangeOffset: number): number {
  if (s.length === 0) return 0
  let i = Math.min(Math.max(0, rangeOffset), s.length)
  if (i === s.length) i = s.length - 1
  if (!isWordChar(s[i]!)) {
    if (i > 0 && isWordChar(s[i - 1]!)) {
      i -= 1
    } else {
      while (i < s.length && !isWordChar(s[i]!)) i++
      if (i >= s.length) return s.length
    }
  }
  while (i > 0 && isWordChar(s[i - 1]!)) i -= 1
  return i
}

/** Exclusive end offset after the last character of the word touched by range end `rangeEndOffset`. */
function wordEndExclusiveInText(s: string, rangeEndOffset: number): number {
  if (s.length === 0) return 0
  if (rangeEndOffset <= 0) return 0
  let j = Math.min(rangeEndOffset, s.length) - 1
  if (j < 0) return 0
  while (j >= 0 && !isWordChar(s[j]!)) j -= 1
  if (j < 0) return 0
  while (j + 1 < s.length && isWordChar(s[j + 1]!)) j += 1
  return j + 1
}

/** Snap range start to word start and end to exclusive end after the last word character. */
function snapRangeToWordBoundaries(range: Range, root: HTMLElement): Range {
  const out = range.cloneRange()
  try {
    if (!root.contains(out.commonAncestorContainer)) return out
    const startP = resolveBoundaryToTextPoint(out.startContainer, out.startOffset)
    const endP = resolveBoundaryToTextPoint(out.endContainer, out.endOffset)
    if (!startP || !endP) return out

    const ws = wordStartOffsetInText(startP.text.data, startP.offset)
    const we = wordEndExclusiveInText(endP.text.data, endP.offset)

    out.setStart(startP.text, ws)
    out.setEnd(endP.text, we)
    normalizeRangeEndpoints(out)
    if (out.collapsed || !out.toString().trim()) {
      return range.cloneRange()
    }
  } catch {
    return range.cloneRange()
  }
  return out
}

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
  markupTarget: ReaderMarkupTarget
  contentTitle: string
  /** Passed through to the Markdown article when the document is empty. */
  emptyMessage?: string
  disabled?: boolean
}

export function ContentPageReader({
  markdown,
  theme,
  markups,
  onMarkupsChange,
  courseCode,
  markupTarget,
  contentTitle,
  emptyMessage,
  disabled = false,
}: ContentPageReaderProps) {
  const articleRef = useRef<HTMLDivElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const pendingSelectionRangeRef = useRef<Range | null>(null)
  const dragHandleRef = useRef<'start' | 'end' | null>(null)
  const [selectionOverlay, setSelectionOverlay] = useState<SelectionOverlaySnapshot | null>(null)
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

  const clearPendingSelectionVisual = useCallback(() => {
    pendingSelectionRangeRef.current = null
    setSelectionOverlay(null)
  }, [])

  const closePopover = useCallback(() => {
    dragHandleRef.current = null
    clearPendingSelectionVisual()
    setPopover(null)
  }, [clearPendingSelectionVisual])

  const syncSelectionOverlayFromRef = useCallback(() => {
    const root = articleRef.current
    const range = pendingSelectionRangeRef.current
    if (!root || !range || !root.contains(range.commonAncestorContainer)) {
      setSelectionOverlay(null)
      return
    }
    const snap = buildSelectionOverlaySnapshot(range, root)
    setSelectionOverlay(snap)
  }, [])

  useEffect(() => {
    if (!popover || popover.kind !== 'selection') return
    const onScrollOrResize = () => {
      syncSelectionOverlayFromRef()
    }
    window.addEventListener('scroll', onScrollOrResize, true)
    window.addEventListener('resize', onScrollOrResize)
    return () => {
      window.removeEventListener('scroll', onScrollOrResize, true)
      window.removeEventListener('resize', onScrollOrResize)
    }
  }, [popover, syncSelectionOverlayFromRef])

  const applyRangeAfterPointer = useCallback((clientX: number, clientY: number) => {
    const kind = dragHandleRef.current
    const root = articleRef.current
    const doc = root?.ownerDocument
    const cur = pendingSelectionRangeRef.current
    if (!kind || !root || !doc || !cur) return
    const hit = rangeFromClientPoint(root, clientX, clientY)
    if (!hit) return
    const next = doc.createRange()
    try {
      if (kind === 'start') {
        next.setStart(hit.startContainer, hit.startOffset)
        next.setEnd(cur.endContainer, cur.endOffset)
      } else {
        next.setStart(cur.startContainer, cur.startOffset)
        next.setEnd(hit.startContainer, hit.startOffset)
      }
      normalizeRangeEndpoints(next)
      if (next.collapsed) return
      const snapped = snapRangeToWordBoundaries(next, root)
      const selected = snapped.toString().trim()
      if (selected.length < 2) return
      pendingSelectionRangeRef.current = snapped
      const snap = buildSelectionOverlaySnapshot(snapped, root)
      if (!snap) return
      setSelectionOverlay(snap)
      const u = unionClientRect(snap.rects)
      setPopover((prev) =>
        prev?.kind === 'selection'
          ? { ...prev, x: u.left + u.width / 2, y: u.top + u.height + 6, text: selected }
          : prev,
      )
    } catch {
      /* invalid boundary */
    }
  }, [])

  useEffect(() => {
    if (!popover && !noteModal) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        closePopover()
        setNoteModal(false)
        setPendingQuote(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [popover, noteModal, closePopover])

  useEffect(() => {
    if (!popover) return
    function onDocMouseDown(e: MouseEvent) {
      const el = e.target as HTMLElement | null
      if (el?.closest?.('[data-reader-selection-ui]')) return
      if (popoverRef.current?.contains(e.target as Node)) return
      closePopover()
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [popover, closePopover])

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
        closePopover()
        return
      }
      const root = articleRef.current
      if (!root) return
      if (!sel.toString().trim()) {
        closePopover()
        return
      }
      const a = sel.anchorNode
      const f = sel.focusNode
      if (!a || !f || !root.contains(a) || !root.contains(f)) {
        closePopover()
        return
      }
      const range = sel.getRangeAt(0)
      const clone = range.cloneRange()
      const snapped = snapRangeToWordBoundaries(clone, root)
      pendingSelectionRangeRef.current = snapped
      window.getSelection()?.removeAllRanges()
      const textSnapped = snapped.toString().trim()
      if (textSnapped.length < 2) {
        closePopover()
        return
      }
      const snap = buildSelectionOverlaySnapshot(snapped, root)
      if (!snap) {
        closePopover()
        return
      }
      setSelectionOverlay(snap)
      const bounds = unionClientRect(snap.rects)
      const bottom = bounds.top + bounds.height
      setPopover({
        kind: 'selection',
        x: bounds.left + bounds.width / 2,
        y: bottom + 6,
        text: textSnapped,
      })
    }
    document.addEventListener('mouseup', onMouseUp)
    return () => document.removeEventListener('mouseup', onMouseUp)
  }, [closePopover, disabled])

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
      clearPendingSelectionVisual()
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
  }, [clearPendingSelectionVisual, disabled, markups])

  const refresh = useCallback(async () => {
    await onMarkupsChange()
  }, [onMarkupsChange])

  const onHighlight = useCallback(async () => {
    if (!popover || popover.kind !== 'selection') return
    setBusy(true)
    setError(null)
    try {
      const quoteText =
        pendingSelectionRangeRef.current?.toString().trim() || popover.text
      await postReaderMarkup(courseCode, markupTarget, {
        kind: 'highlight',
        quoteText,
      })
      window.getSelection()?.removeAllRanges()
      closePopover()
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save highlight.')
    } finally {
      setBusy(false)
    }
  }, [closePopover, courseCode, markupTarget, popover, refresh])

  const openNoteWithQuote = useCallback(
    (quote: string) => {
      setError(null)
      setPendingQuote(quote)
      closePopover()
      window.getSelection()?.removeAllRanges()
      setNoteModal(true)
      setNoteComment('')
      const opts = flattenNotebookPages(loadCourseNotebook(courseCode).pages)
      setNotePageId(opts[0]?.id ?? '')
    },
    [closePopover, courseCode],
  )

  const openNoteModal = useCallback(() => {
    if (!popover || popover.kind !== 'selection') return
    const quote = pendingSelectionRangeRef.current?.toString().trim() || popover.text
    openNoteWithQuote(quote)
  }, [popover, openNoteWithQuote])

  const openNoteFromHighlightToolbar = useCallback(() => {
    if (!popover || popover.kind !== 'highlight') return
    openNoteWithQuote(popover.quoteText)
  }, [popover, openNoteWithQuote])

  const removeCurrentHighlight = useCallback(async () => {
    if (!popover || popover.kind !== 'highlight') return
    const id = popover.markupId
    closePopover()
    setBusy(true)
    setError(null)
    try {
      await deleteReaderMarkup(courseCode, markupTarget, id)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove highlight.')
    } finally {
      setBusy(false)
    }
  }, [closePopover, courseCode, markupTarget, popover, refresh])

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
      await postReaderMarkup(courseCode, markupTarget, {
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
  }, [courseCode, contentTitle, markupTarget, noteComment, notePageId, pendingQuote, refresh])

  const onDeleteMarkup = useCallback(
    async (id: string) => {
      setBusy(true)
      setError(null)
      try {
        await deleteReaderMarkup(courseCode, markupTarget, id)
        await refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not remove.')
      } finally {
        setBusy(false)
      }
    },
    [courseCode, markupTarget, refresh],
  )

  return (
    <div className="relative">
      <div className="relative min-w-0">
        <MarkdownArticleView
          ref={articleRef}
          markdown={markdown}
          theme={theme}
          courseCode={courseCode}
          emptyMessage={emptyMessage}
        />
      </div>

      {error && (
        <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-200">
          {error}
        </p>
      )}

      {selectionOverlay && popover?.kind === 'selection' && !disabled && (
        <>
          {/* Above article so rects are not fully covered by the markdown block; blend reads softer on type. */}
          <div className="pointer-events-none fixed inset-0 z-[15]" aria-hidden>
            {selectionOverlay.rects.map((r, i) => (
              <div
                key={`reader-sel-${i}`}
                className="pointer-events-none fixed rounded-sm bg-amber-200/55 mix-blend-multiply ring-1 ring-amber-400/25 dark:bg-amber-400/40 dark:mix-blend-plus-lighter dark:ring-amber-500/30"
                style={{
                  left: `${r.left}px`,
                  top: `${r.top}px`,
                  width: `${r.width}px`,
                  height: `${r.height}px`,
                }}
              />
            ))}
          </div>
          <div data-reader-selection-ui className="pointer-events-none fixed inset-0 z-[18]">
            <button
              type="button"
              aria-label="Adjust selection start"
              className="pointer-events-auto fixed h-4 w-4 cursor-grab touch-none rounded-full border-2 border-indigo-600 bg-white shadow-md active:cursor-grabbing dark:border-indigo-400 dark:bg-neutral-900"
              style={{
                left: `${selectionOverlay.start.left}px`,
                top: `${selectionOverlay.start.top}px`,
                transform: 'translate(-50%, -50%)',
              }}
              onPointerDown={(e) => {
                e.preventDefault()
                e.stopPropagation()
                dragHandleRef.current = 'start'
                e.currentTarget.setPointerCapture(e.pointerId)
              }}
              onPointerMove={(e) => {
                if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
                if ((e.buttons & 1) === 0) return
                e.preventDefault()
                applyRangeAfterPointer(e.clientX, e.clientY)
              }}
              onPointerUp={(e) => {
                dragHandleRef.current = null
                try {
                  e.currentTarget.releasePointerCapture(e.pointerId)
                } catch {
                  /* not captured */
                }
              }}
              onLostPointerCapture={() => {
                dragHandleRef.current = null
              }}
            />
            <button
              type="button"
              aria-label="Adjust selection end"
              className="pointer-events-auto fixed h-4 w-4 cursor-grab touch-none rounded-full border-2 border-indigo-600 bg-white shadow-md active:cursor-grabbing dark:border-indigo-400 dark:bg-neutral-900"
              style={{
                left: `${selectionOverlay.end.left}px`,
                top: `${selectionOverlay.end.top}px`,
                transform: 'translate(-50%, -50%)',
              }}
              onPointerDown={(e) => {
                e.preventDefault()
                e.stopPropagation()
                dragHandleRef.current = 'end'
                e.currentTarget.setPointerCapture(e.pointerId)
              }}
              onPointerMove={(e) => {
                if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
                if ((e.buttons & 1) === 0) return
                e.preventDefault()
                applyRangeAfterPointer(e.clientX, e.clientY)
              }}
              onPointerUp={(e) => {
                dragHandleRef.current = null
                try {
                  e.currentTarget.releasePointerCapture(e.pointerId)
                } catch {
                  /* not captured */
                }
              }}
              onLostPointerCapture={() => {
                dragHandleRef.current = null
              }}
            />
          </div>
        </>
      )}

      {popover && !disabled && (
        <div
          ref={popoverRef}
          onMouseDown={(e) => e.preventDefault()}
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
