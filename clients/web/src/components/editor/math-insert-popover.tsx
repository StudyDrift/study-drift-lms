import type { Editor } from '@tiptap/core'
import type { CSSProperties, RefObject } from 'react'
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { loadKatex, renderKatexSafe, type KatexModule } from '../../lib/math'

const RECENT_KEY = 'lextures:mathRecent'
const RECENT_MAX = 5

const FALLBACK_PANEL_POSITION: CSSProperties = {
  top: '20%',
  left: '50%',
  transform: 'translateX(-50%)',
}

function readRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    if (!raw) return []
    const p = JSON.parse(raw) as unknown
    if (!Array.isArray(p)) return []
    return p.filter((x): x is string => typeof x === 'string').slice(0, RECENT_MAX)
  } catch {
    return []
  }
}

function pushRecent(expr: string) {
  const t = expr.trim()
  if (!t) return
  const cur = readRecent().filter((x) => x !== t)
  cur.unshift(t)
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(cur.slice(0, RECENT_MAX)))
  } catch {
    /* ignore quota */
  }
}

export type MathInsertPopoverProps = {
  open: boolean
  onClose: () => void
  editor: Editor | null
  /** Anchor button ref for positioning (optional). */
  anchorRef?: RefObject<HTMLElement | null>
}

export function MathInsertPopover({ open, onClose, editor, anchorRef }: MathInsertPopoverProps) {
  const titleId = useId()
  const [latex, setLatex] = useState('\\frac{a}{b}')
  const [block, setBlock] = useState(false)
  const [katex, setKatex] = useState<KatexModule | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const [panelPosition, setPanelPosition] = useState<CSSProperties>(FALLBACK_PANEL_POSITION)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    void loadKatex().then((k) => {
      if (!cancelled) setKatex(k)
    })
    return () => {
      cancelled = true
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [open])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const previewHtml = useMemo(() => {
    if (!katex) return '<span class="text-slate-400">Loading preview…</span>'
    const { html } = renderKatexSafe(katex, latex, block)
    return html
  }, [katex, latex, block])

  useLayoutEffect(() => {
    if (!open) return
    queueMicrotask(() => {
      const el = anchorRef?.current
      if (!el) {
        setPanelPosition(FALLBACK_PANEL_POSITION)
        return
      }
      const r = el.getBoundingClientRect()
      setPanelPosition({
        top: `${Math.min(r.bottom + 8, window.innerHeight - 320)}px`,
        left: `${Math.min(Math.max(16, r.left), window.innerWidth - 320)}px`,
      })
    })
  }, [open, anchorRef])

  const insert = useCallback(() => {
    if (!editor) return
    const t = latex.trim()
    if (!t) return
    pushRecent(t)
    const node =
      block
        ? { type: 'math_block' as const, attrs: { latex: t } }
        : { type: 'math_inline' as const, attrs: { latex: t } }
    editor.chain().focus().insertContent(node).run()
    onClose()
  }, [editor, latex, block, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[70] bg-slate-900/20 dark:bg-black/40"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={panelPosition}
        className="absolute w-[min(100vw-2rem,22rem)] rounded-xl border border-slate-200 bg-white p-3 shadow-xl dark:border-neutral-600 dark:bg-neutral-900"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h3 id={titleId} className="text-sm font-semibold text-slate-900 dark:text-neutral-100">
          Insert math
        </h3>
        <p className="mt-1 text-xs text-slate-500 dark:text-neutral-400">
          LaTeX · Shift+Enter newline · Enter inserts
        </p>

        <div className="mt-2 flex gap-2">
          <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-700 dark:text-neutral-200">
            <input
              type="radio"
              name="math-mode"
              checked={!block}
              onChange={() => setBlock(false)}
              className="border-slate-300 text-indigo-600"
            />
            Inline
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-700 dark:text-neutral-200">
            <input
              type="radio"
              name="math-mode"
              checked={block}
              onChange={() => setBlock(true)}
              className="border-slate-300 text-indigo-600"
            />
            Block
          </label>
        </div>

        <textarea
          ref={inputRef}
          value={latex}
          onChange={(e) => setLatex(e.target.value)}
          rows={block ? 5 : 3}
          className="mt-2 w-full resize-y rounded-lg border border-slate-200 px-2 py-1.5 font-mono text-[13px] text-slate-900 dark:border-neutral-600 dark:bg-neutral-950 dark:text-neutral-100"
          aria-label="LaTeX source"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              insert()
            }
          }}
        />

        <div
          className="mt-2 min-h-[3rem] overflow-x-auto rounded-lg border border-slate-100 bg-slate-50 px-2 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950"
          aria-live="polite"
        >
          <span dangerouslySetInnerHTML={{ __html: previewHtml }} />
        </div>

        {readRecent().length > 0 ? (
          <div className="mt-2">
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-neutral-400">
              Recent
            </p>
            <ul className="mt-1 flex max-h-20 flex-col gap-1 overflow-y-auto">
              {readRecent().map((r) => (
                <li key={r}>
                  <button
                    type="button"
                    className="w-full truncate rounded border border-transparent px-1 py-0.5 text-left font-mono text-[11px] text-slate-700 hover:border-slate-200 hover:bg-white dark:text-neutral-200 dark:hover:border-neutral-600 dark:hover:bg-neutral-800"
                    title={r}
                    onClick={() => setLatex(r)}
                  >
                    {r.length > 48 ? `${r.slice(0, 48)}…` : r}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700 dark:border-neutral-600 dark:text-neutral-200"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
            onClick={insert}
          >
            Insert
          </button>
        </div>
      </div>
    </div>
  )
}
