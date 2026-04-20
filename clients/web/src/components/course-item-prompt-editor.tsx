/* eslint-disable react-hooks/set-state-in-effect -- contenteditable mirrors props and caret; effects sync DOM ↔ React */
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { fetchCourseStructure, type CourseStructureItem } from '../lib/courses-api'
import { decodeTitleFromToken, encodeRefToken, REF_TOKEN_RE } from '../lib/course-item-ref-tokens'
import { filterTaggable, getMentionState, kindLabel } from './course-item-prompt-mention'

function serializeFragment(node: Node): string {
  let out = ''
  for (const child of node.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      out += child.textContent ?? ''
    } else if (child instanceof HTMLElement && child.hasAttribute('data-token')) {
      out += child.getAttribute('data-token')!
    } else if (child.nodeName === 'BR') {
      out += '\n'
    } else if (child instanceof HTMLElement) {
      out += serializeFragment(child)
    }
  }
  return out
}

function serializeEditorRoot(root: HTMLElement): string {
  return serializeFragment(root)
}

function getSerializedCaretOffset(root: HTMLElement, sel: Selection): number {
  const an = sel.anchorNode
  if (!an || !root.contains(an)) return 0
  const range = document.createRange()
  range.setStart(root, 0)
  range.setEnd(an, sel.anchorOffset)
  return serializeFragment(range.cloneContents()).length
}

function setCaretAtSerializedOffset(root: HTMLElement, target: number): void {
  let remaining = target
  const sel = window.getSelection()
  if (!sel) return
  const selection = sel

  function place(node: Node, pos: number): void {
    const r = document.createRange()
    r.setStart(node, pos)
    r.collapse(true)
    selection.removeAllRanges()
    selection.addRange(r)
  }

  function placeAfter(n: Node): void {
    const r = document.createRange()
    r.setStartAfter(n)
    r.collapse(true)
    selection.removeAllRanges()
    selection.addRange(r)
  }

  function walk(node: Node): boolean {
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        const len = (child as Text).length
        if (remaining <= len) {
          place(child, remaining)
          return true
        }
        remaining -= len
      } else if (child instanceof HTMLElement && child.hasAttribute('data-token')) {
        const tlen = child.getAttribute('data-token')!.length
        if (remaining < tlen) {
          placeAfter(child)
          return true
        }
        if (remaining === tlen) {
          placeAfter(child)
          return true
        }
        remaining -= tlen
      } else if (child.nodeName === 'BR') {
        if (remaining <= 1) {
          placeAfter(child)
          return true
        }
        remaining -= 1
      } else if (child instanceof HTMLElement) {
        if (walk(child)) return true
      }
    }
    return false
  }

  if (target <= 0) {
    const r = document.createRange()
    r.setStart(root, 0)
    r.collapse(true)
    selection.removeAllRanges()
    selection.addRange(r)
    return
  }
  walk(root)
}

function renderValueIntoEditor(root: HTMLElement, value: string): void {
  root.innerHTML = ''
  const re = new RegExp(REF_TOKEN_RE.source, 'g')
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(value)) !== null) {
    if (m.index > last) {
      root.appendChild(document.createTextNode(value.slice(last, m.index)))
    }
    const title = decodeTitleFromToken(m[3] ?? '')
    const span = document.createElement('span')
    span.setAttribute('data-token', m[0])
    span.contentEditable = 'false'
    span.className =
      'mx-0.5 inline cursor-default select-none rounded-md bg-indigo-100 px-1.5 py-0.5 align-baseline text-sm font-medium text-indigo-900 ring-1 ring-indigo-200/80'
    span.textContent = `@${title}`
    root.appendChild(span)
    last = m.index + m[0].length
  }
  if (last < value.length) {
    root.appendChild(document.createTextNode(value.slice(last)))
  }
}

function getCaretClientRect(root: HTMLElement): { left: number; top: number; bottom: number } | null {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0 || !root.contains(sel.anchorNode)) return null
  const r = sel.getRangeAt(0).cloneRange()
  r.collapse(true)
  const rects = r.getClientRects()
  const rect = rects.length > 0 ? rects[0]! : r.getBoundingClientRect()
  if (!rect.width && !rect.height && rect.top === 0 && rect.left === 0) return null
  return { left: rect.left, top: rect.top, bottom: rect.bottom }
}

type CourseItemPromptEditorProps = {
  courseCode: string
  value: string
  onChange: (next: string) => void
  disabled?: boolean
  autoFocus?: boolean
  id?: string
  placeholder?: string
  className?: string
  'aria-describedby'?: string
}

