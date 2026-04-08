import { type FormEvent, useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { UserPlus, X } from 'lucide-react'
import { LmsPage } from './LmsPage'
import { usePermissions } from '../../context/PermissionsContext'
import { authorizedFetch } from '../../lib/api'
import { fetchCourseScopedRoles, type CourseScopedAppRole } from '../../lib/coursesApi'
import { readApiErrorMessage } from '../../lib/errors'

export type CourseEnrollment = {
  id: string
  userId: string
  displayName: string | null
  role: string
}

type AddEnrollmentsResult = {
  added: string[]
  alreadyEnrolled: string[]
  notFound: string[]
}

export default function CourseEnrollments() {
  const { courseCode } = useParams<{ courseCode: string }>()
  const { refresh: refreshPermissions } = usePermissions()
  const [enrollments, setEnrollments] = useState<CourseEnrollment[] | null>(null)
  const [viewerRole, setViewerRole] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [modalOpen, setModalOpen] = useState(false)
  const [emailListText, setEmailListText] = useState('')
  const [courseScopedRoles, setCourseScopedRoles] = useState<CourseScopedAppRole[]>([])
  const [rolesLoading, setRolesLoading] = useState(false)
  const [rolesError, setRolesError] = useState<string | null>(null)
  const [selectedAppRoleId, setSelectedAppRoleId] = useState('')
  const [addStatus, setAddStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [addMessage, setAddMessage] = useState<string | null>(null)

  const loadEnrollments = useCallback(async () => {
    if (!courseCode) return
    setError(null)
    try {
      const res = await authorizedFetch(
        `/api/v1/courses/${encodeURIComponent(courseCode)}/enrollments`,
      )
      const raw: unknown = await res.json().catch(() => ({}))
      if (!res.ok) {
        setEnrollments([])
        setViewerRole(null)
        setError(readApiErrorMessage(raw))
        return
      }
      const data = raw as { enrollments?: CourseEnrollment[]; viewerEnrollmentRole?: string | null }
      setEnrollments(data.enrollments ?? [])
      setViewerRole(data.viewerEnrollmentRole ?? null)
    } catch {
      setEnrollments([])
      setViewerRole(null)
      setError('Could not load enrollments.')
    }
  }, [courseCode])

  useEffect(() => {
    void loadEnrollments()
  }, [loadEnrollments])

  const closeModal = useCallback(() => {
    setModalOpen(false)
    setEmailListText('')
    setSelectedAppRoleId('')
    setAddStatus('idle')
    setAddMessage(null)
    setRolesError(null)
  }, [])

  useEffect(() => {
    if (!modalOpen || !courseCode || viewerRole !== 'teacher') {
      return
    }
    let cancelled = false
    setRolesLoading(true)
    setRolesError(null)
    void fetchCourseScopedRoles(courseCode)
      .then((roles) => {
        if (!cancelled) {
          setCourseScopedRoles(roles)
          setSelectedAppRoleId((prev) => {
            if (prev && roles.some((r) => r.id === prev)) return prev
            return roles[0]?.id ?? ''
          })
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setCourseScopedRoles([])
          setRolesError(e instanceof Error ? e.message : 'Could not load course roles.')
        }
      })
      .finally(() => {
        if (!cancelled) setRolesLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [modalOpen, courseCode, viewerRole])

  useEffect(() => {
    if (!modalOpen) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') closeModal()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [modalOpen, closeModal])

  async function onSubmitAddEnrollments(e: FormEvent) {
    e.preventDefault()
    if (!courseCode || !emailListText.trim()) {
      setAddMessage('Enter at least one email address.')
      setAddStatus('error')
      return
    }

    if (viewerRole === 'teacher') {
      if (rolesLoading) {
        setAddMessage('Loading roles…')
        setAddStatus('error')
        return
      }
      if (rolesError) {
        setAddMessage(rolesError)
        setAddStatus('error')
        return
      }
      if (!selectedAppRoleId) {
        setAddMessage('Create a course-scoped role under Settings → Roles & Permissions, or select a role.')
        setAddStatus('error')
        return
      }
    }

    setAddStatus('loading')
    setAddMessage(null)
    try {
      const body =
        viewerRole === 'teacher'
          ? { emails: emailListText, appRoleId: selectedAppRoleId }
          : { emails: emailListText }

      const res = await authorizedFetch(
        `/api/v1/courses/${encodeURIComponent(courseCode)}/enrollments`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      )
      const raw: unknown = await res.json().catch(() => ({}))
      if (!res.ok) {
        setAddStatus('error')
        setAddMessage(readApiErrorMessage(raw))
        return
      }
      const data = raw as AddEnrollmentsResult
      const parts: string[] = []
      if (data.added?.length) parts.push(`Added: ${data.added.join(', ')}`)
      if (data.alreadyEnrolled?.length)
        parts.push(`Already enrolled: ${data.alreadyEnrolled.join(', ')}`)
      if (data.notFound?.length) parts.push(`No account for: ${data.notFound.join(', ')}`)
      setAddMessage(parts.length ? parts.join('. ') : 'Done.')
      setAddStatus('idle')
      setEmailListText('')
      await loadEnrollments()
      await refreshPermissions()
    } catch {
      setAddStatus('error')
      setAddMessage('Request failed.')
    }
  }

  const isCourseCreator = viewerRole === 'teacher'
  const submitDisabled =
    addStatus === 'loading' ||
    !emailListText.trim() ||
    (isCourseCreator && (rolesLoading || !selectedAppRoleId || !!rolesError))

  return (
    <LmsPage
      title="Enrollments"
      description={
        courseCode
          ? `People and roles for course ${courseCode}.`
          : 'Course enrollments'
      }
    >
      <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
        <button
          type="button"
          onClick={() => {
            setModalOpen(true)
            setAddMessage(null)
            setAddStatus('idle')
          }}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 shadow-sm transition hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-900"
        >
          <UserPlus className="h-4 w-4" aria-hidden />
          Add enrollment
        </button>
      </div>

      {error && (
        <p className="mt-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </p>
      )}
      {enrollments === null && !error && (
        <p className="mt-8 text-sm text-slate-500">Loading enrollments…</p>
      )}
      {enrollments && enrollments.length === 0 && !error && (
        <p className="mt-8 text-sm text-slate-500">No enrollments yet.</p>
      )}

      {enrollments && enrollments.length > 0 && (
        <div className="mt-8 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Role</th>
              </tr>
            </thead>
            <tbody>
              {enrollments.map((e) => (
                <tr key={e.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {e.displayName?.trim() || '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-700">{e.role}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-enrollment-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeModal()
          }}
        >
          <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <h3 id="add-enrollment-title" className="text-sm font-semibold text-slate-900">
                Add enrollment
              </h3>
              <button
                type="button"
                onClick={() => closeModal()}
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={(e) => void onSubmitAddEnrollments(e)} className="p-4">
              <label htmlFor="enrollment-emails" className="text-xs font-medium text-slate-600">
                Email addresses
              </label>
              <textarea
                id="enrollment-emails"
                value={emailListText}
                onChange={(e) => setEmailListText(e.target.value)}
                rows={6}
                placeholder={
                  'One per line, or separated by commas or spaces.\n' +
                  'example@school.edu, other@school.edu'
                }
                className="mt-1 w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none ring-indigo-500/20 focus:border-indigo-400 focus:ring-2"
                disabled={addStatus === 'loading'}
              />
              <p className="mt-2 text-xs text-slate-500">
                Only people who already have an account can be enrolled.
              </p>

              {isCourseCreator && (
                <div className="mt-4">
                  <label htmlFor="enrollment-app-role" className="text-xs font-medium text-slate-600">
                    Course role
                  </label>
                  <p className="mt-1 text-xs text-slate-500">
                    App roles with scope <span className="font-mono">course</span> (configure under
                    Settings → Roles & Permissions). Permissions are applied for this course only.
                  </p>
                  {rolesLoading ? (
                    <p className="mt-2 text-sm text-slate-500">Loading roles…</p>
                  ) : rolesError ? (
                    <p className="mt-2 text-sm text-rose-700">{rolesError}</p>
                  ) : courseScopedRoles.length === 0 ? (
                    <p className="mt-2 text-sm text-amber-800">
                      No course-scoped roles yet. Create one in Settings → Roles & Permissions (set
                      scope to Course), then add permissions.
                    </p>
                  ) : (
                    <select
                      id="enrollment-app-role"
                      value={selectedAppRoleId}
                      onChange={(e) => setSelectedAppRoleId(e.target.value)}
                      className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none ring-indigo-500/20 focus:border-indigo-400 focus:ring-2"
                      disabled={addStatus === 'loading'}
                    >
                      {courseScopedRoles.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                          {r.description?.trim() ? ` — ${r.description.trim()}` : ''}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}

              {!isCourseCreator && (
                <p className="mt-4 text-xs text-slate-500">
                  As someone who did not create this course, you can add people as{' '}
                  <span className="font-medium">students</span> only. The course creator assigns
                  course-scoped roles when enrolling.
                </p>
              )}

              {addMessage && (
                <p
                  className={
                    addStatus === 'error'
                      ? 'mt-3 text-sm text-rose-700'
                      : 'mt-3 text-sm text-slate-700'
                  }
                  role="status"
                >
                  {addMessage}
                </p>
              )}
              <div className="mt-4 flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={() => closeModal()}
                  className="rounded-xl px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
                >
                  Close
                </button>
                <button
                  type="submit"
                  disabled={submitDisabled}
                  className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {addStatus === 'loading' ? 'Adding…' : 'Add'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </LmsPage>
  )
}
