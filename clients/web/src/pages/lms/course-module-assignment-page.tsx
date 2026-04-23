import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Pencil } from 'lucide-react'
import { ContentPageReader } from '../../components/content-page/content-page-reader'
import { SyllabusBlockEditor } from '../../components/syllabus/syllabus-block-editor'
import { markdownToSectionsForEditor, sectionsToMarkdown } from '../../components/syllabus/syllabus-section-markdown'
import { usePermissions } from '../../context/use-permissions'
import {
  fetchCourse,
  fetchCourseEnrollmentsList,
  fetchCourseGradingSettings,
  fetchModuleAssignment,
  fetchReaderMarkups,
  patchCourseStructureItemAssignmentGroup,
  patchModuleAssignment,
  type ContentPageMarkup,
  type CourseEnrollmentRosterRow,
  type LateSubmissionPolicy,
  type OriginalityDetectionMode,
  type OriginalityStudentVisibility,
  type RubricDefinition,
  type SyllabusSection,
} from '../../lib/courses-api'
import {
  type MarkdownThemeCustom,
  type ResolvedMarkdownTheme,
  resolveMarkdownTheme,
} from '../../lib/markdown-theme'
import { useLmsDarkMode } from '../../hooks/use-lms-dark-mode'
import { recordLastVisitedModuleItem } from '../../lib/last-visited-module-item'
import { getJwtSubject } from '../../lib/auth'
import { permCourseItemCreate } from '../../lib/rbac-api'
import { AssignmentPageSettingsPanel } from '../../components/assignment/assignment-page-settings-panel'
import { AssignmentAnnotationWorkbench } from '../../components/annotation/assignment-annotation-workbench'
import { LmsPage } from './lms-page'