export function CourseItemPromptEditor({
  courseCode,
  value,
  onChange,
  disabled,
  autoFocus = false,
  id,
  placeholder,
  className,
  'aria-describedby': ariaDescribedBy,
}: CourseItemPromptEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null)
  const lastEmittedRef = useRef<string | null>(null)
  const listId = useId()
  /** Mirrors the editor so @-mention detection is not one frame behind controlled `value`. */
  const [docText, setDocText] = useState(value)
  const [docCaret, setDocCaret] = useState(0)
  const [dropdownPos, setDropdownPos] = useState<{ left: number; top: number } | null>(null)
  const [structure, setStructure] = useState<CourseStructureItem[]>([])
  const [structureLoading, setStructureLoading] = useState(false)
  const [structureError, setStructureError] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)

  useEffect(() => {
    if (!courseCode) return
    let cancelled = false
    setStructureLoading(true)
    setStructureError(false)
    void fetchCourseStructure(courseCode)
      .then((items) => {
        if (!cancelled) setStructure(items)
      })
      .catch(() => {
        if (!cancelled) {
          setStructure([])
          setStructureError(true)
        }
      })
      .finally(() => {
        if (!cancelled) setStructureLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [courseCode])

  const mention = useMemo(() => getMentionState(docText, docCaret), [docText, docCaret])

  const filtered = useMemo(
    () => (mention ? filterTaggable(structure, mention.query) : []),
    [structure, mention],
  )

  useEffect(() => {
    setActiveIndex(0)
  }, [mention?.start, mention?.query])

  useEffect(() => {
    if (filtered.length === 0) return
    setActiveIndex((i) => Math.min(i, filtered.length - 1))
  }, [filtered.length])

  const listOpen = Boolean(mention && !disabled)

  const syncFromDom = useCallback(() => {
    const root = editorRef.current
    if (!root) return
    const s = serializeEditorRoot(root)
    const sel = window.getSelection()
    const off = sel && root.contains(sel.anchorNode) ? getSerializedCaretOffset(root, sel) : s.length
    setDocText(s)
    setDocCaret(off)
    if (s !== lastEmittedRef.current) {
      lastEmittedRef.current = s
      onChange(s)
    }
  }, [onChange])

  useLayoutEffect(() => {
    const root = editorRef.current
    if (!root) return
    if (lastEmittedRef.current === null || value !== lastEmittedRef.current) {
      lastEmittedRef.current = value
      renderValueIntoEditor(root, value)
      setDocText(value)
      queueMicrotask(() => {
        setCaretAtSerializedOffset(root, value.length)
        setDocCaret(value.length)
      })
    }
  }, [value])

  useLayoutEffect(() => {
    if (!autoFocus || disabled) return
    const idr = requestAnimationFrame(() => {
      editorRef.current?.focus()
    })
    return () => cancelAnimationFrame(idr)
  }, [autoFocus, disabled])

  useEffect(() => {
    if (!listOpen || !editorRef.current) {
      setDropdownPos(null)
      return
    }
    const rect = getCaretClientRect(editorRef.current)
    if (!rect) {
      setDropdownPos(null)
      return
    }
    setDropdownPos({ left: rect.left, top: rect.bottom + 4 })
  }, [listOpen, docCaret, mention, docText])

  useEffect(() => {
    function onSel() {
      const root = editorRef.current
      if (!root) return
      const sel = window.getSelection()
      if (!sel || !root.contains(sel.anchorNode)) return
      const off = getSerializedCaretOffset(root, sel)
      setDocCaret(off)
      setDocText(serializeEditorRoot(root))
    }
    document.addEventListener('selectionchange', onSel)
    return () => document.removeEventListener('selectionchange', onSel)
  }, [])

  const applyPick = useCallback(
    (item: CourseStructureItem) => {
      const m = mention
      const root = editorRef.current
      const sel = window.getSelection()
      if (!m || !root || !sel || !root.contains(sel.anchorNode)) return
      const caret = getSerializedCaretOffset(root, sel)
      const kind = item.kind === 'content_page' ? 'content_page' : 'assignment'
      const token = encodeRefToken(kind, item.id, item.title)
      const s = serializeEditorRoot(root)
      const next = s.slice(0, m.start) + token + s.slice(caret)
      lastEmittedRef.current = next
      onChange(next)
      renderValueIntoEditor(root, next)
      const pos = m.start + token.length
      queueMicrotask(() => {
        setCaretAtSerializedOffset(root, pos)
        setDocCaret(pos)
        setDocText(next)
        root.focus()
      })
    },
    [mention, onChange],
  )

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      const root = editorRef.current
      if (!root) return

      if (listOpen && !structureLoading) {
        if (filtered.length === 0) {
          if (e.key === 'Escape') {
            e.preventDefault()
            const m = mention
            const sel = window.getSelection()
            if (!m || !sel || !root.contains(sel.anchorNode)) return
            const caret = getSerializedCaretOffset(root, sel)
            const s = serializeEditorRoot(root)
            const cut = s.slice(0, m.start) + s.slice(caret)
            lastEmittedRef.current = cut
            onChange(cut)
            renderValueIntoEditor(root, cut)
            queueMicrotask(() => {
              setCaretAtSerializedOffset(root, m.start)
              setDocCaret(m.start)
              setDocText(cut)
            })
          }
          return
        }
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          setActiveIndex((i) => (i + 1) % filtered.length)
          return
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault()
          setActiveIndex((i) => (i - 1 + filtered.length) % filtered.length)
          return
        }
        if (e.key === 'Enter') {
          e.preventDefault()
          const item = filtered[activeIndex]
          if (item) applyPick(item)
          return
        }
        if (e.key === 'Escape') {
          e.preventDefault()
          const m = mention
          const sel = window.getSelection()
          if (!m || !sel || !root.contains(sel.anchorNode)) return
          const caret = getSerializedCaretOffset(root, sel)
          const s = serializeEditorRoot(root)
          const cut = s.slice(0, m.start) + s.slice(caret)
          lastEmittedRef.current = cut
          onChange(cut)
          renderValueIntoEditor(root, cut)
          queueMicrotask(() => {
            setCaretAtSerializedOffset(root, m.start)
            setDocCaret(m.start)
            setDocText(cut)
          })
          return
        }
      }

      if (e.key === 'Backspace') {
        const sel = window.getSelection()
        if (!sel || sel.rangeCount === 0) return
        if (!sel.isCollapsed) return
        const node = sel.anchorNode
        const off = sel.anchorOffset
        if (!node) return
        if (node === root && off > 0) {
          const prev = root.childNodes[off - 1]
          if (prev instanceof HTMLElement && prev.hasAttribute('data-token')) {
            e.preventDefault()
            prev.remove()
            syncFromDom()
          }
        } else if (node.nodeType === Node.TEXT_NODE && off === 0) {
          const prev = node.previousSibling
          if (prev instanceof HTMLElement && prev.hasAttribute('data-token')) {
            e.preventDefault()
            prev.remove()
            syncFromDom()
          }
        }
      }
    },
    [activeIndex, applyPick, filtered, listOpen, mention, onChange, structureLoading, syncFromDom],
  )

  const onPaste = useCallback(
    (e: React.ClipboardEvent<HTMLDivElement>) => {
      e.preventDefault()
      const t = e.clipboardData.getData('text/plain')
      document.execCommand('insertText', false, t)
      syncFromDom()
    },
    [syncFromDom],
  )

  return (
    <div className="relative">
      <div
        ref={editorRef}
        id={id}
        role="textbox"
        aria-multiline="true"
        contentEditable={!disabled}
        aria-describedby={ariaDescribedBy}
        aria-autocomplete="list"
        aria-expanded={listOpen && (filtered.length > 0 || structureLoading || structureError)}
        aria-controls={listOpen ? listId : undefined}
        aria-activedescendant={
          listOpen && filtered.length > 0 ? `${listId}-opt-${activeIndex}` : undefined
        }
        suppressContentEditableWarning
        className={[
          'min-h-[120px] w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-400/30',
          disabled ? 'cursor-not-allowed opacity-60' : '',
          className ?? '',
        ].join(' ')}
        onInput={syncFromDom}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onBlur={syncFromDom}
        title={placeholder}
      />
      {listOpen && dropdownPos && (
        <div
          id={listId}
          role="listbox"
          aria-label="Course items to insert"
          style={{
            position: 'fixed',
            left: dropdownPos.left,
            top: dropdownPos.top,
            zIndex: 60,
            width: 'min(20rem, calc(100vw - 2rem))',
          }}
          className="max-h-56 overflow-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg shadow-slate-900/15"
        >
          {structureLoading ? (
            <p className="px-3 py-2 text-sm text-slate-500">Loading course items…</p>
          ) : structureError ? (
            <p className="px-3 py-2 text-sm text-rose-600">Could not load course structure.</p>
          ) : filtered.length === 0 ? (
            <p className="px-3 py-2 text-sm text-slate-500">
              No matching content pages or assignments. Keep typing to filter.
            </p>
          ) : (
            filtered.map((item, idx) => (
              <button
                key={item.id}
                type="button"
                role="option"
                id={`${listId}-opt-${idx}`}
                aria-selected={idx === activeIndex}
                className={`flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm transition ${
                  idx === activeIndex ? 'bg-indigo-50 text-indigo-950' : 'text-slate-800 hover:bg-slate-50'
                }`}
                onMouseDown={(e) => {
                  e.preventDefault()
                  applyPick(item)
                }}
                onMouseEnter={() => setActiveIndex(idx)}
              >
                <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  {kindLabel(item.kind)}
                </span>
                <span className="font-medium">{item.title}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
