import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { ArrowDown, ArrowUp, BookOpen, FileText, Search, Users, Zap } from 'lucide-react'
import { usePermissions } from '../../context/usePermissions'
import {
  buildSearchItems,
  filterSearchItems,
  SEARCH_GROUP_LABEL,
  type SearchGroup,
  type SearchListItem,
} from '../../lib/buildSearchItems'
import { fetchSearchIndex, type SearchCourseItem, type SearchPersonItem } from '../../lib/searchApi'
import { useCommandPalette } from './useCommandPalette'

const GROUP_ICONS: Record<SearchGroup, typeof BookOpen> = {
  action: Zap,
  course: BookOpen,
  person: Users,
  page: FileText,
}

export function CommandPaletteDialog() {
  const { close } = useCommandPalette()
  const navigate = useNavigate()
  const { allows } = usePermissions()
  const inputRef = useRef<HTMLInputElement>(null)
  const activeRowRef = useRef<HTMLButtonElement | null>(null)

  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const [courses, setCourses] = useState<SearchCourseItem[]>([])
  const [people, setPeople] = useState<SearchPersonItem[]>([])
  const [loadState, setLoadState] = useState<'loading' | 'error' | 'ready'>('loading')

  useEffect(() => {
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prevOverflow
    }
  }, [])

  useEffect(() => {
    void fetchSearchIndex()
      .then((data) => {
        setCourses(data.courses)
        setPeople(data.people)
        setLoadState('ready')
      })
      .catch(() => {
        setLoadState('error')
        setCourses([])
        setPeople([])
      })
  }, [])

  useEffect(() => {
    const t = window.setTimeout(() => inputRef.current?.focus(), 0)
    return () => window.clearTimeout(t)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        close()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [close])

  const allItems = useMemo(
    () => buildSearchItems(courses, people, allows),
    [courses, people, allows],
  )

  const filtered = useMemo(() => filterSearchItems(allItems, query), [allItems, query])

  const safeIndex =
    filtered.length === 0 ? 0 : Math.min(cursor, Math.max(0, filtered.length - 1))

  useLayoutEffect(() => {
    activeRowRef.current?.scrollIntoView({ block: 'nearest' })
  }, [safeIndex, filtered])

  const go = (item: SearchListItem) => {
    navigate(item.path)
    close()
  }

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (filtered.length === 0) return
      setCursor((c) => {
        const at = Math.min(c, filtered.length - 1)
        return (at + 1) % filtered.length
      })
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (filtered.length === 0) return
      setCursor((c) => {
        const at = Math.min(c, filtered.length - 1)
        return (at - 1 + filtered.length) % filtered.length
      })
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      const item = filtered[safeIndex]
      if (item) go(item)
    }
  }

  const palette = (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center px-3 pt-12 pb-[env(safe-area-inset-bottom)] sm:px-4 sm:pt-[min(12vh,8rem)]"
      role="dialog"
      aria-modal="true"
      aria-label="Search"
    >
      <button
        type="button"
        className="absolute inset-0 cursor-default bg-slate-950/55 backdrop-blur-md dark:bg-neutral-950/75"
        aria-label="Close search"
        onClick={() => close()}
      />
      <div className="relative z-10 w-full max-w-xl overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-2xl shadow-slate-900/20 dark:border-neutral-700 dark:bg-neutral-900 dark:shadow-black/50">
        <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-3 dark:border-neutral-700">
          <Search className="h-5 w-5 shrink-0 text-slate-400 dark:text-neutral-500" aria-hidden />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setCursor(0)
            }}
            onKeyDown={onInputKeyDown}
            placeholder="Search courses, people, pages, actions…"
            className="min-w-0 flex-1 border-0 bg-transparent text-base text-slate-900 outline-none placeholder:text-slate-500 dark:text-neutral-100 dark:placeholder:text-neutral-500"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            aria-controls="command-palette-results"
            aria-activedescendant={
              filtered[safeIndex] ? `cmd-result-${filtered[safeIndex].id}` : undefined
            }
          />
          <kbd className="hidden shrink-0 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 font-mono text-[11px] text-slate-500 sm:inline dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
            esc
          </kbd>
        </div>

        <div
          id="command-palette-results"
          role="listbox"
          aria-label="Results"
          className="max-h-[min(60vh,420px)] overflow-y-auto px-2 py-2"
        >
          {loadState === 'loading' && (
            <p className="px-3 py-8 text-center text-sm text-slate-500 dark:text-neutral-400">Loading…</p>
          )}
          {loadState === 'error' && (
            <p className="px-3 py-8 text-center text-sm text-rose-600 dark:text-rose-400">
              Could not load search.
            </p>
          )}
          {loadState === 'ready' && filtered.length === 0 && (
            <p className="px-3 py-8 text-center text-sm text-slate-500 dark:text-neutral-400">No results.</p>
          )}
          {loadState === 'ready' &&
            filtered.map((item, idx) => {
              const showHeader = idx === 0 || filtered[idx - 1]!.group !== item.group
              const Icon = GROUP_ICONS[item.group]
              const selected = idx === safeIndex
              return (
                <div key={item.id}>
                  {showHeader && (
                    <div className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-neutral-400">
                      {SEARCH_GROUP_LABEL[item.group]}
                    </div>
                  )}
                  <button
                    id={`cmd-result-${item.id}`}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    ref={selected ? activeRowRef : undefined}
                    className={`flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition ${
                      selected
                        ? 'bg-indigo-50 text-slate-900 dark:bg-indigo-950/70 dark:text-neutral-100'
                        : 'text-slate-700 hover:bg-slate-50 dark:text-neutral-300 dark:hover:bg-neutral-800/80'
                    }`}
                    onMouseEnter={() => setCursor(idx)}
                    onClick={() => go(item)}
                  >
                    <Icon
                      className={`mt-0.5 h-4 w-4 shrink-0 ${
                        selected
                          ? 'text-indigo-600 dark:text-indigo-400'
                          : 'text-slate-400 dark:text-neutral-500'
                      }`}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium leading-snug">{item.title}</span>
                      <span className="block text-xs text-slate-500 dark:text-neutral-400">{item.subtitle}</span>
                    </span>
                  </button>
                </div>
              )
            })}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-4 py-2 text-[11px] text-slate-500 dark:border-neutral-700 dark:text-neutral-400">
          <span className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1">
              <ArrowUp className="h-3.5 w-3.5 opacity-90" aria-hidden />
              <ArrowDown className="h-3.5 w-3.5 opacity-90" aria-hidden />
              Navigate
            </span>
            <span className="inline-flex items-center gap-1">
              <kbd className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
                ↵
              </kbd>
              Open
            </span>
          </span>
        </div>
      </div>
    </div>
  )

  return createPortal(palette, document.body)
}
