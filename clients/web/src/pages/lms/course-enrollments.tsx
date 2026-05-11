import {
  type Dispatch,
  type FormEvent,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { Pencil, Shuffle, Trash2, UsersRound, X } from 'lucide-react'
import { EnrollmentRoleBadge } from './enrollment-role-badge'
import { EnrollmentGroupsPanel } from './enrollment-groups-panel'
import { EnrollmentsActionsMenu } from './enrollments-actions-menu'
import { LmsPage } from './lms-page'
import { usePermission, usePermissions } from '../../context/use-permissions'
import { authorizedFetch } from '../../lib/api'
import {
  courseEnrollmentsReadPermission,
  courseEnrollmentsUpdatePermission,
  fetchCourse,
  fetchCourseScopedRoles,
  fetchCourseSections,
  fetchEnrollmentGroupsTree,
  patchEnrollmentSection,
  postEnrollmentGroupsEnable,
  putEnrollmentGroupMembership,
  viewerShouldHideCourseEnrollmentsNav,
  type CourseScopedAppRole,
  type CourseSection,
  type EnrollmentGroupMembership,
  type EnrollmentGroupsTreeResponse,
} from '../../lib/courses-api'
import { notifyCourseViewerEnrollmentChanged, useCourseViewAs } from '../../lib/course-view-as'
import { readApiErrorMessage } from '../../lib/errors'
import { formatTimeAgoFromIso } from '../../lib/format-time-ago'

export type CourseEnrollment = {
  id: string
  userId: string
  displayName: string | null
  role: string
  roleDisplay?: string | null
  lastCourseAccessAt?: string | null
  groupMemberships?: EnrollmentGroupMembership[]
  sectionId?: string | null
  sectionCode?: string | null
  sectionName?: string | null
}

/** Blurred dim backdrop for roster modals (Escape closes in the keydown effect below). */
const LMS_MODAL_OVERLAY_CLASS =
  'fixed inset-0 z-50 flex items-end justify-center p-4 backdrop-blur-md bg-slate-900/30 dark:bg-black/40 sm:items-center'

type AddEnrollmentsResult = {
  added: string[]
  alreadyEnrolled: string[]
  notFound: string[]
}

function normEnrollmentRole(role: string): string {
  return role.trim().toLowerCase()
}

function enrollmentRoleRank(role: string): number {
  switch (normEnrollmentRole(role)) {
    case 'owner':
      return 0
    case 'teacher':
      return 0
    case 'instructor':
      return 1
    case 'ta':
      return 2
    case 'designer':
      return 3
    case 'observer':
      return 4
    case 'auditor':
      return 5
    case 'librarian':
      return 6
    case 'student':
      return 7
    default:
      return 8
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
  const [editTarget, setEditTarget] = useState<CourseEnrollment | null>(null)
  /** When set, POST /enrollments uses `courseRole` instead of a course-scoped app role. */
  const [addCourseRole, setAddCourseRole] = useState('')
  const [editBuiltinCourseRole, setEditBuiltinCourseRole] = useState('')
  const [editSaveStatus, setEditSaveStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [editMessage, setEditMessage] = useState<string | null>(null)
  const [demoteStatus, setDemoteStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  /** Recompute relative "last access" labels periodically while the roster is visible. */
  const [relativeNowMs, setRelativeNowMs] = useState(() => Date.now())
  const [enrollmentGroupsEnabled, setEnrollmentGroupsEnabled] = useState(false)
  const [mainTab, setMainTab] = useState<'roster' | 'groups'>('roster')
  const [enableGroupsBusy, setEnableGroupsBusy] = useState(false)
  const [groupAssignTarget, setGroupAssignTarget] = useState<CourseEnrollment | null>(null)
  const [groupAssignTree, setGroupAssignTree] = useState<EnrollmentGroupsTreeResponse | null>(null)
  const [groupAssignLoading, setGroupAssignLoading] = useState(false)
  const [groupAssignSelections, setGroupAssignSelections] = useState<Record<string, string>>({})
  const [groupAssignStatus, setGroupAssignStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [groupAssignMessage, setGroupAssignMessage] = useState<string | null>(null)

  const [sectionsEnabled, setSectionsEnabled] = useState(false)
  const [sections, setSections] = useState<CourseSection[]>([])
  const [sectionTransferTarget, setSectionTransferTarget] = useState<CourseEnrollment | null>(null)
  const [sectionTransferPick, setSectionTransferPick] = useState('')
  const [sectionTransferStatus, setSectionTransferStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [sectionTransferMessage, setSectionTransferMessage] = useState<string | null>(null)

  const viewerIsTeacher = useMemo(
    () => viewerRoles.some((r) => normEnrollmentRole(r) === 'teacher'),
    [viewerRoles],
  )
  const viewerHasStudent = useMemo(
    () => viewerRoles.some((r) => normEnrollmentRole(r) === 'student'),
    [viewerRoles],
  )

  useEffect(() => {
    if (!courseCode) {
      setCourseViewerEnrollmentRoles(null)
      return
    }
    let cancelled = false
    void fetchCourse(courseCode)
      .then((c) => {
        if (!cancelled) {
          setCourseViewerEnrollmentRoles(c.viewerEnrollmentRoles ?? [])
          setSectionsEnabled(c.sectionsEnabled === true)
        }
      })
      .catch(() => {
        if (!cancelled) setCourseViewerEnrollmentRoles([])
      })
    return () => {
      cancelled = true
    }
  }, [courseCode])

  const loadSections = useCallback(async () => {
    if (!courseCode || !sectionsEnabled) {
      setSections([])
      return
    }
    try {
      const list = await fetchCourseSections(courseCode)
      setSections(list.filter((s) => s.status === 'active'))
    } catch {
      setSections([])
    }
  }, [courseCode, sectionsEnabled])

  useEffect(() => {
    void loadSections()
  }, [loadSections])

  const enrollmentMeta = useMemo(() => {
    if (!enrollments?.length) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars -- signature matches non-empty branch
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
      const data = raw as {
        enrollments?: unknown[]
        viewerEnrollmentRoles?: string[]
        enrollmentGroupsEnabled?: boolean
      }
      const groupsOn = !!data.enrollmentGroupsEnabled
      setEnrollmentGroupsEnabled(groupsOn)
      if (!groupsOn) setMainTab('roster')
      const rows = Array.isArray(data.enrollments) ? data.enrollments : []
      const mapped: CourseEnrollment[] = rows.map((row) => {
        const o = row as Record<string, unknown>
        const id = typeof o.id === 'string' ? o.id : o.id != null ? String(o.id) : ''
        const userId =
          typeof o.userId === 'string'
            ? o.userId
            : typeof o.user_id === 'string'
              ? o.user_id
              : o.userId != null
                ? String(o.userId)
                : o.user_id != null
                  ? String(o.user_id)
                  : ''
        const displayName =
          typeof o.displayName === 'string'
            ? o.displayName
            : typeof o.display_name === 'string'
              ? o.display_name
              : null
        const role = typeof o.role === 'string' ? o.role : 'student'
        const roleDisplay =
          typeof o.roleDisplay === 'string'
            ? o.roleDisplay
            : typeof o.role_display === 'string'
              ? o.role_display
              : null
        const lastCourseAccessAt =
          typeof o.lastCourseAccessAt === 'string'
            ? o.lastCourseAccessAt
            : typeof o.last_course_access_at === 'string'
              ? o.last_course_access_at
              : null
        const sectionId =
          typeof o.sectionId === 'string'
            ? o.sectionId
            : typeof o.section_id === 'string'
              ? o.section_id
              : null
        const sectionCode =
          typeof o.sectionCode === 'string'
            ? o.sectionCode
            : typeof o.section_code === 'string'
              ? o.section_code
              : null
        const sectionName =
          typeof o.sectionName === 'string'
            ? o.sectionName
            : typeof o.section_name === 'string'
              ? o.section_name
              : null
        const rawGm = o.groupMemberships ?? o.group_memberships
        let groupMemberships: EnrollmentGroupMembership[] | undefined
        if (Array.isArray(rawGm)) {
          groupMemberships = []
          for (const m of rawGm) {
            if (!m || typeof m !== 'object') continue
            const mo = m as Record<string, unknown>
            const groupSetId =
              typeof mo.groupSetId === 'string'
                ? mo.groupSetId
                : typeof mo.group_set_id === 'string'
                  ? mo.group_set_id
                  : ''
            const groupId =
              typeof mo.groupId === 'string'
                ? mo.groupId
                : typeof mo.group_id === 'string'
                  ? mo.group_id
                  : ''
            if (groupSetId && groupId) groupMemberships.push({ groupSetId, groupId })
          }
        }
        return {
          id,
          userId,
          displayName,
          role,
          roleDisplay,
          lastCourseAccessAt,
          sectionId,
          sectionCode,
          sectionName,
          ...(groupMemberships?.length ? { groupMemberships } : {}),
        }
      })
      setEnrollments(mapped)
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
    setAddCourseRole('')
    setAddStatus('idle')
    setAddMessage(null)
    setRolesError(null)
  }, [])

  const closeEditModal = useCallback(() => {
    setEditTarget(null)
    setEditBuiltinCourseRole('')
    setEditSaveStatus('idle')
    setEditMessage(null)
    setDemoteStatus('idle')
    setRolesError(null)
  }, [])

  const openGroupAssignModal = useCallback(
    (e: CourseEnrollment) => {
      setGroupAssignTarget(e)
      setGroupAssignSelections({})
      setGroupAssignTree(null)
      setGroupAssignMessage(null)
      setGroupAssignStatus('idle')
      if (!courseCode) return
      setGroupAssignLoading(true)
      void (async () => {
        try {
          const tree = await fetchEnrollmentGroupsTree(courseCode)
          setGroupAssignTree(tree)
          const sel: Record<string, string> = {}
          for (const set of tree.groupSets) {
            const hit = e.groupMemberships?.find((m) => m.groupSetId === set.id)
            sel[set.id] = hit?.groupId ?? ''
          }
          setGroupAssignSelections(sel)
        } catch (err: unknown) {
          setGroupAssignMessage(err instanceof Error ? err.message : 'Could not load groups.')
          setGroupAssignStatus('error')
        } finally {
          setGroupAssignLoading(false)
        }
      })()
    },
    [courseCode],
  )

  const closeGroupAssignModal = useCallback(() => {
    setGroupAssignTarget(null)
    setGroupAssignTree(null)
    setGroupAssignSelections({})
    setGroupAssignStatus('idle')
    setGroupAssignMessage(null)
  }, [])

  const closeSectionTransferModal = useCallback(() => {
    setSectionTransferTarget(null)
    setSectionTransferPick('')
    setSectionTransferStatus('idle')
    setSectionTransferMessage(null)
  }, [])

  const openSectionTransferModal = useCallback(
    (e: CourseEnrollment) => {
      setSectionTransferTarget(e)
      const alt = sections.find((s) => s.id !== e.sectionId)
      setSectionTransferPick(alt?.id ?? sections[0]?.id ?? '')
      setSectionTransferStatus('idle')
      setSectionTransferMessage(null)
    },
    [sections],
  )

  async function onSubmitSectionTransfer(ev: FormEvent) {
    ev.preventDefault()
    if (!sectionTransferTarget || !sectionTransferPick) return
    if (sectionTransferPick === sectionTransferTarget.sectionId) {
      setSectionTransferMessage('Choose a different section.')
      setSectionTransferStatus('error')
      return
    }
    setSectionTransferStatus('loading')
    setSectionTransferMessage(null)
    try {
      await patchEnrollmentSection(sectionTransferTarget.id, sectionTransferPick)
      setSectionTransferStatus('idle')
      closeSectionTransferModal()
      await loadEnrollments()
      await loadSections()
    } catch (err) {
      setSectionTransferStatus('error')
      setSectionTransferMessage(err instanceof Error ? err.message : 'Transfer failed.')
    }
  }

  useEffect(() => {
    if (!modalOpen || !courseCode || !viewerIsTeacher) {
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
  }, [modalOpen, courseCode, viewerIsTeacher])

  useEffect(() => {
    if (!modalOpen && !editTarget && !groupAssignTarget && !sectionTransferTarget) return
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      e.preventDefault()
      if (modalOpen) closeModal()
      else if (editTarget) closeEditModal()
      else if (groupAssignTarget) closeGroupAssignModal()
      else if (sectionTransferTarget) closeSectionTransferModal()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [
    modalOpen,
    editTarget,
    groupAssignTarget,
    sectionTransferTarget,
    closeModal,
    closeEditModal,
    closeGroupAssignModal,
    closeSectionTransferModal,
  ])

  async function onSubmitAddEnrollments(e: FormEvent) {
    e.preventDefault()
    if (!courseCode || !emailListText.trim()) {
      setAddMessage('Enter at least one email address.')
      setAddStatus('error')
      return
    }

    const builtinAdd = addCourseRole.trim()
    if (viewerIsTeacher && !builtinAdd) {
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
        setAddMessage(
          'Pick a built-in course role, or create a course-scoped app role under Settings → Roles & Permissions.',
        )
        setAddStatus('error')
        return
      }
    }

    setAddStatus('loading')
    setAddMessage(null)
    try {
      const body = builtinAdd
        ? { emails: emailListText, courseRole: normEnrollmentRole(builtinAdd) }
        : viewerIsTeacher
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

  const isCourseCreator = viewerIsTeacher

  const canEnrollSelfAsStudent = isCourseCreator && !viewerHasStudent

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
      notifyCourseViewerEnrollmentChanged(courseCode)
      await loadEnrollments()
      await refreshPermissions()
    } catch {
      setSelfStudentStatus('error')
      setSelfStudentMessage('Request failed.')
    }
  }

  async function onPatchEnrollment(
    body: Record<string, unknown>,
    setStatus: Dispatch<SetStateAction<'idle' | 'loading' | 'error'>>,
  ) {
    if (!courseCode || !editTarget) return
    setError(null)
    setStatus('loading')
    setEditMessage(null)
    try {
      const res = await authorizedFetch(
        `/api/v1/courses/${encodeURIComponent(courseCode)}/enrollments/${encodeURIComponent(editTarget.id)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      )
      if (!res.ok) {
        const raw: unknown = await res.json().catch(() => ({}))
        setStatus('error')
        setEditMessage(readApiErrorMessage(raw))
        return
      }
      setStatus('idle')
      closeEditModal()
      await loadEnrollments()
      await refreshPermissions()
    } catch {
      setStatus('error')
      setEditMessage('Request failed.')
    }
  }

  async function onSaveEditBuiltinRole() {
    if (!editBuiltinCourseRole.trim()) {
      setEditSaveStatus('error')
      setEditMessage('Select an enrollment role.')
      return
    }
    await onPatchEnrollment({ courseRole: normEnrollmentRole(editBuiltinCourseRole) }, setEditSaveStatus)
  }

  async function onDemoteEnrollmentToStudent() {
    await onPatchEnrollment({ role: 'student' }, setDemoteStatus)
  }

  async function onSaveGroupAssignments() {
    if (!courseCode || !groupAssignTarget) return
    setGroupAssignStatus('loading')
    setGroupAssignMessage(null)
    try {
      if (groupAssignTree) {
        for (const set of groupAssignTree.groupSets) {
          const selected = groupAssignSelections[set.id] ?? ''
          const prev = groupAssignTarget.groupMemberships?.find((m) => m.groupSetId === set.id)
          const prevId = prev?.groupId ?? ''
          if (selected === prevId) continue
          await putEnrollmentGroupMembership(courseCode, {
            enrollmentId: groupAssignTarget.id,
            groupSetId: set.id,
            groupId: selected ? selected : null,
          })
        }
      }
      await loadEnrollments()
      closeGroupAssignModal()
    } catch (err: unknown) {
      setGroupAssignStatus('error')
      setGroupAssignMessage(err instanceof Error ? err.message : 'Save failed.')
    }
  }

  async function onEnableEnrollmentGroups() {
    if (!courseCode) return
    setEnableGroupsBusy(true)
    try {
      await postEnrollmentGroupsEnable(courseCode)
      setEnrollmentGroupsEnabled(true)
      setMainTab('groups')
      await loadEnrollments()
    } finally {
      setEnableGroupsBusy(false)
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

  const usingBuiltinAdd = addCourseRole.trim().length > 0
  const submitDisabled =
    addStatus === 'loading' ||
    !emailListText.trim() ||
    (viewerIsTeacher &&
      !usingBuiltinAdd &&
      (rolesLoading || !selectedAppRoleId || !!rolesError))

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
      titleContent={
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-neutral-100">
              Enrollments
            </h1>
            <EnrollmentsActionsMenu
              disabled={permLoading}
              canEnrollSelfAsStudent={canEnrollSelfAsStudent}
              onEnrollAsStudent={() => void onEnrollAsStudent()}
              enrollAsStudentBusy={selfStudentStatus === 'loading'}
              onAddEnrollment={() => {
                setModalOpen(true)
                setAddCourseRole('')
                setAddMessage(null)
                setAddStatus('idle')
              }}
              groupsEnabled={enrollmentGroupsEnabled}
              canToggleGroups={canUpdateEnrollments}
              onEnableGroups={() => void onEnableEnrollmentGroups()}
              enableGroupsBusy={enableGroupsBusy}
            />
          </div>
          <p className="mt-2 max-w-2xl text-xs text-slate-500 dark:text-neutral-400">
            {courseCode
              ? `People and roles for course ${courseCode}.`
              : 'Course enrollments'}
          </p>
          {enrollmentGroupsEnabled ? (
            <div
              className="mt-4 flex gap-1 border-b border-slate-200 dark:border-neutral-700"
              role="tablist"
              aria-label="Enrollments sections"
            >
              <button
                type="button"
                role="tab"
                aria-selected={mainTab === 'roster'}
                onClick={() => setMainTab('roster')}
                className={`rounded-t-lg px-4 py-2 text-sm font-semibold transition ${
                  mainTab === 'roster'
                    ? 'border border-b-0 border-slate-200 bg-white text-slate-900 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100'
                    : 'text-slate-500 hover:text-slate-800 dark:text-neutral-400 dark:hover:text-neutral-200'
                }`}
              >
                Enrollments
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mainTab === 'groups'}
                onClick={() => setMainTab('groups')}
                className={`rounded-t-lg px-4 py-2 text-sm font-semibold transition ${
                  mainTab === 'groups'
                    ? 'border border-b-0 border-slate-200 bg-white text-slate-900 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100'
                    : 'text-slate-500 hover:text-slate-800 dark:text-neutral-400 dark:hover:text-neutral-200'
                }`}
              >
                Groups
              </button>
            </div>
          ) : null}
        </div>
      }
    >
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
      {mainTab === 'roster' && enrollments === null && !error && (
        <p className="mt-8 text-sm text-slate-500">Loading enrollments…</p>
      )}
      {mainTab === 'roster' && enrollments && enrollments.length === 0 && !error && (
        <p className="mt-8 text-sm text-slate-500">No enrollments yet.</p>
      )}

      {mainTab === 'roster' && enrollments && enrollments.length > 0 && (
        <div className="mt-8 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full min-w-[16rem] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Role</th>
                {sectionsEnabled ? <th className="px-4 py-3">Section</th> : null}
                <th className="px-4 py-3">Last access</th>
                {canUpdateEnrollments && (
                  <th className="min-w-[4.5rem] px-2 py-3 text-right font-normal" aria-label="Actions" />
                )}
              </tr>
            </thead>
            <tbody>
              {enrollments.map((e) => {
                const er = normEnrollmentRole(e.role)
                const showRemove =
                  canUpdateEnrollments && !enrollmentMeta.isPrimaryRoleRow(e)
                const showEdit =
                  canUpdateEnrollments &&
                  er !== 'teacher' &&
                  er !== 'student' &&
                  (isCourseCreator || er === 'instructor')
                const showGroupAssign =
                  enrollmentGroupsEnabled && canUpdateEnrollments && er === 'student'
                const showSectionTransfer =
                  sectionsEnabled && canUpdateEnrollments && er === 'student' && sections.length > 1
                return (
                  <tr
                    key={e.id}
                    className="group border-b border-slate-100 last:border-0"
                  >
                    <td className="px-4 py-3 font-medium text-slate-900">
                      {e.displayName?.trim() || '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      <EnrollmentRoleBadge courseRoleKey={e.role} roleDisplay={e.roleDisplay} />
                    </td>
                    {sectionsEnabled ? (
                      <td className="px-4 py-3 text-slate-600">
                        {e.sectionCode?.trim()
                          ? e.sectionName?.trim()
                            ? `${e.sectionCode} (${e.sectionName})`
                            : e.sectionCode
                          : '—'}
                      </td>
                    ) : null}
                    <td className="px-4 py-3 text-slate-600">
                      {formatTimeAgoFromIso(e.lastCourseAccessAt, relativeNowMs)}
                    </td>
                    {canUpdateEnrollments && (
                      <td className="px-2 py-3 text-right align-middle">
                        {showEdit || showRemove || showGroupAssign || showSectionTransfer ? (
                          <div className="inline-flex items-center justify-end gap-0.5">
                            {showSectionTransfer ? (
                              <button
                                type="button"
                                onClick={() => openSectionTransferModal(e)}
                                className="inline-flex rounded-lg p-1.5 text-slate-400 opacity-0 transition hover:bg-indigo-50 hover:text-indigo-800 group-hover:opacity-100 focus-visible:opacity-100 dark:hover:bg-indigo-950/40 dark:hover:text-indigo-200"
                                aria-label={`Change section for ${e.displayName?.trim() || 'this student'}`}
                              >
                                <Shuffle className="h-4 w-4" aria-hidden />
                              </button>
                            ) : null}
                            {showGroupAssign ? (
                              <button
                                type="button"
                                onClick={() => openGroupAssignModal(e)}
                                className="inline-flex rounded-lg p-1.5 text-slate-400 opacity-0 transition hover:bg-indigo-50 hover:text-indigo-800 group-hover:opacity-100 focus-visible:opacity-100 dark:hover:bg-indigo-950/40 dark:hover:text-indigo-200"
                                aria-label={`Assign groups for ${e.displayName?.trim() || 'this person'}`}
                              >
                                <UsersRound className="h-4 w-4" aria-hidden />
                              </button>
                            ) : null}
                            {showEdit ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setEditTarget(e)
                                  setEditBuiltinCourseRole(normEnrollmentRole(e.role))
                                  setEditSaveStatus('idle')
                                  setEditMessage(null)
                                  setDemoteStatus('idle')
                                }}
                                className="inline-flex rounded-lg p-1.5 text-slate-400 opacity-0 transition hover:bg-indigo-50 hover:text-indigo-800 group-hover:opacity-100 focus-visible:opacity-100"
                                aria-label={`Edit role for ${e.displayName?.trim() || 'this person'}`}
                              >
                                <Pencil className="h-4 w-4" aria-hidden />
                              </button>
                            ) : null}
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
                          </div>
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

      {mainTab === 'groups' && enrollmentGroupsEnabled && courseCode ? (
        <EnrollmentGroupsPanel
          courseCode={courseCode}
          enrollments={enrollments ?? []}
          canEdit={canUpdateEnrollments}
        />
      ) : null}

      {groupAssignTarget && (
        <div
          className={LMS_MODAL_OVERLAY_CLASS}
          role="dialog"
          aria-modal="true"
          aria-labelledby="group-assign-title"
          onClick={(ev) => {
            if (ev.target === ev.currentTarget) closeGroupAssignModal()
          }}
        >
          <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-neutral-700 dark:bg-neutral-900">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-neutral-700">
              <h3
                id="group-assign-title"
                className="text-sm font-semibold text-slate-900 dark:text-neutral-100"
              >
                Group membership
              </h3>
              <button
                type="button"
                onClick={() => closeGroupAssignModal()}
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-neutral-400 dark:hover:bg-neutral-800"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="max-h-[min(28rem,70vh)] overflow-y-auto p-4 text-sm text-slate-700 dark:text-neutral-300">
              <p className="font-medium text-slate-900 dark:text-neutral-100">
                {groupAssignTarget.displayName?.trim() || '—'}
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-neutral-400">
                Student enrollments only. Choose a group per set, or leave unassigned.
              </p>
              {groupAssignLoading ? (
                <p className="mt-4 text-sm text-slate-500 dark:text-neutral-400">Loading groups…</p>
              ) : groupAssignTree && groupAssignTree.groupSets.length > 0 ? (
                <div className="mt-4 space-y-4">
                  {groupAssignTree.groupSets.map((set) => (
                    <div key={set.id}>
                      <label
                        className="text-xs font-medium text-slate-600 dark:text-neutral-400"
                        htmlFor={`group-pick-${set.id}`}
                      >
                        {set.name}
                      </label>
                      <select
                        id={`group-pick-${set.id}`}
                        value={groupAssignSelections[set.id] ?? ''}
                        onChange={(ev) =>
                          setGroupAssignSelections((prev) => ({
                            ...prev,
                            [set.id]: ev.target.value,
                          }))
                        }
                        className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none ring-indigo-500/20 focus:border-indigo-400 focus:ring-2 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100"
                        disabled={groupAssignStatus === 'loading'}
                      >
                        <option value="">Unassigned</option>
                        {set.groups.map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-4 text-sm text-slate-500 dark:text-neutral-400">
                  No group sets are configured yet. Open the Groups tab to add some.
                </p>
              )}
              {groupAssignMessage && (
                <p
                  className={
                    groupAssignStatus === 'error'
                      ? 'mt-3 text-sm text-rose-700 dark:text-rose-300'
                      : 'mt-3 text-sm text-slate-600 dark:text-neutral-400'
                  }
                  role="status"
                >
                  {groupAssignMessage}
                </p>
              )}
              <div className="mt-6 flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={() => closeGroupAssignModal()}
                  className="rounded-xl px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void onSaveGroupAssignments()}
                  disabled={
                    groupAssignStatus === 'loading' || groupAssignLoading || !groupAssignTree
                  }
                  className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {groupAssignStatus === 'loading' ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {sectionTransferTarget && (
        <div
          className={LMS_MODAL_OVERLAY_CLASS}
          role="dialog"
          aria-modal="true"
          aria-labelledby="section-transfer-title"
          onClick={(ev) => {
            if (ev.target === ev.currentTarget) closeSectionTransferModal()
          }}
        >
          <div className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-neutral-700 dark:bg-neutral-900">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-neutral-700">
              <h3
                id="section-transfer-title"
                className="text-sm font-semibold text-slate-900 dark:text-neutral-100"
              >
                Move to section
              </h3>
              <button
                type="button"
                onClick={() => closeSectionTransferModal()}
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-neutral-400 dark:hover:bg-neutral-800"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={onSubmitSectionTransfer} className="space-y-4 p-4 text-sm text-slate-700 dark:text-neutral-300">
              <p className="font-medium text-slate-900 dark:text-neutral-100">
                {sectionTransferTarget.displayName?.trim() || 'Student'}
              </p>
              <label className="block">
                <span className="text-xs font-medium text-slate-600 dark:text-neutral-400">New section</span>
                <select
                  value={sectionTransferPick}
                  onChange={(ev) => setSectionTransferPick(ev.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100"
                  aria-label="Select section to transfer this student into"
                  disabled={sectionTransferStatus === 'loading'}
                >
                  {sections
                    .filter((s) => s.id !== sectionTransferTarget.sectionId)
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.sectionCode}
                        {s.name ? ` — ${s.name}` : ''}
                      </option>
                    ))}
                </select>
              </label>
              {sectionTransferMessage ? (
                <p className="text-sm text-rose-700 dark:text-rose-300" role="alert">
                  {sectionTransferMessage}
                </p>
              ) : null}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => closeSectionTransferModal()}
                  className="rounded-xl px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={sectionTransferStatus === 'loading' || !sectionTransferPick}
                  className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
                >
                  {sectionTransferStatus === 'loading' ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {editTarget && (
        <div
          className={LMS_MODAL_OVERLAY_CLASS}
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-enrollment-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeEditModal()
          }}
        >
          <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-neutral-700 dark:bg-neutral-900">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-neutral-700">
              <h3 id="edit-enrollment-title" className="text-sm font-semibold text-slate-900 dark:text-neutral-100">
                Edit enrollment
              </h3>
              <button
                type="button"
                onClick={() => closeEditModal()}
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-4 text-sm text-slate-700">
              <p className="font-medium text-slate-900">
                {editTarget.displayName?.trim() || '—'}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Current enrollment role: <span className="font-medium text-slate-700">{editTarget.role}</span>
              </p>

              {normEnrollmentRole(editTarget.role) === 'instructor' && !isCourseCreator && (
                <p className="mt-4 text-xs text-slate-600">
                  Demoting removes instructor access and per-course permissions for this course. Only
                  the course creator can assign a different course-scoped role.
                </p>
              )}

              {isCourseCreator && normEnrollmentRole(editTarget.role) !== 'teacher' && (
                <div className="mt-4">
                  <label htmlFor="edit-builtin-course-role" className="text-xs font-medium text-slate-600">
                    Enrollment role
                  </label>
                  <p className="mt-1 text-xs text-slate-500">
                    Built-in roles (TA, designer, observer, etc.) control what this person can see and
                    edit in this course.
                  </p>
                  <select
                    id="edit-builtin-course-role"
                    value={editBuiltinCourseRole}
                    onChange={(e) => setEditBuiltinCourseRole(e.target.value)}
                    className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none ring-indigo-500/20 focus:border-indigo-400 focus:ring-2 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100"
                    disabled={editSaveStatus === 'loading' || demoteStatus === 'loading'}
                  >
                    <option value="student">Student</option>
                    <option value="instructor">Instructor</option>
                    <option value="ta">Teaching assistant</option>
                    <option value="designer">Designer</option>
                    <option value="observer">Observer</option>
                    <option value="auditor">Auditor</option>
                    <option value="librarian">Librarian</option>
                  </select>
                </div>
              )}

              {editMessage && (
                <p
                  className={
                    editSaveStatus === 'error' || demoteStatus === 'error'
                      ? 'mt-3 text-sm text-rose-700'
                      : 'mt-3 text-sm text-slate-700'
                  }
                  role="status"
                >
                  {editMessage}
                </p>
              )}

              <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => closeEditModal()}
                  className="rounded-xl px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
                >
                  Close
                </button>
                {normEnrollmentRole(editTarget.role) === 'instructor' && (
                  <button
                    type="button"
                    onClick={() => void onDemoteEnrollmentToStudent()}
                    disabled={demoteStatus === 'loading' || editSaveStatus === 'loading'}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 shadow-sm hover:border-amber-200 hover:bg-amber-50 hover:text-amber-950 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {demoteStatus === 'loading' ? 'Demoting…' : 'Demote to student'}
                  </button>
                )}
                {isCourseCreator && (
                  <button
                    type="button"
                    onClick={() => void onSaveEditBuiltinRole()}
                    disabled={
                      editSaveStatus === 'loading' ||
                      demoteStatus === 'loading' ||
                      !editBuiltinCourseRole.trim()
                    }
                    className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {editSaveStatus === 'loading' ? 'Saving…' : 'Save role'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {modalOpen && (
        <div
          className={LMS_MODAL_OVERLAY_CLASS}
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-enrollment-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeModal()
          }}
        >
          <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-neutral-700 dark:bg-neutral-900">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-neutral-700">
              <h3 id="add-enrollment-title" className="text-sm font-semibold text-slate-900 dark:text-neutral-100">
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

              {viewerIsTeacher && (
                <div className="mt-4">
                  <label htmlFor="enrollment-builtin-role" className="text-xs font-medium text-slate-600">
                    Built-in enrollment role (optional)
                  </label>
                  <p className="mt-1 text-xs text-slate-500">
                    Pick a Lextures role (TA, designer, …) or leave blank and choose a course-scoped
                    app role instead.
                  </p>
                  <select
                    id="enrollment-builtin-role"
                    value={addCourseRole}
                    onChange={(e) => setAddCourseRole(e.target.value)}
                    className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none ring-indigo-500/20 focus:border-indigo-400 focus:ring-2 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100"
                    disabled={addStatus === 'loading'}
                  >
                    <option value="">— Use app role below —</option>
                    <option value="student">Student</option>
                    <option value="instructor">Instructor</option>
                    <option value="ta">Teaching assistant</option>
                    <option value="designer">Designer</option>
                    <option value="observer">Observer</option>
                    <option value="auditor">Auditor</option>
                    <option value="librarian">Librarian</option>
                  </select>
                </div>
              )}

              {isCourseCreator && !addCourseRole.trim() && (
                <div className="mt-4">
                  <label htmlFor="enrollment-app-role" className="text-xs font-medium text-slate-600">
                    Course-scoped app role
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
                      scope to Course), then add permissions — or use a built-in role above.
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
