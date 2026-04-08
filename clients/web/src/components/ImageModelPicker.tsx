import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Loader2 } from 'lucide-react'
import { formatContextTokens, formatUsdPerMillion } from '../lib/aiModelDisplay'

export type ImageModelOption = {
  id: string
  name: string
  contextLength?: number | null
  inputPricePerMillionUsd?: number | null
  outputPricePerMillionUsd?: number | null
  modalitiesSummary?: string | null
}

function MetaLine({ m }: { m: ImageModelOption }) {
  const ctx = formatContextTokens(m.contextLength ?? null)
  const inn = formatUsdPerMillion(m.inputPricePerMillionUsd ?? null)
  const out = formatUsdPerMillion(m.outputPricePerMillionUsd ?? null)
  const mod = m.modalitiesSummary?.trim()

  return (
    <span className="text-xs leading-snug text-slate-500">
      {mod ? (
        <>
          {mod}
          <span className="mx-1 text-slate-400">·</span>
        </>
      ) : null}
      <span className="font-semibold text-slate-600">Context:</span> {ctx}
      <span className="mx-1 text-slate-400">·</span>
      <span className="font-semibold text-slate-600">In:</span> {inn}
      <span className="mx-1 text-slate-400">·</span>
      <span className="font-semibold text-slate-600">Out:</span> {out}
    </span>
  )
}

function filterModels(models: ImageModelOption[], query: string): ImageModelOption[] {
  const q = query.trim().toLowerCase()
  if (!q) return models
  return models.filter((m) => {
    if (m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q)) return true
    if (m.modalitiesSummary?.toLowerCase().includes(q)) return true
    return false
  })
}

/** OpenRouter free-tier models often use `:free`; some list $0 / 1M token pricing. */
function isFreeModel(m: ImageModelOption): boolean {
  if (m.id.includes(':free')) return true
  const inn = m.inputPricePerMillionUsd
  const out = m.outputPricePerMillionUsd
  if (inn == null || out == null) return false
  return Math.abs(inn) < 1e-9 && Math.abs(out) < 1e-9
}

/** Curated order (lower index = shown first when sorting by popularity). Covers common chat + image labs. */
const POPULARITY_PREFIX_ORDER: readonly string[] = [
  'openai/gpt-4o',
  'openai/chatgpt-4o',
  'openai/gpt-4-turbo',
  'anthropic/claude-3.5-sonnet',
  'anthropic/claude-3.7-sonnet',
  'anthropic/claude-sonnet-4',
  'anthropic/claude-3',
  'google/gemini-2.5',
  'google/gemini-2.0',
  'google/gemini-3',
  'meta-llama/llama-3.3',
  'meta-llama/llama-3.1',
  'deepseek/deepseek',
  'mistralai/mistral-large',
  'qwen/qwen',
  'x-ai/grok',
  'black-forest-labs/flux',
  'sourceful/riverflow',
  'bytedance-seed/seedream',
]

function popularityRank(id: string): number {
  const lower = id.toLowerCase()
  for (let i = 0; i < POPULARITY_PREFIX_ORDER.length; i++) {
    if (lower.startsWith(POPULARITY_PREFIX_ORDER[i].toLowerCase())) return i
  }
  return 500 + lower.charCodeAt(0)
}

function applyPillFiltersAndSort(
  models: ImageModelOption[],
  query: string,
  pillFree: boolean,
  pillPopularity: boolean,
): ImageModelOption[] {
  let list = filterModels(models, query)
  if (pillFree) {
    list = list.filter(isFreeModel)
  }
  if (pillPopularity) {
    list = [...list].sort((a, b) => {
      const ra = popularityRank(a.id)
      const rb = popularityRank(b.id)
      if (ra !== rb) return ra - rb
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    })
  }
  return list
}

type Props = {
  id: string
  label: string
  models: ImageModelOption[]
  value: string
  onChange: (modelId: string) => void
  disabled?: boolean
  /** Refetch OpenRouter list (e.g. when opening the menu or clicking refresh). */
  onRefresh?: () => void | Promise<void>
  refreshing?: boolean
}

