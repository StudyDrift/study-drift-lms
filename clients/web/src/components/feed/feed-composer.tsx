import {
  AtSign,
  Bold,
  ChevronDown,
  Code,
  Code2,
  Italic,
  Link2,
  List,
  ListOrdered,
  Mic,
  Plus,
  Quote,
  Send,
  Smile,
  SquareSlash,
  Strikethrough,
  Underline,
  Video,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FeedRosterPerson } from '../../lib/course-feed-api'
import { rosterMentionLabels, uploadFeedImage } from '../../lib/course-feed-api'

type PickerRow =
  | { kind: 'everyone' }
  | { kind: 'person'; person: FeedRosterPerson }

type FeedComposerProps = {
  courseCode: string
  value: string
  onChange: (v: string) => void
  roster: FeedRosterPerson[]
  /** Omitted or null: picker lists everyone including the signed-in user. */
  viewerUserId?: string | null
  staff: boolean
  placeholder: string
  disabled?: boolean
  onSubmit: () => void
  /** While a pasted or chosen image is uploading to the API. */
  onImageBusyChange?: (busy: boolean) => void
}

function lineRange(s: string, caret: number): { start: number; end: number } {
  const start = s.lastIndexOf('\n', Math.max(0, caret - 1)) + 1
  const nl = s.indexOf('\n', caret)
  const end = nl === -1 ? s.length : nl
  return { start, end }
}

