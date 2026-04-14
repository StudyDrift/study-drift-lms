import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { GraduationCap, Trash2, UserPlus, X } from 'lucide-react'
import { LmsPage } from './LmsPage'
import { usePermission, usePermissions } from '../../context/usePermissions'
import { authorizedFetch } from '../../lib/api'
import {
  courseEnrollmentsReadPermission,
  courseEnrollmentsUpdatePermission,
  fetchCourse,
  fetchCourseScopedRoles,
  viewerShouldHideCourseEnrollmentsNav,
  type CourseScopedAppRole,
} from '../../lib/coursesApi'
import { useCourseViewAs } from '../../lib/courseViewAs'
import { readApiErrorMessage } from '../../lib/errors'
import { formatTimeAgoFromIso } from '../../lib/formatTimeAgo'

export type CourseEnrollment = {
  id: string
  userId: string
  displayName: string | null
  role: string
  lastCourseAccessAt?: string | null
}

type AddEnrollmentsResult = {
  added: string[]
  alreadyEnrolled: string[]
  notFound: string[]
}

function enrollmentRoleRank(roleDisplay: string): number {
  switch (roleDisplay) {
    case 'Teacher':
      return 0
    case 'Instructor':
      return 1
    case 'Student':
      return 2
    default:
      return 3
  }
}

