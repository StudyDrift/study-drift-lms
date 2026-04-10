import { useCallback, useEffect, useMemo, useState } from 'react'
import { usePermissions } from '../../context/usePermissions'
import {
  courseItemCreatePermission,
  fetchCourseArchivedStructure,
  unarchiveCourseStructureItem,
  type CourseStructureItem,
} from '../../lib/coursesApi'

function kindLabel(kind: CourseStructureItem['kind']): string {
  switch (kind) {
    case 'heading':
      return 'Heading'
    case 'content_page':
      return 'Page'
    case 'assignment':
      return 'Assignment'
    case 'quiz':
      return 'Quiz'
    default:
      return kind
  }
}

export function CourseArchivedContentSection({ courseCode }: { courseCode: string }) {
  const { allows, loading: permLoading } = usePermissions()
  const canEdit = !permLoading && allows(courseItemCreatePermission(courseCode))

  const [items, setItems] = useState<CourseStructureItem[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoadError(null)
    try {
      const all = await fetchCourseArchivedStructure(courseCode)
      setItems(all)
    } catch (e) {
      setItems(null)
      setLoadError(e instanceof Error ? e.message : 'Could not load course structure.')
    }
  }, [courseCode])

  useEffect(() => {
    void load()
  }, [load])

  const moduleTitleById = useMemo(() => {
    const m = new Map<string, string>()
    if (!items) return m
    for (const i of items) {
      if (i.kind === 'module' && i.parentId === null) {
        m.set(i.id, i.title)
      }
    }
    return m
  }, [items])

  const archivedRows = useMemo(() => {
    if (!items) return []
    return items.filter(
      (i) =>
        i.archived &&
        i.parentId != null &&
        (i.kind === 'heading' ||
          i.kind === 'content_page' ||
          i.kind === 'assignment' ||
          i.kind === 'quiz'),
    )
  }, [items])

  async function onUnarchive(row: CourseStructureItem) {
    setActionError(null)
    setBusyId(row.id)
    try {
      await unarchiveCourseStructureItem(courseCode, row.id)
      await load()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Could not restore item.')
    } finally {
      setBusyId(null)
    }
  }

  if (!canEdit) {
    return (
      <p className="text-sm text-slate-600 dark:text-neutral-400">
        You need permission to edit course modules to view or restore archived content.
      </p>
    )
  }

  if (loadError) {
    return (
      <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-200">
        {loadError}
      </p>
    )
  }

  if (items === null) {
    return <p className="text-sm text-slate-500">Loading…</p>
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600 dark:text-neutral-400">
        Archived module items are hidden from students but stay in the course. Restoring an item
        returns it to the module outline.
      </p>
      {actionError && (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-200">
          {actionError}
        </p>
      )}
      {archivedRows.length === 0 ? (
        <p className="text-sm text-slate-500">No archived content.</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-900/5 dark:border-neutral-700 dark:bg-neutral-900/40">
          <table className="min-w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/80 dark:border-neutral-700 dark:bg-neutral-800/50">
                <th className="px-4 py-3 font-semibold text-slate-900 dark:text-neutral-100">
                  Title
                </th>
                <th className="px-4 py-3 font-semibold text-slate-900 dark:text-neutral-100">Type</th>
                <th className="px-4 py-3 font-semibold text-slate-900 dark:text-neutral-100">
                  Module
                </th>
                <th className="px-4 py-3 font-semibold text-slate-900 dark:text-neutral-100">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {archivedRows.map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-slate-100 last:border-0 dark:border-neutral-800"
                >
                  <td className="px-4 py-3 font-medium text-slate-900 dark:text-neutral-100">
                    {row.title || '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-600 dark:text-neutral-400">
                    {kindLabel(row.kind)}
                  </td>
                  <td className="px-4 py-3 text-slate-600 dark:text-neutral-400">
                    {row.parentId ? moduleTitleById.get(row.parentId) ?? '—' : '—'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => void onUnarchive(row)}
                      disabled={busyId === row.id}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100 dark:hover:bg-neutral-700"
                    >
                      {busyId === row.id ? 'Restoring…' : 'Unarchive'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
