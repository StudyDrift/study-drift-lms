import { useCallback, useEffect, useRef, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { courseStructureAiAssist } from '../../lib/coursesApi'
import type { CourseStructureItem } from '../../lib/coursesApi'

type CourseModulesAiPanelProps = {
  courseCode: string
  onApplied: (items: CourseStructureItem[]) => void
  disabled: boolean
  onBusyChange?: (busy: boolean) => void
}

export function CourseModulesAiPanel({
  courseCode,
  onApplied,
  disabled,
  onBusyChange,
}: CourseModulesAiPanelProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  useEffect(() => {
    onBusyChange?.(busy)
  }, [busy, onBusyChange])

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  const submit = useCallback(async () => {
    const msg = prompt.trim()
    if (!msg || busy || disabled) return
    setBusy(true)
    setError(null)
    setNote(null)
    try {
      const res = await courseStructureAiAssist(courseCode, { message: msg })
      onApplied(res.items)
      setNote(res.assistantMessage?.trim() || null)
      setPrompt('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not apply AI changes.')
    } finally {
      setBusy(false)
    }
  }, [busy, courseCode, disabled, onApplied, prompt])

  return (
    <div className="mt-6 w-full">
      <div className="rounded-xl border border-slate-200/80 bg-white p-3 shadow-sm">
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-indigo-600">
          <Sparkles className="h-3.5 w-3.5" aria-hidden />
          Course Designer
        </div>
        <label htmlFor="course-modules-ai-prompt" className="sr-only">
          Course Designer — describe changes to modules
        </label>
        <textarea
          ref={textareaRef}
          id="course-modules-ai-prompt"
          rows={3}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          disabled={disabled || busy}
          placeholder="Ask the AI to add modules, headings, pages, or reorder items…"
          className="min-h-[4.75rem] w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-400/30 disabled:cursor-not-allowed disabled:opacity-60"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              void submit()
            }
          }}
        />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-slate-500">
            <kbd className="rounded border border-slate-200 bg-slate-50 px-1 font-mono text-[0.7rem]">
              ⌘
            </kbd>
            <span className="mx-0.5">+</span>
            <kbd className="rounded border border-slate-200 bg-slate-50 px-1 font-mono text-[0.7rem]">
              Enter
            </kbd>
            <span className="ml-1">to send</span>
          </p>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={disabled || busy || !prompt.trim()}
            className="inline-flex items-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? 'Working…' : 'Send'}
          </button>
        </div>
        {error && (
          <p className="mt-2 text-sm text-rose-700" role="alert">
            {error}
          </p>
        )}
        {note && !error && (
          <p className="mt-2 text-sm text-slate-600" role="status">
            {note}
          </p>
        )}
      </div>
    </div>
  )
}