export default function CourseEnrollments() {
  const { courseCode } = useParams<{ courseCode: string }>()
  const courseViewPreview = useCourseViewAs(courseCode)
  const { allows, loading: permLoading, refresh: refreshPermissions } = usePermissions()
  const canUpdateEnrollments = usePermission(
    courseCode ? courseEnrollmentsUpdatePermission(courseCode) : 'global:app:noop:noop',
  )
  const [enrollments, setEnrollments] = useState<CourseEnrollment[] | null>(null)
  const [viewerRoles, setViewerRoles] = useState<string[]>([])
  /** Used to gate the page before hitting the enrollments API (must match roster nav rules). */
  const [courseViewerEnrollmentRoles, setCourseViewerEnrollmentRoles] = useState<string[] | null>(
    null,
  )
  const [error, setError] = useState<string | null>(null)

  const [modalOpen, setModalOpen] = useState(false)
  const [emailListText, setEmailListText] = useState('')
  const [courseScopedRoles, setCourseScopedRoles] = useState<CourseScopedAppRole[]>([])
  const [rolesLoading, setRolesLoading] = useState(false)
  const [rolesError, setRolesError] = useState<string | null>(null)
  const [selectedAppRoleId, setSelectedAppRoleId] = useState('')
  const [addStatus, setAddStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [addMessage, setAddMessage] = useState<string | null>(null)
  const [selfStudentStatus, setSelfStudentStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [selfStudentMessage, setSelfStudentMessage] = useState<string | null>(null)
  const [removingId, setRemovingId] = useState<string | null>(null)
  /** Recompute relative "last access" labels periodically while the roster is visible. */
  const [relativeNowMs, setRelativeNowMs] = useState(() => Date.now())

  useEffect(() => {
    if (!courseCode) {
      setCourseViewerEnrollmentRoles(null)
      return
    }
    let cancelled = false
    void fetchCourse(courseCode)
      .then((c) => {
        if (!cancelled) setCourseViewerEnrollmentRoles(c.viewerEnrollmentRoles ?? [])
      })
      .catch(() => {
        if (!cancelled) setCourseViewerEnrollmentRoles([])
      })
    return () => {
      cancelled = true
    }
  }, [courseCode])

  const enrollmentMeta = useMemo(() => {
    if (!enrollments?.length) {
      return { isPrimaryRoleRow: (_e: CourseEnrollment) => false }
    }
    const byUser = new Map<string, CourseEnrollment[]>()
    for (const e of enrollments) {
      const list = byUser.get(e.userId) ?? []
      list.push(e)
      byUser.set(e.userId, list)
    }
    function isPrimaryRoleRow(e: CourseEnrollment): boolean {
      const list = byUser.get(e.userId)
      if (!list || list.length <= 1) return false
      const minRank = Math.min(...list.map((x) => enrollmentRoleRank(x.role)))
      return enrollmentRoleRank(e.role) === minRank
    }
    return { isPrimaryRoleRow }
  }, [enrollments])

  useEffect(() => {
    if (!enrollments?.length) return
    const id = window.setInterval(() => setRelativeNowMs(Date.now()), 60_000)
    return () => window.clearInterval(id)
  }, [enrollments?.length])

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
        setViewerRoles([])
        setError(readApiErrorMessage(raw))
        return
      }
      const data = raw as { enrollments?: CourseEnrollment[]; viewerEnrollmentRoles?: string[] }
      setEnrollments(data.enrollments ?? [])
      setViewerRoles(data.viewerEnrollmentRoles ?? [])
    } catch {
      setEnrollments([])
      setViewerRoles([])
      setError('Could not load enrollments.')
    }
  }, [courseCode])

  useEffect(() => {
    if (!courseCode || permLoading) return
    if (!allows(courseEnrollmentsReadPermission(courseCode))) return
    const id = window.setTimeout(() => {
      void loadEnrollments()
    }, 0)
    return () => window.clearTimeout(id)
  }, [allows, courseCode, loadEnrollments, permLoading])

  const closeModal = useCallback(() => {
    setModalOpen(false)
    setEmailListText('')
    setSelectedAppRoleId('')
    setAddStatus('idle')
    setAddMessage(null)
    setRolesError(null)
  }, [])

  useEffect(() => {
    if (!modalOpen || !courseCode || !viewerRoles.includes('teacher')) {
      return
    }
    let cancelled = false
    const id = window.setTimeout(() => {
      if (cancelled) return
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
    }, 0)
    return () => {
      cancelled = true
      window.clearTimeout(id)
    }
  }, [modalOpen, courseCode, viewerRoles])

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

    if (viewerRoles.includes('teacher')) {
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
        viewerRoles.includes('teacher')
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

  const isCourseCreator = viewerRoles.includes('teacher')

  const canEnrollSelfAsStudent = isCourseCreator && !viewerRoles.includes('student')

  async function onEnrollAsStudent() {
    if (!courseCode) return
    setSelfStudentStatus('loading')
    setSelfStudentMessage(null)
    try {
      const res = await authorizedFetch(
        `/api/v1/courses/${encodeURIComponent(courseCode)}/enrollments/self-as-student`,
        { method: 'POST' },
      )
      const raw: unknown = await res.json().catch(() => ({}))
      if (!res.ok) {
        setSelfStudentStatus('error')
        setSelfStudentMessage(readApiErrorMessage(raw))
        return
      }
      setSelfStudentStatus('idle')
      await loadEnrollments()
      await refreshPermissions()
    } catch {
      setSelfStudentStatus('error')
      setSelfStudentMessage('Request failed.')
    }
  }

  async function onRemoveEnrollment(enrollmentId: string) {
    if (!courseCode) return
    setError(null)
    setRemovingId(enrollmentId)
    try {
      const res = await authorizedFetch(
        `/api/v1/courses/${encodeURIComponent(courseCode)}/enrollments/${encodeURIComponent(enrollmentId)}`,
        { method: 'DELETE' },
      )
      if (!res.ok) {
        const raw: unknown = await res.json().catch(() => ({}))
        setError(readApiErrorMessage(raw))
        return
      }
      await loadEnrollments()
      await refreshPermissions()
    } catch {
      setError('Could not remove enrollment.')
    } finally {
      setRemovingId(null)
    }
  }

  const submitDisabled =
    addStatus === 'loading' ||
    !emailListText.trim() ||
    (isCourseCreator && (rolesLoading || !selectedAppRoleId || !!rolesError))

  if (!courseCode) {
    return <Navigate to="/courses" replace />
  }

  if (permLoading || courseViewerEnrollmentRoles === null) {
    return null
  }

  if (!allows(courseEnrollmentsReadPermission(courseCode))) {
    return <Navigate to={`/courses/${encodeURIComponent(courseCode)}`} replace />
  }

  if (viewerShouldHideCourseEnrollmentsNav(courseViewerEnrollmentRoles, courseViewPreview)) {
    return <Navigate to={`/courses/${encodeURIComponent(courseCode)}`} replace />
  }

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
        {canEnrollSelfAsStudent && (
          <button
            type="button"
            onClick={() => void onEnrollAsStudent()}
            disabled={selfStudentStatus === 'loading'}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 shadow-sm transition hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-900 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <GraduationCap className="h-4 w-4" aria-hidden />
            {selfStudentStatus === 'loading' ? 'Enrolling…' : 'Enroll as Student'}
          </button>
        )}
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
      {selfStudentMessage && (
        <p className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {selfStudentMessage}
        </p>
      )}

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
        <div className="mt-8 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full min-w-[16rem] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Last access</th>
                {canUpdateEnrollments && (
                  <th className="w-12 px-2 py-3 text-right font-normal" aria-label="Actions" />
                )}
              </tr>
            </thead>
            <tbody>
              {enrollments.map((e) => {
                const showRemove =
                  canUpdateEnrollments && !enrollmentMeta.isPrimaryRoleRow(e)
                return (
                  <tr
                    key={e.id}
                    className="group border-b border-slate-100 last:border-0"
                  >
                    <td className="px-4 py-3 font-medium text-slate-900">
                      {e.displayName?.trim() || '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-700">{e.role}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {formatTimeAgoFromIso(e.lastCourseAccessAt, relativeNowMs)}
                    </td>
                    {canUpdateEnrollments && (
                      <td className="px-2 py-3 text-right align-middle">
                        {showRemove ? (
                          <button
                            type="button"
                            onClick={() => void onRemoveEnrollment(e.id)}
                            disabled={removingId === e.id}
                            className="inline-flex rounded-lg p-1.5 text-slate-400 opacity-0 transition hover:bg-rose-50 hover:text-rose-700 group-hover:opacity-100 focus-visible:opacity-100 disabled:cursor-not-allowed disabled:opacity-40"
                            aria-label={`Remove ${e.role} enrollment for ${e.displayName?.trim() || 'this person'}`}
                          >
                            <Trash2 className="h-4 w-4" aria-hidden />
                          </button>
                        ) : null}
                      </td>
                    )}
                  </tr>
                )
              })}
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
