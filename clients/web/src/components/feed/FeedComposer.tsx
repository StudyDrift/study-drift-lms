import { ImagePlus } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FeedRosterPerson } from '../../lib/courseFeedApi'
import { rosterMentionLabels, uploadFeedImage } from '../../lib/courseFeedApi'

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
      onSubmit()
    }
  }

  return (
    <div className="relative flex min-w-0 flex-1 flex-col gap-1">
      {picker && rows.length > 0 && (
        <ul
          className="absolute bottom-full left-0 z-20 mb-1 max-h-52 w-full max-w-md overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 text-sm shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
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
                    <span className="font-medium text-amber-900 dark:text-amber-100">@everyone</span>
                    <span className="ml-2 text-xs text-slate-500 dark:text-neutral-400">Notify the class</span>
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
                  <span className="text-xs text-slate-500 dark:text-neutral-400">{row.person.email}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
      <textarea
        ref={taRef}
        value={value}
        disabled={disabled || imageBusy}
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
        rows={3}
        placeholder={placeholder}
        className="min-h-[4.5rem] w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
        maxLength={8000}
      />
      <div className="flex flex-wrap items-center gap-2">
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
          disabled={disabled || imageBusy}
          onClick={() => fileRef.current?.click()}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-40 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
          title="Attach image"
          aria-label="Attach image"
        >
          <ImagePlus className="h-4 w-4 shrink-0" aria-hidden />
          Image
        </button>
        {imageBusy && (
          <span className="text-xs text-slate-500 dark:text-neutral-400">Uploading…</span>
        )}
        {imageErr && (
          <span className="text-xs text-rose-600 dark:text-rose-400">{imageErr}</span>
        )}
      </div>
    </div>
  )
}
