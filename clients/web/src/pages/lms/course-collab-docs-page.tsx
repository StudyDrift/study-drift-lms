import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { fetchCollabDocs, type CollabDoc } from '../../lib/collab-docs-api'
import { courseItemCreatePermission, fetchCourse } from '../../lib/courses-api'
import { usePermissions } from '../../context/use-permissions'
import { CollabDocsList } from '../../components/collab/CollabDocsList'
import { LmsPage } from './lms-page'

export default function CourseCollabDocsPage() {
  const { courseCode: rawCode } = useParams<{ courseCode: string }>()
  const courseCode = rawCode ? decodeURIComponent(rawCode) : ''
  const { allows, loading: permLoading } = usePermissions()
  const canManage = !permLoading && !!courseCode && allows(courseItemCreatePermission(courseCode))

  const [docs, setDocs] = useState<CollabDoc[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!courseCode) return
    setLoading(true)
    setError(null)
    try {
      const course = await fetchCourse(courseCode)
      if (!course.collabDocsEnabled) {
        setError('Collaborative documents are not enabled for this course.')
        return
      }
      const result = await fetchCollabDocs(courseCode)
      setDocs(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load documents.')
    } finally {
      setLoading(false)
    }
  }, [courseCode])

  useEffect(() => { void load() }, [load])

  return (
    <LmsPage title="Collaborative Documents">
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <span className="text-sm text-slate-500 dark:text-neutral-400">Loading…</span>
        </div>
      ) : error ? (
        <div className="rounded-md bg-red-50 p-4 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-400">
          {error}
        </div>
      ) : (
        <CollabDocsList
          courseCode={courseCode}
          docs={docs}
          canManage={canManage}
          onDocsChanged={() => { void load() }}
        />
      )}
    </LmsPage>
  )
}