function isoToDatetimeLocalValue(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function datetimeLocalValueToIso(value: string): string | null {
  const t = value.trim()
  if (!t) return null
  const d = new Date(t)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString()
}

function assignmentDateTimeIsSet(iso: string | null): boolean {
  if (!iso) return false
  const d = new Date(iso)
  return !Number.isNaN(d.getTime())
}

function formatOptionalDateTime(iso: string | null): string {
  if (!iso) return 'Not set'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'Not set'
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function formatPointsWorth(p: number | null): string {
  if (p == null) return 'Not set'
  return String(p)
}

function assignmentGroupDisplayName(
  groupId: string | null,
  groups: { id: string; name: string }[],
): string {
  if (!groupId) return 'Not set'
  const g = groups.find((x) => x.id === groupId)
  return g?.name ?? 'Unknown group'
}

function formatSubmissionTypes(text: boolean, file: boolean, url: boolean): string {
  const parts: string[] = []
  if (text) parts.push('Text')
  if (file) parts.push('File upload')
  if (url) parts.push('URL')
  return parts.join(', ')
}

function submissionTypesAreSet(text: boolean, file: boolean, url: boolean): boolean {
  return text || file || url
}

function formatLateSubmissionSummary(
  policy: LateSubmissionPolicy,
  penaltyPercent: number | null,
): string {
  if (policy === 'allow') return 'Allow (no penalty)'
  if (policy === 'block') return 'Block after due'
  return penaltyPercent != null ? `Penalty: ${penaltyPercent}% off` : 'Penalty (percent required when saving)'
}

function formatOriginalityDetection(mode: OriginalityDetectionMode): string {
  if (mode === 'plagiarism') return 'External similarity'
  if (mode === 'ai') return 'Internal AI signal'
  if (mode === 'both') return 'Similarity and AI signal'
  return 'Off'
}

function formatOriginalityStudentVisibility(v: OriginalityStudentVisibility): string {
  if (v === 'show') return 'Shown to students'
  if (v === 'show_after_grading') return 'Shown after a grade is posted'
  return 'Hidden from students'
}

function newLocalId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `local-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export default function CourseModuleAssignmentPage() {
  const { courseCode, itemId } = useParams<{ courseCode: string; itemId: string }>()
  const { allows, loading: permLoading } = usePermissions()

  const [title, setTitle] = useState('')
  const [markdown, setMarkdown] = useState('')
  const [dueAt, setDueAt] = useState<string | null>(null)
  const [pointsWorth, setPointsWorth] = useState<number | null>(null)
  const [availableFromAt, setAvailableFromAt] = useState<string | null>(null)
  const [availableUntilAt, setAvailableUntilAt] = useState<string | null>(null)
  const [submissionAllowText, setSubmissionAllowText] = useState(true)
  const [submissionAllowFileUpload, setSubmissionAllowFileUpload] = useState(false)
  const [submissionAllowUrl, setSubmissionAllowUrl] = useState(false)
  const [assignmentAccessCode, setAssignmentAccessCode] = useState('')
  const [requiresAssignmentAccessCode, setRequiresAssignmentAccessCode] = useState(false)
  const [lateSubmissionPolicy, setLateSubmissionPolicy] =
    useState<LateSubmissionPolicy>('allow')
  const [latePenaltyPercent, setLatePenaltyPercent] = useState<number | null>(null)

  const [draftDueLocal, setDraftDueLocal] = useState('')
  const [draftAvailableFromLocal, setDraftAvailableFromLocal] = useState('')
  const [draftAvailableUntilLocal, setDraftAvailableUntilLocal] = useState('')
  const [draftPointsWorth, setDraftPointsWorth] = useState<number | null>(null)
  const [draftSubmissionAllowText, setDraftSubmissionAllowText] = useState(true)
  const [draftSubmissionAllowFileUpload, setDraftSubmissionAllowFileUpload] = useState(false)
  const [draftSubmissionAllowUrl, setDraftSubmissionAllowUrl] = useState(false)
  const [draftAssignmentAccessCode, setDraftAssignmentAccessCode] = useState('')
  const [draftLateSubmissionPolicy, setDraftLateSubmissionPolicy] =
    useState<LateSubmissionPolicy>('allow')
  const [draftLatePenaltyPercent, setDraftLatePenaltyPercent] = useState<number | null>(null)
  const [rubric, setRubric] = useState<RubricDefinition | null>(null)
  const [draftRubric, setDraftRubric] = useState<RubricDefinition | null>(null)
  const [draftBlindGrading, setDraftBlindGrading] = useState(false)

  const [moderatedGrading, setModeratedGrading] = useState(false)
  const [draftModeratedGrading, setDraftModeratedGrading] = useState(false)
  const [moderationThresholdPct, setModerationThresholdPct] = useState(15)
  const [draftModerationThresholdPct, setDraftModerationThresholdPct] = useState(15)
  const [moderatorUserId, setModeratorUserId] = useState<string | null>(null)
  const [draftModeratorUserId, setDraftModeratorUserId] = useState<string | null>(null)
  const [provisionalGraderUserIds, setProvisionalGraderUserIds] = useState<string[]>([])
  const [draftProvisionalGraderUserIds, setDraftProvisionalGraderUserIds] = useState<string[]>([])
  const [originalityDetection, setOriginalityDetection] = useState<OriginalityDetectionMode>('disabled')
  const [draftOriginalityDetection, setDraftOriginalityDetection] =
    useState<OriginalityDetectionMode>('disabled')
  const [originalityStudentVisibility, setOriginalityStudentVisibility] =
    useState<OriginalityStudentVisibility>('hide')
  const [draftOriginalityStudentVisibility, setDraftOriginalityStudentVisibility] =
    useState<OriginalityStudentVisibility>('hide')
  const [staffRoster, setStaffRoster] = useState<CourseEnrollmentRosterRow[] | null>(null)

  const [gradingGroups, setGradingGroups] = useState<{ id: string; name: string }[]>([])
  const [gradingType, setGradingType] = useState('')
  const [draftGradingType, setDraftGradingType] = useState('')
  const [postingPolicy, setPostingPolicy] = useState<'automatic' | 'manual'>('automatic')
  const [draftPostingPolicy, setDraftPostingPolicy] = useState<'automatic' | 'manual'>('automatic')
  const [releaseAt, setReleaseAt] = useState<string | null>(null)
  const [draftReleaseLocal, setDraftReleaseLocal] = useState('')
  const [assignmentGroupId, setAssignmentGroupId] = useState<string | null>(null)
  const [neverDrop, setNeverDrop] = useState(false)
  const [replaceWithFinal, setReplaceWithFinal] = useState(false)
  const [draftNeverDrop, setDraftNeverDrop] = useState(false)
  const [draftReplaceWithFinal, setDraftReplaceWithFinal] = useState(false)
  const [assignmentGroupPatching, setAssignmentGroupPatching] = useState(false)
  const [assignmentGroupPatchError, setAssignmentGroupPatchError] = useState<string | null>(null)
  const [updatedAt, setUpdatedAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [markups, setMarkups] = useState<ContentPageMarkup[]>([])
  const [viewerEnrollmentRoles, setViewerEnrollmentRoles] = useState<string[]>([])
  const [annotationsEnabled, setAnnotationsEnabled] = useState(false)
  const [resubmissionWorkflowEnabled, setResubmissionWorkflowEnabled] = useState(false)
  const [feedbackMediaEnabled, setFeedbackMediaEnabled] = useState(false)
  const [blindGrading, setBlindGrading] = useState(false)
  const [identitiesRevealedAt, setIdentitiesRevealedAt] = useState<string | null>(null)
  const [viewerCanRevealIdentities, setViewerCanRevealIdentities] = useState(false)

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<SyllabusSection[]>([])
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [mdPreset, setMdPreset] = useState<string>('classic')
  const [mdCustom, setMdCustom] = useState<MarkdownThemeCustom | null>(null)
  const lmsUiDark = useLmsDarkMode()
  const mdTheme = useMemo(
    (): ResolvedMarkdownTheme => resolveMarkdownTheme(mdPreset, mdCustom, { lmsUiDark }),
    [mdPreset, mdCustom, lmsUiDark],
  )

  const assignmentMarkupTarget = useMemo(
    () => ({ variant: 'assignment' as const, itemId: itemId! }),
    [itemId],
  )

  const loadMarkups = useCallback(async () => {
    if (!courseCode || !itemId) return
    try {
      const list = await fetchReaderMarkups(courseCode, assignmentMarkupTarget)
      setMarkups(list)
    } catch {
      setMarkups([])
    }
  }, [assignmentMarkupTarget, courseCode, itemId])

  const canEdit = Boolean(
    courseCode && itemId && !permLoading && allows(permCourseItemCreate(courseCode)),
  )

  const load = useCallback(async () => {
    if (!courseCode || !itemId) return
    setLoading(true)
    setLoadError(null)
    try {
      const [data, courseRow] = await Promise.all([
        fetchModuleAssignment(courseCode, itemId),
        fetchCourse(courseCode),
      ])
      setTitle(data.title)
      setMarkdown(data.markdown)
      setDueAt(data.dueAt)
      setPointsWorth(data.pointsWorth ?? null)
      setAvailableFromAt(data.availableFrom)
      setAvailableUntilAt(data.availableUntil)
      setSubmissionAllowText(data.submissionAllowText)
      setSubmissionAllowFileUpload(data.submissionAllowFileUpload)
      setSubmissionAllowUrl(data.submissionAllowUrl)
      setRequiresAssignmentAccessCode(data.requiresAssignmentAccessCode)
      setAssignmentAccessCode(data.assignmentAccessCode ?? '')
      setLateSubmissionPolicy(data.lateSubmissionPolicy)
      setLatePenaltyPercent(data.latePenaltyPercent)
      setRubric(data.rubric)
      setDraftRubric(data.rubric)
      setBlindGrading(data.blindGrading)
      setDraftBlindGrading(data.blindGrading)
      setModeratedGrading(Boolean(data.moderatedGrading))
      setDraftModeratedGrading(Boolean(data.moderatedGrading))
      setModerationThresholdPct(data.moderationThresholdPct ?? 15)
      setDraftModerationThresholdPct(data.moderationThresholdPct ?? 15)
      setModeratorUserId(data.moderatorUserId)
      setDraftModeratorUserId(data.moderatorUserId)
      setProvisionalGraderUserIds(data.provisionalGraderUserIds ?? [])
      setDraftProvisionalGraderUserIds(data.provisionalGraderUserIds ?? [])
      setIdentitiesRevealedAt(data.identitiesRevealedAt)
      setViewerCanRevealIdentities(data.viewerCanRevealIdentities)
      setOriginalityDetection(data.originalityDetection)
      setDraftOriginalityDetection(data.originalityDetection)
      setOriginalityStudentVisibility(data.originalityStudentVisibility)
      setDraftOriginalityStudentVisibility(data.originalityStudentVisibility)
      setGradingType(data.gradingType ?? '')
      setDraftGradingType(data.gradingType ?? '')
      const pp = data.postingPolicy === 'manual' ? 'manual' : 'automatic'
      setPostingPolicy(pp)
      setDraftPostingPolicy(pp)
      setReleaseAt(data.releaseAt ?? null)
      setDraftReleaseLocal(isoToDatetimeLocalValue(data.releaseAt ?? null))
      setAssignmentGroupId(data.assignmentGroupId ?? null)
      const nd = data.neverDrop === true
      const rwf = data.replaceWithFinal === true
      setNeverDrop(nd)
      setReplaceWithFinal(rwf)
      setDraftNeverDrop(nd)
      setDraftReplaceWithFinal(rwf)
      setAssignmentGroupPatchError(null)
      try {
        const grading = await fetchCourseGradingSettings(courseCode)
        setGradingGroups(
          grading.assignmentGroups.filter((g) => g.id.trim()).map((g) => ({ id: g.id, name: g.name })),
        )
      } catch {
        setGradingGroups([])
      }
      if (allows(permCourseItemCreate(courseCode))) {
        try {
          const roster = await fetchCourseEnrollmentsList(courseCode)
          setStaffRoster(
            roster.filter((r) => r.role === 'Teacher' || r.role === 'Instructor'),
          )
        } catch {
          setStaffRoster([])
        }
      } else {
        setStaffRoster(null)
      }
      setUpdatedAt(data.updatedAt)
      setMdPreset(courseRow.markdownThemePreset)
      setMdCustom(courseRow.markdownThemeCustom)
      setViewerEnrollmentRoles(courseRow.viewerEnrollmentRoles ?? [])
      setAnnotationsEnabled(Boolean(courseRow.annotationsEnabled))
      setResubmissionWorkflowEnabled(Boolean(courseRow.resubmissionWorkflowEnabled))
      setFeedbackMediaEnabled(Boolean(courseRow.feedbackMediaEnabled))
      recordLastVisitedModuleItem(courseCode, {
        itemId,
        kind: 'assignment',
        title: data.title,
      })
      void loadMarkups()
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not load this assignment.')
      setTitle('')
      setMarkdown('')
      setDueAt(null)
      setPointsWorth(null)
      setAvailableFromAt(null)
      setAvailableUntilAt(null)
      setGradingGroups([])
      setAssignmentGroupId(null)
      setNeverDrop(false)
      setReplaceWithFinal(false)
      setDraftNeverDrop(false)
      setDraftReplaceWithFinal(false)
      setRubric(null)
      setDraftRubric(null)
      setUpdatedAt(null)
      setMarkups([])
      setViewerEnrollmentRoles([])
      setAnnotationsEnabled(false)
      setResubmissionWorkflowEnabled(false)
      setBlindGrading(false)
      setDraftBlindGrading(false)
      setModeratedGrading(false)
      setDraftModeratedGrading(false)
      setModerationThresholdPct(15)
      setDraftModerationThresholdPct(15)
      setModeratorUserId(null)
      setDraftModeratorUserId(null)
      setProvisionalGraderUserIds([])
      setDraftProvisionalGraderUserIds([])
      setIdentitiesRevealedAt(null)
      setViewerCanRevealIdentities(false)
      setOriginalityDetection('disabled')
      setDraftOriginalityDetection('disabled')
      setOriginalityStudentVisibility('hide')
      setDraftOriginalityStudentVisibility('hide')
      setGradingType('')
      setDraftGradingType('')
      setStaffRoster(null)
    } finally {
      setLoading(false)
    }
  }, [allows, courseCode, itemId, loadMarkups])

  useEffect(() => {
    void load()
  }, [load])

  function syncDraftsFromSaved() {
    setDraftDueLocal(isoToDatetimeLocalValue(dueAt))
    setDraftAvailableFromLocal(isoToDatetimeLocalValue(availableFromAt))
    setDraftAvailableUntilLocal(isoToDatetimeLocalValue(availableUntilAt))
    setDraftPointsWorth(pointsWorth)
    setDraftSubmissionAllowText(submissionAllowText)
    setDraftSubmissionAllowFileUpload(submissionAllowFileUpload)
    setDraftSubmissionAllowUrl(submissionAllowUrl)
    setDraftAssignmentAccessCode(assignmentAccessCode)
    setDraftLateSubmissionPolicy(lateSubmissionPolicy)
    setDraftLatePenaltyPercent(latePenaltyPercent)
    setDraftRubric(rubric)
    setDraftBlindGrading(blindGrading)
    setDraftModeratedGrading(moderatedGrading)
    setDraftModerationThresholdPct(moderationThresholdPct)
    setDraftModeratorUserId(moderatorUserId)
    setDraftProvisionalGraderUserIds(provisionalGraderUserIds)
    setDraftOriginalityDetection(originalityDetection)
    setDraftOriginalityStudentVisibility(originalityStudentVisibility)
    setDraftGradingType(gradingType)
    setDraftPostingPolicy(postingPolicy)
    setDraftReleaseLocal(isoToDatetimeLocalValue(releaseAt))
    setDraftNeverDrop(neverDrop)
    setDraftReplaceWithFinal(replaceWithFinal)
  }

  function beginEdit() {
    setSaveError(null)
    setAssignmentGroupPatchError(null)
    setDraft(markdownToSectionsForEditor(markdown, newLocalId))
    syncDraftsFromSaved()
    setEditing(true)
  }

  function cancelEdit() {
    setSaveError(null)
    setAssignmentGroupPatchError(null)
    setEditing(false)
    setDraft([])
    syncDraftsFromSaved()
  }

  async function onAssignmentGroupChange(next: string | null) {
    if (!courseCode || !itemId || !canEdit) return
    setAssignmentGroupPatchError(null)
    setAssignmentGroupPatching(true)
    try {
      const updated = await patchCourseStructureItemAssignmentGroup(courseCode, itemId, next)
      setAssignmentGroupId(updated.assignmentGroupId ?? null)
    } catch (e) {
      setAssignmentGroupPatchError(
        e instanceof Error ? e.message : 'Could not update assignment group.',
      )
    } finally {
      setAssignmentGroupPatching(false)
    }
  }

  async function save() {
    if (!courseCode || !itemId) return
    const body = sectionsToMarkdown(draft)
    setSaveError(null)
    setSaving(true)
    try {
      const data = await patchModuleAssignment(courseCode, itemId, {
        markdown: body,
        dueAt: datetimeLocalValueToIso(draftDueLocal),
        pointsWorth: draftPointsWorth,
        availableFrom: datetimeLocalValueToIso(draftAvailableFromLocal),
        availableUntil: datetimeLocalValueToIso(draftAvailableUntilLocal),
        assignmentAccessCode: draftAssignmentAccessCode.trim() === '' ? null : draftAssignmentAccessCode.trim(),
        submissionAllowText: draftSubmissionAllowText,
        submissionAllowFileUpload: draftSubmissionAllowFileUpload,
        submissionAllowUrl: draftSubmissionAllowUrl,
        lateSubmissionPolicy: draftLateSubmissionPolicy,
        latePenaltyPercent: draftLatePenaltyPercent,
        rubric: draftRubric,
        blindGrading: draftBlindGrading,
        moderatedGrading: draftModeratedGrading,
        moderationThresholdPct: draftModerationThresholdPct,
        moderatorUserId: draftModeratedGrading ? draftModeratorUserId : null,
        provisionalGraderUserIds: draftModeratedGrading ? draftProvisionalGraderUserIds : [],
        originalityDetection: draftOriginalityDetection,
        originalityStudentVisibility: draftOriginalityStudentVisibility,
        gradingType: draftGradingType.trim() === '' ? null : draftGradingType.trim(),
        postingPolicy: draftPostingPolicy,
        releaseAt: datetimeLocalValueToIso(draftReleaseLocal),
        neverDrop: draftNeverDrop,
        replaceWithFinal: draftReplaceWithFinal,
      })
      setMarkdown(data.markdown)
      setDueAt(data.dueAt)
      setPointsWorth(data.pointsWorth ?? null)
      setAvailableFromAt(data.availableFrom)
      setAvailableUntilAt(data.availableUntil)
      setSubmissionAllowText(data.submissionAllowText)
      setSubmissionAllowFileUpload(data.submissionAllowFileUpload)
      setSubmissionAllowUrl(data.submissionAllowUrl)
      setLateSubmissionPolicy(data.lateSubmissionPolicy)
      setLatePenaltyPercent(data.latePenaltyPercent)
      setRubric(data.rubric)
      setDraftRubric(data.rubric)
      setBlindGrading(data.blindGrading)
      setDraftBlindGrading(data.blindGrading)
      setModeratedGrading(Boolean(data.moderatedGrading))
      setDraftModeratedGrading(Boolean(data.moderatedGrading))
      setModerationThresholdPct(data.moderationThresholdPct ?? 15)
      setDraftModerationThresholdPct(data.moderationThresholdPct ?? 15)
      setModeratorUserId(data.moderatorUserId)
      setDraftModeratorUserId(data.moderatorUserId)
      setProvisionalGraderUserIds(data.provisionalGraderUserIds ?? [])
      setDraftProvisionalGraderUserIds(data.provisionalGraderUserIds ?? [])
      setIdentitiesRevealedAt(data.identitiesRevealedAt)
      setViewerCanRevealIdentities(data.viewerCanRevealIdentities)
      setOriginalityDetection(data.originalityDetection)
      setDraftOriginalityDetection(data.originalityDetection)
      setOriginalityStudentVisibility(data.originalityStudentVisibility)
      setDraftOriginalityStudentVisibility(data.originalityStudentVisibility)
      setGradingType(data.gradingType ?? '')
      setDraftGradingType(data.gradingType ?? '')
      const ppa = data.postingPolicy === 'manual' ? 'manual' : 'automatic'
      setPostingPolicy(ppa)
      setDraftPostingPolicy(ppa)
      setReleaseAt(data.releaseAt ?? null)
      setDraftReleaseLocal(isoToDatetimeLocalValue(data.releaseAt ?? null))
      setRequiresAssignmentAccessCode(data.requiresAssignmentAccessCode)
      setAssignmentAccessCode(data.assignmentAccessCode ?? '')
      setAssignmentGroupId(data.assignmentGroupId ?? null)
      const savedNd = data.neverDrop === true
      const savedRwf = data.replaceWithFinal === true
      setNeverDrop(savedNd)
      setReplaceWithFinal(savedRwf)
      setDraftNeverDrop(savedNd)
      setDraftReplaceWithFinal(savedRwf)
      setUpdatedAt(data.updatedAt)
      setEditing(false)
      setDraft([])
      void loadMarkups()
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Could not save.')
    } finally {
      setSaving(false)
    }
  }

  const staffDirectory = useMemo(
    () =>
      (staffRoster ?? []).map((r) => ({
        userId: r.userId,
        label: r.displayName?.trim() ? r.displayName.trim() : `Staff ${r.userId.slice(0, 8)}…`,
      })),
    [staffRoster],
  )

  const myUserId = getJwtSubject()
  const viewerCanModerate = Boolean(
    viewerCanRevealIdentities || (moderatorUserId != null && moderatorUserId === myUserId),
  )

  const moderationDashboardPath =
    courseCode && itemId
      ? `/courses/${encodeURIComponent(courseCode)}/modules/assignment/${encodeURIComponent(itemId)}/moderation`
      : ''

  if (!courseCode || !itemId) {
    return (
      <LmsPage title="Assignment" description="">
        <p className="mt-6 text-sm text-slate-500">Invalid link.</p>
      </LmsPage>
    )
  }

  const description =
    updatedAt == null
      ? ''
      : `Updated ${new Date(updatedAt).toLocaleString(undefined, {
          dateStyle: 'medium',
          timeStyle: 'short',
        })}`

  const backTo = `/courses/${encodeURIComponent(courseCode)}/modules`

  const viewerIsCourseStaff = viewerEnrollmentRoles.some(
    (r) => r === 'teacher' || r === 'instructor',
  )

  return (
    <LmsPage
      title={loading ? 'Assignment' : title || 'Assignment'}
      description={description}
      actions={
        editing ? (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={cancelEdit}
              disabled={saving}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            {canEdit ? (
              <button
                type="button"
                onClick={beginEdit}
                disabled={loading}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Pencil className="h-4 w-4" aria-hidden />
                Edit
              </button>
            ) : null}
            {viewerCanModerate && moderatedGrading ? (
              <Link
                to={moderationDashboardPath}
                className="inline-flex items-center rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-sm font-semibold text-indigo-900 shadow-sm transition hover:bg-indigo-100 dark:border-indigo-900 dark:bg-indigo-950/60 dark:text-indigo-100 dark:hover:bg-indigo-950"
              >
                Reconciliation
              </Link>
            ) : null}
          </div>
        )
      }
    >
      <p className="mt-2 text-left text-sm">
        <Link to={backTo} className="font-medium text-indigo-600 hover:text-indigo-500">
          ← Back to modules
        </Link>
      </p>

      <div className="mx-auto w-full max-w-5xl min-w-0">
        {loadError && (
          <p className="mt-6 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            {loadError}
          </p>
        )}
        {loading && <p className="mt-8 text-sm text-slate-500">Loading…</p>}

        {!loading && !loadError && !editing && (
          <div className="mt-8 space-y-6">
            <div className="rounded-2xl border border-slate-200/90 bg-slate-50/70 p-4 dark:border-neutral-600 dark:bg-neutral-900/90">
              <dl className="space-y-2 text-sm">
                {assignmentDateTimeIsSet(dueAt) ? (
                  <div className="flex justify-between gap-4">
                    <dt className="shrink-0 text-slate-500 dark:text-neutral-400">Due date</dt>
                    <dd className="min-w-0 text-right font-medium text-slate-900 dark:text-neutral-100">
                      {formatOptionalDateTime(dueAt)}
                    </dd>
                  </div>
                ) : null}
                {assignmentDateTimeIsSet(availableFromAt) ? (
                  <div className="flex justify-between gap-4">
                    <dt className="shrink-0 text-slate-500 dark:text-neutral-400">Visibility start</dt>
                    <dd className="min-w-0 text-right font-medium text-slate-900 dark:text-neutral-100">
                      {formatOptionalDateTime(availableFromAt)}
                    </dd>
                  </div>
                ) : null}
                {assignmentDateTimeIsSet(availableUntilAt) ? (
                  <div className="flex justify-between gap-4">
                    <dt className="shrink-0 text-slate-500 dark:text-neutral-400">Visibility end</dt>
                    <dd className="min-w-0 text-right font-medium text-slate-900 dark:text-neutral-100">
                      {formatOptionalDateTime(availableUntilAt)}
                    </dd>
                  </div>
                ) : null}
                {submissionTypesAreSet(submissionAllowText, submissionAllowFileUpload, submissionAllowUrl) ? (
                  <div className="flex justify-between gap-4">
                    <dt className="shrink-0 text-slate-500 dark:text-neutral-400">Submission types</dt>
                    <dd className="min-w-0 text-right font-medium text-slate-900 dark:text-neutral-100">
                      {formatSubmissionTypes(submissionAllowText, submissionAllowFileUpload, submissionAllowUrl)}
                    </dd>
                  </div>
                ) : null}
                {originalityDetection !== 'disabled' ? (
                  <>
                    <div className="flex justify-between gap-4">
                      <dt className="shrink-0 text-slate-500 dark:text-neutral-400">Originality checks</dt>
                      <dd className="min-w-0 text-right font-medium text-slate-900 dark:text-neutral-100">
                        {formatOriginalityDetection(originalityDetection)}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt className="shrink-0 text-slate-500 dark:text-neutral-400">Student score visibility</dt>
                      <dd className="min-w-0 text-right font-medium text-slate-900 dark:text-neutral-100">
                        {formatOriginalityStudentVisibility(originalityStudentVisibility)}
                      </dd>
                    </div>
                  </>
                ) : null}
                <div className="flex justify-between gap-4">
                  <dt className="shrink-0 text-slate-500 dark:text-neutral-400">Late submission</dt>
                  <dd className="min-w-0 text-right font-medium text-slate-900 dark:text-neutral-100">
                    {formatLateSubmissionSummary(lateSubmissionPolicy, latePenaltyPercent)}
                  </dd>
                </div>
                {pointsWorth != null ? (
                  <div className="flex justify-between gap-4">
                    <dt className="shrink-0 text-slate-500 dark:text-neutral-400">Points</dt>
                    <dd className="min-w-0 text-right font-medium text-slate-900 dark:text-neutral-100">
                      {formatPointsWorth(pointsWorth)}
                    </dd>
                  </div>
                ) : null}
                {assignmentGroupId ? (
                  <div className="flex justify-between gap-4">
                    <dt className="shrink-0 text-slate-500 dark:text-neutral-400">Assignment group</dt>
                    <dd className="min-w-0 text-right font-medium text-slate-900 dark:text-neutral-100">
                      {assignmentGroupDisplayName(assignmentGroupId, gradingGroups)}
                    </dd>
                  </div>
                ) : null}
                {rubric && rubric.criteria.length > 0 ? (
                  <div className="flex justify-between gap-4">
                    <dt className="shrink-0 text-slate-500 dark:text-neutral-400">Rubric</dt>
                    <dd className="min-w-0 text-right font-medium text-slate-900 dark:text-neutral-100">
                      {`${rubric.criteria.length} criteria`}
                    </dd>
                  </div>
                ) : null}
                {blindGrading ? (
                  <div className="flex justify-between gap-4">
                    <dt className="shrink-0 text-slate-500 dark:text-neutral-400">Blind grading</dt>
                    <dd className="min-w-0 text-right font-medium text-slate-900 dark:text-neutral-100">
                      {identitiesRevealedAt
                        ? `Identities revealed ${formatOptionalDateTime(identitiesRevealedAt)}`
                        : 'Active (identities hidden)'}
                    </dd>
                  </div>
                ) : null}
                {viewerIsCourseStaff && moderatedGrading ? (
                  <div className="flex justify-between gap-4">
                    <dt className="shrink-0 text-slate-500 dark:text-neutral-400">Moderated grading</dt>
                    <dd className="min-w-0 text-right font-medium text-slate-900 dark:text-neutral-100">
                      Enabled ({moderationThresholdPct}% threshold)
                    </dd>
                  </div>
                ) : null}
                {requiresAssignmentAccessCode ? (
                  <div className="flex justify-between gap-4">
                    <dt className="shrink-0 text-slate-500 dark:text-neutral-400">Access code</dt>
                    <dd className="min-w-0 text-right font-medium text-slate-900 dark:text-neutral-100">Required</dd>
                  </div>
                ) : null}
              </dl>
            </div>
            <ContentPageReader
              markdown={markdown}
              theme={mdTheme}
              markups={markups}
              onMarkupsChange={loadMarkups}
              courseCode={courseCode}
              markupTarget={assignmentMarkupTarget}
              contentTitle={title || 'Assignment'}
              emptyMessage="No instructions yet. Select Edit to add Markdown."
            />
            {itemId &&
            (feedbackMediaEnabled || (annotationsEnabled && submissionAllowFileUpload)) ? (
              <AssignmentAnnotationWorkbench
                courseCode={courseCode}
                itemId={itemId}
                assignmentTitle={title}
                mode={viewerIsCourseStaff ? 'staff' : 'student'}
                submissionAllowsFile={submissionAllowFileUpload}
                annotationsActive={Boolean(annotationsEnabled && submissionAllowFileUpload)}
                feedbackMediaEnabled={Boolean(feedbackMediaEnabled)}
                resubmissionWorkflowEnabled={resubmissionWorkflowEnabled}
                blindGradingActive={
                  Boolean(blindGrading && !identitiesRevealedAt && viewerIsCourseStaff)
                }
                canRevealIdentities={viewerCanRevealIdentities}
                onAfterRevealIdentities={() => void load()}
                moderatedGradingActive={Boolean(moderatedGrading && viewerIsCourseStaff)}
                assignmentPointsWorth={pointsWorth}
                provisionalGraderUserIds={provisionalGraderUserIds}
                originalityDetection={originalityDetection}
              />
            ) : null}
          </div>
        )}
      </div>

      {!loading && !loadError && editing && (
        <div className="mt-6 -mx-6 md:-mx-8">
          {saveError && (
            <p className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-6 py-3 text-sm text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/50 dark:text-rose-200 md:px-8">
              {saveError}
            </p>
          )}
          {assignmentGroupPatchError && (
            <p className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-6 py-3 text-sm text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/50 dark:text-rose-200 md:px-8">
              {assignmentGroupPatchError}
            </p>
          )}
          <div className="px-4 md:px-8">
            <SyllabusBlockEditor
              courseCode={courseCode}
              sections={draft}
              onChange={setDraft}
              disabled={saving}
              documentVariant="page"
              pageDocumentPanel={
                canEdit ? (
                  <AssignmentPageSettingsPanel
                    disabled={saving}
                    dueLocal={draftDueLocal}
                    onDueLocalChange={setDraftDueLocal}
                    availableFromLocal={draftAvailableFromLocal}
                    onAvailableFromLocalChange={setDraftAvailableFromLocal}
                    availableUntilLocal={draftAvailableUntilLocal}
                    onAvailableUntilLocalChange={setDraftAvailableUntilLocal}
                    pointsWorth={draftPointsWorth}
                    onPointsWorthChange={setDraftPointsWorth}
                    gradingGroups={gradingGroups}
                    assignmentGroupId={assignmentGroupId}
                    onAssignmentGroupChange={(gid) => void onAssignmentGroupChange(gid)}
                    assignmentGroupSelectDisabled={assignmentGroupPatching}
                    submissionAllowText={draftSubmissionAllowText}
                    onSubmissionAllowTextChange={setDraftSubmissionAllowText}
                    submissionAllowFileUpload={draftSubmissionAllowFileUpload}
                    onSubmissionAllowFileUploadChange={setDraftSubmissionAllowFileUpload}
                    submissionAllowUrl={draftSubmissionAllowUrl}
                    onSubmissionAllowUrlChange={setDraftSubmissionAllowUrl}
                    assignmentAccessCode={draftAssignmentAccessCode}
                    onAssignmentAccessCodeChange={setDraftAssignmentAccessCode}
                    lateSubmissionPolicy={draftLateSubmissionPolicy}
                    onLateSubmissionPolicyChange={setDraftLateSubmissionPolicy}
                    latePenaltyPercent={draftLatePenaltyPercent}
                    onLatePenaltyPercentChange={setDraftLatePenaltyPercent}
                    draftRubric={draftRubric}
                    onDraftRubricChange={setDraftRubric}
                    courseCode={courseCode}
                    assignmentItemId={itemId}
                    assignmentMarkdown={sectionsToMarkdown(draft)}
                    blindGrading={draftBlindGrading}
                    onBlindGradingChange={setDraftBlindGrading}
                    moderatedGrading={draftModeratedGrading}
                    onModeratedGradingChange={setDraftModeratedGrading}
                    moderationThresholdPct={draftModerationThresholdPct}
                    onModerationThresholdPctChange={setDraftModerationThresholdPct}
                    moderatorUserId={draftModeratorUserId}
                    onModeratorUserIdChange={setDraftModeratorUserId}
                    provisionalGraderUserIds={draftProvisionalGraderUserIds}
                    onProvisionalGraderUserIdsChange={setDraftProvisionalGraderUserIds}
                    staffDirectory={staffDirectory}
                    originalityDetection={draftOriginalityDetection}
                    onOriginalityDetectionChange={setDraftOriginalityDetection}
                    originalityStudentVisibility={draftOriginalityStudentVisibility}
                    onOriginalityStudentVisibilityChange={setDraftOriginalityStudentVisibility}
                    gradingDisplayType={draftGradingType}
                    onGradingDisplayTypeChange={setDraftGradingType}
                    postingPolicy={draftPostingPolicy}
                    onPostingPolicyChange={setDraftPostingPolicy}
                    releaseAtLocal={draftReleaseLocal}
                    onReleaseAtLocalChange={setDraftReleaseLocal}
                    neverDrop={draftNeverDrop}
                    onNeverDropChange={setDraftNeverDrop}
                    replaceWithFinal={draftReplaceWithFinal}
                    onReplaceWithFinalChange={setDraftReplaceWithFinal}
                  />
                ) : null
              }
            />
          </div>
        </div>
      )}
    </LmsPage>
  )
}
