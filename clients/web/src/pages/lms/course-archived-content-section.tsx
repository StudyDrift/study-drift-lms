import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { X } from 'lucide-react'
import { usePermissions } from '../../context/use-permissions'
import {
  courseItemCreatePermission,
  fetchCourseArchivedStructure,
  patchCourseArchived,
  postFactoryResetCourse,
  unarchiveCourseStructureItem,
  type CourseStructureItem,
} from '../../lib/courses-api'
import { toastWithUndo } from '../../lib/lms-toast'

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
    case 'external_link':
      return 'External link'
    default:
      return kind
  }
}

export function CourseArchivedContentSection({ courseCode }: { courseCode: string }) {
  const navigate = useNavigate()
  const { allows, loading: permLoading } = usePermissions()
  const canEdit = !permLoading && allows(courseItemCreatePermission(courseCode))

  const [items, setItems] = useState<CourseStructureItem[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [deleteCourseConfirmOpen, setDeleteCourseConfirmOpen] = useState(false)
  const [factoryResetConfirmOpen, setFactoryResetConfirmOpen] = useState(false)
  const [archiveCourseBusy, setArchiveCourseBusy] = useState(false)
  const [factoryResetBusy, setFactoryResetBusy] = useState(false)

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

  useEffect(() => {
    if (!deleteCourseConfirmOpen && !factoryResetConfirmOpen) return
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      if (archiveCourseBusy || factoryResetBusy) return
      e.preventDefault()
      setDeleteCourseConfirmOpen(false)
      setFactoryResetConfirmOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [deleteCourseConfirmOpen, factoryResetConfirmOpen, archiveCourseBusy, factoryResetBusy])

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
          i.kind === 'quiz' ||
          i.kind === 'external_link'),
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

  async function confirmArchiveCourse() {
    setActionError(null)
    setArchiveCourseBusy(true)
    try {
      await patchCourseArchived(courseCode, true)
      setDeleteCourseConfirmOpen(false)
      toastWithUndo('Course archived.', {
        onUndo: async () => {
          await patchCourseArchived(courseCode, false)
        },
      })
      navigate('/courses', { replace: true })
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Could not archive course.')
    } finally {
      setArchiveCourseBusy(false)
    }
  }

  async function confirmFactoryReset() {
    setActionError(null)
    setFactoryResetBusy(true)
    try {
      await postFactoryResetCourse(courseCode)
      setFactoryResetConfirmOpen(false)
      navigate(`/courses/${encodeURIComponent(courseCode)}/modules`, { replace: true })
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Could not reset course.')
    } finally {
      setFactoryResetBusy(false)
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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <p className="text-sm text-slate-600 dark:text-neutral-400">
          Archived module items are hidden from students but stay in the course. Restoring an item
          returns it to the module outline.
        </p>
        <div className="flex shrink-0 flex-wrap gap-2 self-start">
          <button
            type="button"
            onClick={() => setFactoryResetConfirmOpen(true)}
            disabled={archiveCourseBusy || factoryResetBusy}
            className="rounded-xl border border-amber-200 bg-white px-4 py-2.5 text-sm font-semibold text-amber-900 shadow-sm transition hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-amber-900/50 dark:bg-neutral-900/40 dark:text-amber-200 dark:hover:bg-amber-950/30"
          >
            Factory Reset Course
          </button>
          <button
            type="button"
            onClick={() => setDeleteCourseConfirmOpen(true)}
            disabled={archiveCourseBusy || factoryResetBusy}
            className="rounded-xl border border-rose-200 bg-white px-4 py-2.5 text-sm font-semibold text-rose-700 shadow-sm transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-rose-900/60 dark:bg-neutral-900/40 dark:text-rose-300 dark:hover:bg-rose-950/40"
          >
            Delete Course
          </button>
        </div>
      </div>
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

      {factoryResetConfirmOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 dark:bg-black/50"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !factoryResetBusy) setFactoryResetConfirmOpen(false)
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="factory-reset-course-title"
            className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-neutral-700 dark:bg-neutral-900"
          >
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-neutral-700">
              <h3
                id="factory-reset-course-title"
                className="text-sm font-semibold text-slate-900 dark:text-neutral-100"
              >
                Factory reset course
              </h3>
              <button
                type="button"
                onClick={() => {
                  if (!factoryResetBusy) setFactoryResetConfirmOpen(false)
                }}
                disabled={factoryResetBusy}
                className="shrink-0 rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-50 dark:text-neutral-400 dark:hover:bg-neutral-700 dark:hover:text-neutral-200"
                aria-label="Close"
              >
                <X className="h-5 w-5" aria-hidden />
              </button>
            </div>
            <div className="p-4">
              <p className="text-sm leading-relaxed text-slate-600 dark:text-neutral-300">
                This permanently deletes all modules, pages, assignments, quizzes, links, the
                syllabus, uploaded course files, and archived items. Grading is reset to a single
                default group. The course stays open with the same enrollments; title and schedule
                settings are not changed.
              </p>
              <div className="mt-5 flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setFactoryResetConfirmOpen(false)}
                  disabled={factoryResetBusy}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700/80"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void confirmFactoryReset()}
                  disabled={factoryResetBusy}
                  className="rounded-xl bg-amber-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-amber-600 dark:hover:bg-amber-500"
                >
                  {factoryResetBusy ? 'Resetting…' : 'Reset course'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {deleteCourseConfirmOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 dark:bg-black/50"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !archiveCourseBusy) setDeleteCourseConfirmOpen(false)
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="archive-course-title"
            className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-neutral-700 dark:bg-neutral-900"
          >
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-neutral-700">
              <h3
                id="archive-course-title"
                className="text-sm font-semibold text-slate-900 dark:text-neutral-100"
              >
                Delete course
              </h3>
              <button
                type="button"
                onClick={() => {
                  if (!archiveCourseBusy) setDeleteCourseConfirmOpen(false)
                }}
                disabled={archiveCourseBusy}
                className="shrink-0 rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-50 dark:text-neutral-400 dark:hover:bg-neutral-700 dark:hover:text-neutral-200"
                aria-label="Close"
              >
                <X className="h-5 w-5" aria-hidden />
              </button>
            </div>
            <div className="p-4">
              <p className="text-sm leading-relaxed text-slate-600 dark:text-neutral-300">
                This archives the entire course. It will disappear from your course list, home
                dashboard, and search. Your content is kept on the server.
              </p>
              <div className="mt-5 flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setDeleteCourseConfirmOpen(false)}
                  disabled={archiveCourseBusy}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700/80"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void confirmArchiveCourse()}
                  disabled={archiveCourseBusy}
                  className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-rose-600 dark:hover:bg-rose-500"
                >
                  {archiveCourseBusy ? 'Archiving…' : 'Archive course'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
