import { useEffect, useId, useState } from 'react'
import { X } from 'lucide-react'

function isoToDatetimeLocalValue(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function datetimeLocalValueToIso(value: string): string | null {
  const t = value.trim()
  if (!t) return null
  const d = new Date(t)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString()
}

type ModuleSettingsModalProps = {
  open: boolean
  initialTitle: string
  initialPublished: boolean
  initialVisibleFrom: string | null
  onClose: () => void
  onSave: (payload: { title: string; published: boolean; visibleFrom: string | null }) => void | Promise<void>
  saving?: boolean
  errorMessage?: string | null
}

export function ModuleSettingsModal({
  open,
  initialTitle,
  initialPublished,
  initialVisibleFrom,
  onClose,
  onSave,
  saving = false,
  errorMessage,
}: ModuleSettingsModalProps) {
  const titleId = useId()
  const nameInputId = useId()
  const dateInputId = useId()
  const [title, setTitle] = useState('')
  const [published, setPublished] = useState(true)
  const [visibleLocal, setVisibleLocal] = useState('')

  useEffect(() => {
    if (open) {
      setTitle(initialTitle)
      setPublished(initialPublished)
      setVisibleLocal(isoToDatetimeLocalValue(initialVisibleFrom))
    }
  }, [open, initialTitle, initialPublished, initialVisibleFrom])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={(e) => {
        if (e.target === e.currentTarget && !saving) onClose()
      }}
    >
      <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h3 id={titleId} className="text-sm font-semibold text-slate-900">
            Module settings
          </h3>
          <button
            type="button"
            onClick={() => onClose()}
            disabled={saving}
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <form
          className="p-4"
          onSubmit={(e) => {
            e.preventDefault()
            const t = title.trim()
            if (!t || saving) return
            void onSave({
              title: t,
              published,
              visibleFrom: datetimeLocalValueToIso(visibleLocal),
            })
          }}
        >
          <label htmlFor={nameInputId} className="text-xs font-medium text-slate-600">
            Module name
          </label>
          <input
            id={nameInputId}
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Week 1 — Introduction"
            autoFocus
            disabled={saving}
            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none ring-indigo-500/20 placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 disabled:cursor-not-allowed disabled:opacity-60"
          />

          <div className="mt-4 flex items-center gap-3">
            <input
              id="module-settings-published"
              type="checkbox"
              checked={published}
              onChange={(e) => setPublished(e.target.checked)}
              disabled={saving}
              className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
            />
            <label htmlFor="module-settings-published" className="text-sm text-slate-700">
              Published to students
            </label>
          </div>

          <label htmlFor={dateInputId} className="mt-4 block text-xs font-medium text-slate-600">
            Visible from (optional)
          </label>
          <p className="mt-0.5 text-xs text-slate-500">
            Leave empty to show as soon as the module is published. Otherwise students see it starting at
            this date and time (your local timezone).
          </p>
          <input
            id={dateInputId}
            type="datetime-local"
            value={visibleLocal}
            onChange={(e) => setVisibleLocal(e.target.value)}
            disabled={saving}
            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none ring-indigo-500/20 focus:border-indigo-400 focus:ring-2 disabled:cursor-not-allowed disabled:opacity-60"
          />

          {errorMessage && (
            <p className="mt-3 text-sm text-rose-700" role="status">
              {errorMessage}
            </p>
          )}
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => onClose()}
              disabled={saving}
              className="rounded-xl px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !title.trim()}
              className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