export function FeedComposer({
  courseCode,
  value,
  onChange,
  roster,
  viewerUserId,
  staff,
  placeholder,
  disabled,
  onSubmit,
  onImageBusyChange,
}: FeedComposerProps) {
  const taRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [imageBusy, setImageBusy] = useState(false)
  const [imageErr, setImageErr] = useState<string | null>(null)
  const [formatBarVisible, setFormatBarVisible] = useState(true)
  const [picker, setPicker] = useState<{
    query: string
    start: number
    highlight: number
  } | null>(null)

  const labels = useMemo(() => rosterMentionLabels(roster), [roster])

  const rows = useMemo((): PickerRow[] => {
    if (!picker) return []
    const q = picker.query.toLowerCase()
    const out: PickerRow[] = []
    if (staff && (!q || 'everyone'.startsWith(q))) {
      out.push({ kind: 'everyone' })
    }
    const self = viewerUserId?.toLowerCase() ?? null
    for (const p of roster) {
      if (self && p.userId.toLowerCase() === self) continue
      const lab = labels.get(p.userId)!.toLowerCase()
      if (lab.includes(q) || p.email.toLowerCase().includes(q)) {
        out.push({ kind: 'person', person: p })
      }
      if (out.length >= 14) break
    }
    return out
  }, [picker, roster, labels, staff, viewerUserId])

  useEffect(() => {
    if (!picker || rows.length === 0) return
    if (picker.highlight >= rows.length) {
      setPicker((p) => (p ? { ...p, highlight: 0 } : p))
    }
  }, [picker, rows.length])

  const syncPicker = useCallback(
    (el: HTMLTextAreaElement) => {
      const pos = el.selectionStart ?? value.length
      const before = value.slice(0, pos)
      const at = before.lastIndexOf('@')
      if (at < 0) {
        setPicker(null)
        return
      }
      if (at > 0) {
        const prev = before[at - 1]
        if (prev && !/\s/.test(prev)) {
          setPicker(null)
          return
        }
      }
      const chunk = before.slice(at + 1)
      if (chunk.includes('\n')) {
        setPicker(null)
        return
      }
      setPicker((prev) => {
        if (prev && prev.start === at && prev.query === chunk) return prev
        return { query: chunk, start: at, highlight: 0 }
      })
    },
    [value],
  )

  const setBusy = useCallback(
    (b: boolean) => {
      setImageBusy(b)
      onImageBusyChange?.(b)
    },
    [onImageBusyChange],
  )

  const insertImageMarkdown = useCallback(
    async (file: File) => {
      if (!file.type.startsWith('image/')) return
      setImageErr(null)
      setBusy(true)
      try {
        const { contentPath } = await uploadFeedImage(courseCode, file)
        const line = `\n![](${contentPath})\n`
        const el = taRef.current
        const pos = el?.selectionStart ?? value.length
        const inserted = `${value.slice(0, pos)}${line}${value.slice(pos)}`
        const next = inserted.slice(0, 8000)
        onChange(next)
        requestAnimationFrame(() => {
          el?.focus()
          const caret = Math.min(pos + line.length, next.length)
          el?.setSelectionRange(caret, caret)
        })
      } catch (e) {
        setImageErr(e instanceof Error ? e.message : 'Could not upload image.')
      } finally {
        setBusy(false)
      }
    },
    [courseCode, value, onChange, setBusy],
  )

  const insertMention = useCallback(
    (label: string) => {
      if (!picker || !taRef.current) return
      const el = taRef.current
      const pos = el.selectionStart ?? value.length
      const { start } = picker
      const next = `${value.slice(0, start)}@${label} ${value.slice(pos)}`
      onChange(next)
      setPicker(null)
      const caret = start + label.length + 2
      requestAnimationFrame(() => {
        el.focus()
        el.setSelectionRange(caret, caret)
      })
    },
    [picker, value, onChange],
  )

  const blocked = Boolean(disabled || imageBusy)

  const insertWrap = useCallback(
    (left: string, right: string) => {
      const el = taRef.current
      if (!el || blocked) return
      const start = el.selectionStart ?? 0
      const end = el.selectionEnd ?? 0
      const selected = value.slice(start, end)
      const next = `${value.slice(0, start)}${left}${selected}${right}${value.slice(end)}`.slice(
        0,
        8000,
      )
      onChange(next)
      const caret = start + left.length + selected.length + right.length
      requestAnimationFrame(() => {
        el.focus()
        const p = Math.min(caret, next.length)
        el.setSelectionRange(p, p)
      })
    },
    [value, onChange, blocked],
  )

  const insertLinePrefix = useCallback(
    (prefix: string) => {
      const el = taRef.current
      if (!el || blocked) return
      const caret = el.selectionStart ?? 0
      const { start } = lineRange(value, caret)
      const next = `${value.slice(0, start)}${prefix}${value.slice(start)}`.slice(0, 8000)
      onChange(next)
      const newCaret = caret + prefix.length
      requestAnimationFrame(() => {
        el.focus()
        const p = Math.min(newCaret, next.length)
        el.setSelectionRange(p, p)
      })
    },
    [value, onChange, blocked],
  )

  const insertLink = useCallback(() => {
    const el = taRef.current
    if (!el || blocked) return
    const start = el.selectionStart ?? 0
    const end = el.selectionEnd ?? 0
    const ins = '[](url)'
    const next = `${value.slice(0, start)}${ins}${value.slice(end)}`.slice(0, 8000)
    onChange(next)
    requestAnimationFrame(() => {
      el.focus()
      const urlStart = start + 3
      const urlEnd = start + 6
      el.setSelectionRange(urlStart, urlEnd)
    })
  }, [value, onChange, blocked])

  const insertCodeBlock = useCallback(() => {
    const el = taRef.current
    if (!el || blocked) return
    const start = el.selectionStart ?? 0
    const end = el.selectionEnd ?? 0
    const ins = '```\n\n```'
    const next = `${value.slice(0, start)}${ins}${value.slice(end)}`.slice(0, 8000)
    onChange(next)
    requestAnimationFrame(() => {
      el.focus()
      const mid = start + 4
      el.setSelectionRange(mid, mid)
    })
  }, [value, onChange, blocked])

  const insertAtMention = useCallback(() => {
    const el = taRef.current
    if (!el || blocked) return
    const start = el.selectionStart ?? 0
    const end = el.selectionEnd ?? 0
    const ins = '@'
    const next = `${value.slice(0, start)}${ins}${value.slice(end)}`.slice(0, 8000)
    onChange(next)
    requestAnimationFrame(() => {
      el.focus()
      const p = Math.min(start + 1, next.length)
      el.setSelectionRange(p, p)
      syncPicker(el)
    })
  }, [value, onChange, blocked, syncPicker])

  const fmtBtn =
    'rounded p-1.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 disabled:pointer-events-none disabled:opacity-35 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100'

  const fmtSep = 'mx-0.5 h-5 w-px shrink-0 bg-slate-200 dark:bg-neutral-600'

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (picker && rows.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setPicker((p) =>
          p ? { ...p, highlight: (p.highlight + 1) % rows.length } : p,
        )
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setPicker((p) =>
          p ? { ...p, highlight: (p.highlight - 1 + rows.length) % rows.length } : p,
        )
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setPicker(null)
        return
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        const row = rows[picker.highlight]
        if (row?.kind === 'everyone') insertMention('everyone')
        else if (row?.kind === 'person') insertMention(labels.get(row.person.userId)!)
        return
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (!blocked && value.trim()) onSubmit()
    }
  }

  const sendDisabled = blocked || !value.trim()

  return (
    <div className="relative min-w-0 flex-1">
      {picker && rows.length > 0 && (
        <ul
          className="absolute bottom-full left-0 z-20 mb-2 max-h-52 w-full max-w-md overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 text-sm shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
          role="listbox"
          aria-label="Mention suggestions"
          onMouseDown={(ev) => ev.preventDefault()}
        >
          {rows.map((row, i) => {
            const active = i === picker.highlight
            if (row.kind === 'everyone') {
              return (
                <li key="everyone">
                  <button
                    type="button"
                    role="option"
                    aria-selected={active}
                    className={`flex w-full px-3 py-2 text-left ${
                      active ? 'bg-indigo-50 dark:bg-indigo-950/50' : ''
                    }`}
                    onClick={() => insertMention('everyone')}
                  >
                    <span className="font-medium text-amber-900 dark:text-amber-100">
                      @everyone
                    </span>
                    <span className="ml-2 text-xs text-slate-500 dark:text-neutral-400">
                      Notify the class
                    </span>
                  </button>
                </li>
              )
            }
            const lab = labels.get(row.person.userId)!
            return (
              <li key={row.person.userId}>
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  className={`flex w-full flex-col px-3 py-2 text-left ${
                    active ? 'bg-indigo-50 dark:bg-indigo-950/50' : ''
                  }`}
                  onClick={() => insertMention(lab)}
                >
                  <span className="font-medium text-slate-900 dark:text-neutral-100">@{lab}</span>
                  <span className="text-xs text-slate-500 dark:text-neutral-400">
                    {row.person.email}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}

      <div className="overflow-hidden rounded-lg border border-slate-300 bg-white shadow-sm transition-[box-shadow,border-color] focus-within:border-indigo-400/90 focus-within:shadow-[0_0_0_1px_rgba(99,102,241,0.25)] dark:border-neutral-600 dark:bg-neutral-900 dark:focus-within:border-indigo-500/70 dark:focus-within:shadow-[0_0_0_1px_rgba(129,140,248,0.2)]">
        {formatBarVisible && (
          <div
            className="flex flex-wrap items-center gap-0.5 border-b border-slate-200 px-2 py-1.5 dark:border-neutral-700"
            role="toolbar"
            aria-label="Formatting"
          >
            <button
              type="button"
              className={fmtBtn}
              aria-label="Bold"
              onClick={() => insertWrap('**', '**')}
            >
              <Bold className="h-4 w-4" strokeWidth={2} />
            </button>
            <button
              type="button"
              className={fmtBtn}
              aria-label="Italic"
              onClick={() => insertWrap('*', '*')}
            >
              <Italic className="h-4 w-4" strokeWidth={2} />
            </button>
            <button
              type="button"
              className={fmtBtn}
              disabled
              title="Underline is not supported in feed messages"
              aria-label="Underline (not supported)"
            >
              <Underline className="h-4 w-4" strokeWidth={2} />
            </button>
            <button
              type="button"
              className={fmtBtn}
              aria-label="Strikethrough"
              onClick={() => insertWrap('~~', '~~')}
            >
              <Strikethrough className="h-4 w-4" strokeWidth={2} />
            </button>
            <span className={fmtSep} aria-hidden />
            <button type="button" className={fmtBtn} aria-label="Link" onClick={insertLink}>
              <Link2 className="h-4 w-4" strokeWidth={2} />
            </button>
            <span className={fmtSep} aria-hidden />
            <button
              type="button"
              className={fmtBtn}
              aria-label="Numbered list"
              onClick={() => insertLinePrefix('1. ')}
            >
              <ListOrdered className="h-4 w-4" strokeWidth={2} />
            </button>
            <button
              type="button"
              className={fmtBtn}
              aria-label="Bulleted list"
              onClick={() => insertLinePrefix('- ')}
            >
              <List className="h-4 w-4" strokeWidth={2} />
            </button>
            <span className={fmtSep} aria-hidden />
            <button
              type="button"
              className={fmtBtn}
              aria-label="Quote"
              onClick={() => insertLinePrefix('> ')}
            >
              <Quote className="h-4 w-4" strokeWidth={2} />
            </button>
            <button
              type="button"
              className={fmtBtn}
              aria-label="Inline code"
              onClick={() => insertWrap('`', '`')}
            >
              <Code className="h-4 w-4" strokeWidth={2} />
            </button>
            <button
              type="button"
              className={fmtBtn}
              aria-label="Code block"
              onClick={insertCodeBlock}
            >
              <Code2 className="h-4 w-4" strokeWidth={2} />
            </button>
          </div>
        )}

        <textarea
          ref={taRef}
          value={value}
          disabled={blocked}
          onChange={(e) => {
            onChange(e.target.value)
            syncPicker(e.target)
          }}
          onKeyDown={onKeyDown}
          onKeyUp={(e) => syncPicker(e.currentTarget)}
          onClick={(e) => syncPicker(e.currentTarget)}
          onPaste={(e) => {
            const files = e.clipboardData?.files
            if (!files?.length) return
            const f = Array.from(files).find((x) => x.type.startsWith('image/'))
            if (!f) return
            e.preventDefault()
            void insertImageMarkdown(f)
          }}
          rows={1}
          placeholder={placeholder}
          className="max-h-64 min-h-[5.25rem] w-full resize-y border-0 bg-transparent px-3 py-3 text-[0.9375rem] leading-relaxed text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-0 disabled:opacity-60 dark:text-neutral-100 dark:placeholder:text-neutral-500"
          maxLength={8000}
        />

        <div className="flex items-center gap-2 border-t border-slate-100 px-2 py-1.5 dark:border-neutral-800">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-0.5">
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/jpg,image/gif,image/webp"
              className="sr-only"
              tabIndex={-1}
              onChange={(ev) => {
                const f = ev.target.files?.[0]
                ev.target.value = ''
                if (f) void insertImageMarkdown(f)
              }}
            />
            <button
              type="button"
              disabled={blocked}
              onClick={() => fileRef.current?.click()}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-200 text-slate-600 transition-colors hover:bg-slate-100 disabled:opacity-40 dark:border-neutral-600 dark:text-neutral-300 dark:hover:bg-neutral-800"
              title="Attach image"
              aria-label="Attach image"
            >
              <Plus className="h-4 w-4" strokeWidth={2.5} />
            </button>
            <button
              type="button"
              className={`rounded p-1.5 text-xs font-semibold tabular-nums text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100 ${formatBarVisible ? 'bg-slate-100 text-slate-800 dark:bg-neutral-800 dark:text-neutral-100' : ''}`}
              onClick={() => setFormatBarVisible((v) => !v)}
              title={formatBarVisible ? 'Hide formatting' : 'Show formatting'}
              aria-label={formatBarVisible ? 'Hide formatting toolbar' : 'Show formatting toolbar'}
              aria-pressed={formatBarVisible}
            >
              Aa
            </button>
            <button
              type="button"
              className={fmtBtn}
              title="Use your system emoji picker (e.g. Ctrl+Cmd+Space on Mac)"
              aria-label="Emoji"
              onClick={() => {
                taRef.current?.focus()
              }}
            >
              <Smile className="h-4 w-4" strokeWidth={2} />
            </button>
            <button
              type="button"
              className={fmtBtn}
              title="Mention someone"
              aria-label="Mention"
              onClick={insertAtMention}
            >
              <AtSign className="h-4 w-4" strokeWidth={2} />
            </button>
            <span className={fmtSep} aria-hidden />
            <button
              type="button"
              className={fmtBtn}
              disabled
              title="Not available"
              aria-label="Video (not available)"
            >
              <Video className="h-4 w-4" strokeWidth={2} />
            </button>
            <button
              type="button"
              className={fmtBtn}
              disabled
              title="Not available"
              aria-label="Voice clip (not available)"
            >
              <Mic className="h-4 w-4" strokeWidth={2} />
            </button>
            <span className={fmtSep} aria-hidden />
            <button
              type="button"
              className={fmtBtn}
              disabled
              title="Not available"
              aria-label="Slash commands (not available)"
            >
              <SquareSlash className="h-4 w-4" strokeWidth={2} />
            </button>
            {imageBusy && (
              <span className="ml-1 text-xs text-slate-500 dark:text-neutral-400">Uploading…</span>
            )}
            {imageErr && (
              <span className="ml-1 text-xs text-rose-600 dark:text-rose-400">{imageErr}</span>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-0.5 pl-1">
            <button
              type="button"
              disabled={sendDisabled}
              onClick={() => onSubmit()}
              className="rounded-md p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-indigo-600 disabled:pointer-events-none disabled:opacity-35 dark:text-neutral-500 dark:hover:bg-neutral-800 dark:hover:text-indigo-400"
              aria-label="Send"
            >
              <Send className="h-5 w-5" strokeWidth={2} />
            </button>
            <button
              type="button"
              disabled
              className="rounded p-1 text-slate-300 dark:text-neutral-600"
              title="Scheduled send is not available"
              aria-label="Send options (not available)"
            >
              <ChevronDown className="h-4 w-4" strokeWidth={2} />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
