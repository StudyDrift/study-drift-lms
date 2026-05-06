import { type FormEvent, useCallback, useEffect, useState } from 'react'
import {
  deleteBlueprintChildLink,
  fetchBlueprintChildren,
  fetchBlueprintSyncLogs,
  patchCourseBlueprint,
  postBlueprintChildLink,
  postBlueprintPush,
  type BlueprintChildRow,
  type BlueprintPushResult,
  type BlueprintSyncLogRow,
  type CoursePublic,
} from '../../lib/courses-api'
import { PERM_RBAC_MANAGE, PERM_TENANT_ORG_UNITS_ADMIN } from '../../lib/rbac-api'
import { usePermissions } from '../../context/use-permissions'
import { toastMutationError, toastSaveOk } from '../../lib/lms-toast'

type Props = {
  courseCode: string
  course: CoursePublic
  onCourseUpdated: (c: CoursePublic) => void
}

function formatSyncAt(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString()
}

export function CourseBlueprintSection({ courseCode, course, onCourseUpdated }: Props) {
  const { allows, loading: permLoading } = usePermissions()
  const canOrgBlueprint =
    !permLoading && (allows(PERM_RBAC_MANAGE) || allows(PERM_TENANT_ORG_UNITS_ADMIN))

  const [children, setChildren] = useState<BlueprintChildRow[] | null>(null)
  const [logs, setLogs] = useState<BlueprintSyncLogRow[] | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [childPick, setChildPick] = useState('')
  const [pushResult, setPushResult] = useState<BlueprintPushResult | null>(null)

  const reload = useCallback(async () => {
    if (!canOrgBlueprint || !course.isBlueprint) {
      setChildren([])
      setLogs([])
      return
    }
    setLoadErr(null)
    try {
      const [ch, lg] = await Promise.all([
        fetchBlueprintChildren(courseCode),
        fetchBlueprintSyncLogs(courseCode),
      ])
      setChildren(ch)
      setLogs(lg)
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : 'Could not load blueprint data.')
      setChildren([])
      setLogs([])
    }
  }, [canOrgBlueprint, course.isBlueprint, courseCode])

  useEffect(() => {
    void reload()
  }, [reload])

  async function onToggleBlueprint(e: FormEvent) {
    e.preventDefault()
    if (!course.orgId) return
    setBusy(true)
    try {
      const next = !course.isBlueprint
      const updated = await patchCourseBlueprint(courseCode, next)
      onCourseUpdated(updated)
      toastSaveOk(next ? 'Course marked as blueprint' : 'Blueprint designation removed')
      await reload()
    } catch (err) {
      toastMutationError(err instanceof Error ? err.message : 'Could not update blueprint flag.')
    } finally {
      setBusy(false)
    }
  }

  async function onLinkChild(e: FormEvent) {
    e.preventDefault()
    const code = childPick.trim()
    if (!code) return
    setBusy(true)
    try {
      await postBlueprintChildLink(courseCode, code)
      setChildPick('')
      toastSaveOk('Child course linked and initial sync completed')
      await reload()
    } catch (err) {
      toastMutationError(err instanceof Error ? err.message : 'Could not link child course.')
    } finally {
      setBusy(false)
    }
  }

  async function onUnlink(cc: string) {
    if (!window.confirm(`Unlink ${cc} from this blueprint? Copied course content is not removed.`)) return
    setBusy(true)
    try {
      await deleteBlueprintChildLink(courseCode, cc)
      toastSaveOk('Course unlinked')
      await reload()
    } catch (err) {
      toastMutationError(err instanceof Error ? err.message : 'Could not unlink.')
    } finally {
      setBusy(false)
    }
  }

  async function onPush() {
    setBusy(true)
    setPushResult(null)
    try {
      const res = await postBlueprintPush(courseCode)
      setPushResult(res)
      toastSaveOk(`Push finished: ${res.childrenSuccess} ok, ${res.childrenError} errors`)
      await reload()
    } catch (err) {
      toastMutationError(err instanceof Error ? err.message : 'Push failed.')
    } finally {
      setBusy(false)
    }
  }

  if (!course.orgId || !canOrgBlueprint) {
    return (
      <section className="mt-10 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-neutral-700 dark:bg-neutral-900">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-neutral-100">Blueprint</h2>
        <p className="mt-2 text-sm text-slate-600 dark:text-neutral-300">
          Org administrators manage district blueprint courses here. Ask your platform admin for access.
        </p>
      </section>
    )
  }

  return (
    <section className="mt-10 space-y-8">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-neutral-700 dark:bg-neutral-900">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-neutral-100">Blueprint</h2>
        <p className="mt-2 text-sm text-slate-600 dark:text-neutral-300">
          Designate a master course and push structural updates to linked child courses. Teachers keep local
          items they add outside the blueprint copy.
        </p>
        {course.blueprintParentCourseCode ? (
          <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-500/40 dark:bg-amber-950/40 dark:text-amber-100">
            This course is linked to blueprint{' '}
            <span className="font-mono font-semibold">{course.blueprintParentCourseCode}</span>.
            Last sync: {formatSyncAt(course.blueprintLastSyncAt ?? null)}.
          </p>
        ) : null}
        <form className="mt-4 flex flex-wrap items-center gap-3" onSubmit={onToggleBlueprint}>
          <button
            type="submit"
            disabled={busy || Boolean(course.blueprintParentCourseCode)}
            className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {course.isBlueprint ? 'Remove blueprint designation' : 'Mark as blueprint course'}
          </button>
          {course.blueprintParentCourseCode ? (
            <span className="text-xs text-slate-500 dark:text-neutral-400">
              Child courses cannot be toggled as blueprints until unlinked.
            </span>
          ) : (
            <span className="text-xs text-slate-500 dark:text-neutral-400" aria-live="polite">
              {course.isBlueprint ? 'Blueprint mode on — link empty child courses below.' : 'Off'}
            </span>
          )}
        </form>
      </div>

      {course.isBlueprint ? (
        <>
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-neutral-700 dark:bg-neutral-900">
            <h3 className="text-base font-semibold text-slate-900 dark:text-neutral-100">Linked child courses</h3>
            <p className="mt-2 text-sm text-slate-600 dark:text-neutral-300">
              Child shells must have no modules yet. Linking copies all blueprint modules and items once.
            </p>
            {loadErr ? <p className="mt-2 text-sm text-red-600">{loadErr}</p> : null}
            <form className="mt-4 flex flex-wrap items-end gap-2" onSubmit={onLinkChild}>
              <label className="block min-w-[220px] flex-1">
                <span className="text-xs font-medium text-slate-600 dark:text-neutral-400">Child course code</span>
                <input
                  value={childPick}
                  onChange={(e) => setChildPick(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm dark:border-neutral-600 dark:bg-neutral-950"
                  placeholder="e.g. C-ABCDEF"
                  autoComplete="off"
                />
              </label>
              <button
                type="submit"
                disabled={busy || !childPick.trim()}
                className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-white"
              >
                Link &amp; sync
              </button>
            </form>
            {children && children.length === 0 ? (
              <p className="mt-6 text-sm text-slate-500 dark:text-neutral-400">
                No child courses linked. Link existing courses to distribute this blueprint&apos;s content.
              </p>
            ) : null}
            {children && children.length > 0 ? (
              <ul className="mt-4 divide-y divide-slate-100 dark:divide-neutral-700">
                {children.map((c) => (
                  <li key={c.courseCode} className="flex flex-wrap items-center justify-between gap-2 py-3">
                    <div>
                      <p className="font-mono text-sm font-semibold text-slate-900 dark:text-neutral-100">
                        {c.courseCode}
                      </p>
                      <p className="text-xs text-slate-600 dark:text-neutral-400">{c.title}</p>
                      <p className="text-xs text-slate-500 dark:text-neutral-500">
                        Last sync: {formatSyncAt(c.lastSyncAt ?? null)}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void onUnlink(c.courseCode)}
                      className="text-sm font-medium text-red-600 hover:text-red-500 disabled:opacity-50"
                    >
                      Unlink
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-neutral-700 dark:bg-neutral-900">
            <h3 className="text-base font-semibold text-slate-900 dark:text-neutral-100">Push updates</h3>
            <p className="mt-2 text-sm text-slate-600 dark:text-neutral-300">
              Applies blueprint changes to all linked children. Locally added items in children are preserved.
            </p>
            <button
              type="button"
              disabled={busy || !children?.length}
              onClick={() => void onPush()}
              className="mt-4 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? 'Working…' : 'Push updates to all children'}
            </button>
            {pushResult ? (
              <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50 p-3 text-sm dark:border-neutral-700 dark:bg-neutral-950">
                <p>
                  Total {pushResult.childrenTotal}, succeeded {pushResult.childrenSuccess}, errors{' '}
                  {pushResult.childrenError}.
                </p>
                <ul className="mt-2 space-y-1">
                  {pushResult.detail.map((d, i) => (
                    <li key={`${d.courseCode ?? i}-${i}`} className="font-mono text-xs">
                      {d.courseCode}: {d.ok ? 'ok' : d.error ?? 'error'}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-neutral-700 dark:bg-neutral-900">
            <h3 className="text-base font-semibold text-slate-900 dark:text-neutral-100">Sync history</h3>
            {logs && logs.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500 dark:text-neutral-400">No pushes recorded yet.</p>
            ) : null}
            {logs && logs.length > 0 ? (
              <ul className="mt-3 space-y-2 text-sm">
                {logs.map((l) => (
                  <li key={l.id} className="rounded-lg border border-slate-100 px-3 py-2 dark:border-neutral-700">
                    <span className="text-slate-700 dark:text-neutral-200">{formatSyncAt(l.triggeredAt)}</span>{' '}
                    — {l.childrenSuccess}/{l.childrenTotal} ok, {l.childrenError} errors
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </>
      ) : null}
    </section>
  )
}
