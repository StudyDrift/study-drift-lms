import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { apiUrl } from '../../lib/api'
import { fetchModuleLtiLink, postModuleLtiEmbedTicket } from '../../lib/courses-api'
import { recordLastVisitedModuleItem } from '../../lib/last-visited-module-item'
import { permCourseItemCreate } from '../../lib/rbac-api'
import { usePermissions } from '../../context/use-permissions'
import { LmsPage } from './lms-page'

export default function CourseModuleLtiPage() {
  const { courseCode, itemId } = useParams<{ courseCode: string; itemId: string }>()
  const { allows, loading: permLoading } = usePermissions()
  const canEdit = !permLoading && allows(permCourseItemCreate(courseCode ?? ''))

  const [title, setTitle] = useState<string | null>(null)
  const [iframeSrc, setIframeSrc] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!courseCode || !itemId) return
    setLoading(true)
    setError(null)
    try {
      const meta = await fetchModuleLtiLink(courseCode, itemId)
      setTitle(meta.title)
      recordLastVisitedModuleItem(courseCode, {
        itemId,
        kind: 'lti_link',
        title: meta.title,
      })

      const { ticket } = await postModuleLtiEmbedTicket(courseCode, itemId)
      if (!ticket) {
        setError('Could not start LTI session.')
        setLoading(false)
        return
      }
      const u = new URL(apiUrl('/api/v1/lti/consumer/frame'))
      u.searchParams.set('ticket', ticket)
      setIframeSrc(u.toString())
    } catch {
      setError('Could not load this LTI link.')
    } finally {
      setLoading(false)
    }
  }, [courseCode, itemId])

  useEffect(() => {
    void load()
  }, [load])

  const safeTitle = title ?? 'LTI tool'

  return (
    <LmsPage
      title={safeTitle}
      description="Launches in the frame below when your administrator has enabled LTI."
    >
      <div className="mb-4">
        <Link
          to={`/courses/${encodeURIComponent(courseCode ?? '')}/modules`}
          className="text-sm font-medium text-indigo-600 hover:text-indigo-500 dark:text-indigo-400"
        >
          ← Back to modules
        </Link>
      </div>
      {canEdit ? (
        <p className="mb-3 text-sm text-slate-600 dark:text-neutral-400">
          Instructors can set the AGS line item URL on this module item so external tools can send grades back to the
          gradebook.
        </p>
      ) : null}
      {loading ? <p className="text-sm text-slate-600 dark:text-neutral-400">Preparing launch…</p> : null}
      {error ? (
        <p className="text-sm text-rose-600 dark:text-rose-400" role="alert">
          {error}
        </p>
      ) : null}
      {iframeSrc && !error ? (
        <>
          <p className="mb-2 text-sm text-slate-600 dark:text-neutral-400">
            If the tool does not load, use your browser&apos;s option to open the frame in a new tab or check that LTI
            is enabled on the server.
          </p>
          <iframe title={safeTitle} src={iframeSrc} className="h-[min(80vh,720px)] w-full rounded-xl border border-slate-200 dark:border-neutral-600" />
        </>
      ) : null}
    </LmsPage>
  )
}