export function ImageModelPicker({
  id,
  label,
  models,
  value,
  onChange,
  disabled,
  onRefresh,
  refreshing,
}: Props) {
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const [pillFree, setPillFree] = useState(false)
  const [pillPopularity, setPillPopularity] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const filterInputRef = useRef<HTMLInputElement>(null)

  const selected = models.find((m) => m.id === value)
  const unknownId = value && !selected

  const filteredModels = useMemo(
    () => applyPillFiltersAndSort(models, filter, pillFree, pillPopularity),
    [models, filter, pillFree, pillPopularity],
  )

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  useEffect(() => {
    if (!open) return
    const frame = requestAnimationFrame(() => {
      filterInputRef.current?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [open])

  function toggle() {
    if (disabled) return
    setOpen((o) => {
      if (!o) {
        setFilter('')
        setPillFree(false)
        setPillPopularity(false)
      }
      return !o
    })
  }

  const filterFieldId = `${id}-filter`

  return (
    <div ref={rootRef} className="relative">
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
        <label htmlFor={id} className="text-sm font-medium text-slate-700">
          {label}
        </label>
        {onRefresh && (
          <button
            type="button"
            onClick={() => void onRefresh()}
            disabled={disabled || refreshing}
            className="text-xs font-medium text-indigo-600 hover:text-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {refreshing ? (
              <span className="inline-flex items-center gap-1">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                Refreshing…
              </span>
            ) : (
              'Refresh list'
            )}
          </button>
        )}
      </div>

      <button
        type="button"
        id={id}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-listbox` : undefined}
        onClick={() => void toggle()}
        className="flex w-full items-start justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left text-sm outline-none ring-indigo-500/20 focus:border-indigo-400 focus:ring-2 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span className="min-w-0 flex-1">
          {unknownId ? (
            <>
              <span className="block font-semibold text-slate-400">Unknown model</span>
              <span className="mt-0.5 block font-mono text-xs text-slate-500">{value}</span>
            </>
          ) : selected ? (
            <>
              <span className="block font-semibold text-slate-900">{selected.name}</span>
              <span className="mt-0.5 block font-mono text-xs text-slate-500">{selected.id}</span>
            </>
          ) : (
            <span className="block text-slate-500">Choose a model…</span>
          )}
        </span>
        <ChevronDown
          className={`mt-0.5 h-4 w-4 shrink-0 text-slate-400 transition ${open ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </button>

      {open && (
        <div
          className="absolute z-50 mt-1 flex max-h-[min(60vh,22rem)] w-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg shadow-slate-900/10"
          id={`${id}-listbox`}
        >
          <div className="shrink-0 border-b border-slate-100 bg-white px-2 py-2">
            <label htmlFor={filterFieldId} className="sr-only">
              Filter models
            </label>
            <input
              ref={filterInputRef}
              id={filterFieldId}
              type="search"
              role="searchbox"
              autoComplete="off"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter models…"
              className="w-full rounded-lg border border-slate-200 bg-slate-50/80 px-2.5 py-2 text-sm text-slate-900 outline-none ring-indigo-500/20 placeholder:text-slate-400 focus:border-indigo-400 focus:bg-white focus:ring-2"
              onMouseDown={(e) => e.stopPropagation()}
            />
            <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Quick filters">
              <button
                type="button"
                aria-pressed={pillFree}
                onClick={() => setPillFree((v) => !v)}
                onMouseDown={(e) => e.stopPropagation()}
                className={`rounded-full border px-2 py-0.5 text-xs font-medium transition ${
                  pillFree
                    ? 'border-indigo-300 bg-indigo-100 text-indigo-900'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                Free
              </button>
              <button
                type="button"
                aria-pressed={pillPopularity}
                onClick={() => setPillPopularity((v) => !v)}
                onMouseDown={(e) => e.stopPropagation()}
                className={`rounded-full border px-2 py-0.5 text-xs font-medium transition ${
                  pillPopularity
                    ? 'border-indigo-300 bg-indigo-100 text-indigo-900'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                Popularity
              </button>
            </div>
          </div>
          <ul
            role="listbox"
            aria-labelledby={id}
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-1"
          >
            {unknownId && (
              <li role="presentation" className="border-b border-slate-100 px-3 py-2.5">
                <span className="block text-xs font-medium text-amber-800">
                  Saved model (not in current list)
                </span>
                <span className="mt-0.5 block font-mono text-xs text-slate-600">{value}</span>
              </li>
            )}
            {filteredModels.map((m) => {
              const isSel = m.id === value
              return (
                <li key={m.id} role="option" aria-selected={isSel}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange(m.id)
                      setOpen(false)
                    }}
                    className={`w-full px-3 py-2.5 text-left transition hover:bg-slate-50 ${
                      isSel ? 'bg-indigo-50/80' : ''
                    }`}
                  >
                    <span className="block font-semibold text-slate-900">{m.name}</span>
                    <span className="mt-0.5 block font-mono text-xs text-slate-500">{m.id}</span>
                    <span className="mt-1 block">
                      <MetaLine m={m} />
                    </span>
                  </button>
                </li>
              )
            })}
            {filteredModels.length === 0 && (
              <li className="px-3 py-6 text-center text-sm text-slate-500">No models match your filter.</li>
            )}
          </ul>
        </div>
      )}
    </div>
  )
}
