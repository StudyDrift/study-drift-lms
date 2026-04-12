import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ExternalLink } from 'lucide-react'
import { usePermissions } from '../../context/usePermissions'
import {
  fetchModuleExternalLink,
  patchModuleExternalLink,
  type ModuleExternalLinkPayload,
} from '../../lib/coursesApi'
import { permCourseItemCreate } from '../../lib/rbacApi'
import { LmsPage } from './LmsPage'

export default function CourseModuleExternalLinkPage() {
  const { courseCode, itemId } = useParams<{ courseCode: string; itemId: string }>()
  const { allows, loading: permLoading } = usePermissions()

  const [data, setData] = useState<ModuleExternalLinkPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [draftUrl, setDraftUrl] = useState('')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [autoOpenDone, setAutoOpenDone] = useState(false)

  const canEdit = Boolean(
    courseCode && itemId && !permLoading && allows(permCourseItemCreate(courseCode)),
  )

  const load = useCallback(async () => {
    if (!courseCode || !itemId) return
    setLoading(true)
    setLoadError(null)
    try {
      const row = await fetchModuleExternalLink(courseCode, itemId)
      setData(row)
      setDraftUrl(row.url)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not load this link.')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [courseCode, itemId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    setAutoOpenDone(false)
  }, [itemId, courseCode])

  useEffect(() => {
    if (loading || !data?.url || canEdit || autoOpenDone) return
    const u = data.url.trim()
    if (!u) return
    setAutoOpenDone(true)
    try {
      window.open(u, '_blank', 'noopener,noreferrer')
    } catch {
      /* ignore */
    }
  }, [loading, data, canEdit, autoOpenDone])

  async function onSave(e: React.FormEvent) {
    e.preventDefault()
    if (!courseCode || !itemId) return
    setSaveError(null)
    setSaving(true)
    try {
      const row = await patchModuleExternalLink(courseCode, itemId, { url: draftUrl.trim() })
      setData(row)
      setDraftUrl(row.url)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not save URL.')
    } finally {
      setSaving(false)
    }
  }

  const modulesHref =
    courseCode != null && courseCode !== ''
      ? `/courses/${encodeURIComponent(courseCode)}/modules`
      : '/courses'

  return (
    <LmsPage title={data?.title ?? 'External link'}>
      <div className="mx-auto max-w-2xl">
        <p className="mb-4 text-sm text-slate-600 dark:text-neutral-400">
          <Link to={modulesHref} className="font-medium text-indigo-600 hover:text-indigo-500 dark:text-indigo-400">
            ← Modules
          </Link>
        </p>

        {loading && <p className="text-sm text-slate-600 dark:text-neutral-400">Loading…</p>}
        {loadError && (
          <p className="text-sm text-rose-700 dark:text-rose-300" role="alert">
            {loadError}
          </p>
        )}

        {!loading && !loadError && data && (
          <div className="rounded-2xl border border-slate-200/80 bg-white/90 p-5 shadow-sm dark:border-neutral-700 dark:bg-neutral-900/85">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-violet-200/90 bg-violet-50 text-violet-700 dark:border-violet-500/40 dark:bg-violet-950/55 dark:text-violet-200">
                <ExternalLink className="h-5 w-5" strokeWidth={2} aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <h1 className="text-xl font-semibold tracking-tight text-slate-950 dark:text-neutral-100">
                  {data.title}
                </h1>
                {!canEdit && data.url ? (
                  <p className="mt-3 text-sm text-slate-600 dark:text-neutral-400">
                    Opening in a new tab… If nothing opened, use the button below (your browser may
                    have blocked the pop-up).
                  </p>
                ) : null}
                <div className="mt-4 flex flex-wrap gap-2">
                  {data.url ? (
                    <a
                      href={data.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center justify-center rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500"
                    >
                      Open link
                    </a>
                  ) : (
                    <p className="text-sm text-slate-600 dark:text-neutral-400">
                      No URL has been set for this item yet.
                    </p>
                  )}
                </div>

                {canEdit && (
                  <form className="mt-6 border-t border-slate-200 pt-6 dark:border-neutral-700" onSubmit={onSave}>
                    <label htmlFor="ext-url" className="text-xs font-medium text-slate-600 dark:text-neutral-300">
                      Destination URL
                    </label>
                    <input
                      id="ext-url"
                      type="url"
                      value={draftUrl}
                      onChange={(e) => setDraftUrl(e.target.value)}
                      disabled={saving}
                      className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none ring-indigo-500/20 focus:border-indigo-400 focus:ring-2 disabled:opacity-60 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100"
                    />
                    {saveError ? (
                      <p className="mt-2 text-sm text-rose-700 dark:text-rose-300" role="status">
                        {saveError}
                      </p>
                    ) : null}
                    <div className="mt-3 flex justify-end">
                      <button
                        type="submit"
                        disabled={saving || !draftUrl.trim()}
                        className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-white"
                      >
                        {saving ? 'Saving…' : 'Save URL'}
                      </button>
                    </div>
                  </form>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </LmsPage>
  )
}
