import { type FormEvent, useCallback, useEffect, useState } from 'react'
import {
  deleteCourseSection,
  fetchCourseSections,
  postCourseSection,
  putSectionAssignmentOverride,
  type CourseSection,
} from '../../lib/courses-api'
import { authorizedFetch } from '../../lib/api'
import { toastMutationError, toastSaveOk } from '../../lib/lms-toast'

type Props = {
  courseCode: string
}

type StructureItem = { id: string; kind: string; title: string }

export function CourseSectionsSettingsSection({ courseCode }: Props) {
  const [sections, setSections] = useState<CourseSection[] | null>(null)
  const [assignments, setAssignments] = useState<StructureItem[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [newCode, setNewCode] = useState('')
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)
  const [overrideSectionId, setOverrideSectionId] = useState('')
  const [overrideItemId, setOverrideItemId] = useState('')
  const [overrideDue, setOverrideDue] = useState('')

  const reload = useCallback(async () => {
    setLoadError(null)
    try {
      const list = await fetchCourseSections(courseCode)
      setSections(list)
    } catch (e) {
      setSections([])
      setLoadError(e instanceof Error ? e.message : 'Could not load sections.')
    }
  }, [courseCode])

  useEffect(() => {
    void reload()
  }, [reload])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await authorizedFetch(
          `/api/v1/courses/${encodeURIComponent(courseCode)}/structure`,
        )
        const raw: unknown = await res.json().catch(() => ({}))
        if (!res.ok || cancelled) return
        const items = (raw as { items?: unknown }).items
        if (!Array.isArray(items)) return
        const out: StructureItem[] = []
        for (const it of items) {
          if (!it || typeof it !== 'object') continue
          const o = it as Record<string, unknown>
          const id = typeof o.id === 'string' ? o.id : ''
          const kind = typeof o.kind === 'string' ? o.kind : ''
          const title = typeof o.title === 'string' ? o.title : ''
          if (id && kind === 'assignment') out.push({ id, kind, title })
        }
        if (!cancelled) setAssignments(out)
      } catch {
        if (!cancelled) setAssignments([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [courseCode])

  async function onCreate(e: FormEvent) {
    e.preventDefault()
    const code = newCode.trim()
    if (!code) return
    setBusy(true)
    try {
      await postCourseSection(courseCode, {
        sectionCode: code,
        name: newName.trim() || null,
      })
      setNewCode('')
      setNewName('')
      toastSaveOk('Section created')
      await reload()
    } catch (err) {
      toastMutationError(err instanceof Error ? err.message : 'Could not create section.')
    } finally {
      setBusy(false)
    }
  }

  async function onArchive(s: CourseSection) {
    if (!window.confirm(`Archive section ${s.sectionCode}?`)) return
    setBusy(true)
    try {
      await deleteCourseSection(courseCode, s.id)
      toastSaveOk('Section archived')
      await reload()
    } catch (err) {
      toastMutationError(err instanceof Error ? err.message : 'Could not archive.')
    } finally {
      setBusy(false)
    }
  }

  async function onSaveOverride(e: FormEvent) {
    e.preventDefault()
    if (!overrideSectionId || !overrideItemId) return
    const iso = overrideDue.trim()
      ? new Date(overrideDue).toISOString()
      : null
    if (overrideDue.trim() && Number.isNaN(new Date(overrideDue).getTime())) {
      toastMutationError('Invalid due date.')
      return
    }
    setBusy(true)
    try {
      await putSectionAssignmentOverride(overrideSectionId, overrideItemId, {
        dueAt: iso,
        availableFrom: null,
        availableUntil: null,
      })
      toastSaveOk('Due date override saved')
      setOverrideDue('')
    } catch (err) {
      toastMutationError(err instanceof Error ? err.message : 'Could not save override.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-8">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-950">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-neutral-100">Sections</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-neutral-400">
          No sections yet? Add sections to split your course roster. Each section can have its own
          instructor and optional due-date overrides on assignments.
        </p>
        {loadError && (
          <p className="mt-3 text-sm text-rose-700 dark:text-rose-400" role="alert">
            {loadError}
          </p>
        )}
        {sections === null && !loadError && (
          <p className="mt-4 text-sm text-slate-500 dark:text-neutral-400">Loading…</p>
        )}
        {sections && sections.length === 0 && !loadError && (
          <p className="mt-4 text-sm text-slate-600 dark:text-neutral-300">
            No sections yet. Create one below.
          </p>
        )}
        {sections && sections.length > 0 && (
          <ul className="mt-4 divide-y divide-slate-100 dark:divide-neutral-800">
            {sections.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div>
                  <p className="font-medium text-slate-900 dark:text-neutral-100">
                    {s.sectionCode}
                    {s.name ? <span className="text-slate-500"> — {s.name}</span> : null}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-neutral-400">
                    Status: {s.status}
                  </p>
                </div>
                {s.status !== 'archived' ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void onArchive(s)}
                    className="text-sm font-medium text-rose-600 hover:text-rose-500 disabled:opacity-50"
                  >
                    Archive
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={onCreate} className="mt-6 space-y-3 rounded-xl border border-slate-100 p-4 dark:border-neutral-800">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-neutral-400">
            Add section
          </p>
          <label className="block text-sm">
            <span className="text-slate-700 dark:text-neutral-300">Section code</span>
            <input
              value={newCode}
              onChange={(e) => setNewCode(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
              placeholder="001"
              required
            />
          </label>
          <label className="block text-sm">
            <span className="text-slate-700 dark:text-neutral-300">Name (optional)</span>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
              placeholder="Morning lab"
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            Create section
          </button>
        </form>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-950">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-neutral-100">
          Section due date override
        </h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-neutral-400">
          Pick a section and assignment, then set a due date that applies only to students in that
          section (overrides the course-level due date for learners in that section).
        </p>
        <form onSubmit={onSaveOverride} className="mt-4 space-y-3">
          <label className="block text-sm">
            <span className="text-slate-700 dark:text-neutral-300">Section</span>
            <select
              value={overrideSectionId}
              onChange={(e) => setOverrideSectionId(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
            >
              <option value="">Select…</option>
              {(sections ?? []).filter((s) => s.status === 'active').map((s) => (
                <option key={s.id} value={s.id}>
                  {s.sectionCode}
                  {s.name ? ` — ${s.name}` : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="text-slate-700 dark:text-neutral-300">Assignment</span>
            <select
              value={overrideItemId}
              onChange={(e) => setOverrideItemId(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
            >
              <option value="">Select…</option>
              {assignments.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.title}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="text-slate-700 dark:text-neutral-300">Due (local)</span>
            <input
              type="datetime-local"
              value={overrideDue}
              onChange={(e) => setOverrideDue(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
            />
          </label>
          <button
            type="submit"
            disabled={busy || !overrideSectionId || !overrideItemId}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            Save override
          </button>
        </form>
      </section>
    </div>
  )
}
