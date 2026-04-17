import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Pencil } from 'lucide-react'
import { ContentPageReader } from '../../components/content-page/ContentPageReader'
import { SyllabusBlockEditor } from '../../components/syllabus/SyllabusBlockEditor'
import { markdownToSectionsForEditor, sectionsToMarkdown } from '../../components/syllabus/syllabusSectionMarkdown'
import { usePermissions } from '../../context/usePermissions'
import {
  fetchCourse,
  fetchCourseGradingSettings,
  fetchModuleAssignment,
  fetchReaderMarkups,
  patchCourseStructureItemAssignmentGroup,
  patchModuleAssignment,
  type ContentPageMarkup,
  type LateSubmissionPolicy,
  type RubricDefinition,
  type SyllabusSection,
} from '../../lib/coursesApi'
import {
  type MarkdownThemeCustom,
  type ResolvedMarkdownTheme,
  resolveMarkdownTheme,
} from '../../lib/markdownTheme'
import { useLmsDarkMode } from '../../hooks/useLmsDarkMode'
import { permCourseItemCreate } from '../../lib/rbacApi'
import { AssignmentPageSettingsPanel } from '../../components/assignment/AssignmentPageSettingsPanel'
import { LmsPage } from './LmsPage'

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

function formatSubmissionTypes(
  text: boolean,
  file: boolean,
  url: boolean,
): string {
  const parts: string[] = []
  if (text) parts.push('Text')
  if (file) parts.push('File upload')
  if (url) parts.push('URL')
  return parts.length ? parts.join(', ') : 'Not set'
}

function formatLateSubmissionSummary(
  policy: LateSubmissionPolicy,
  penaltyPercent: number | null,
): string {
  if (policy === 'allow') return 'Allow (no penalty)'
  if (policy === 'block') return 'Block after due'
  return penaltyPercent != null ? `Penalty: ${penaltyPercent}% off` : 'Penalty (percent required when saving)'
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

  const [gradingGroups, setGradingGroups] = useState<{ id: string; name: string }[]>([])
  const [assignmentGroupId, setAssignmentGroupId] = useState<string | null>(null)
  const [assignmentGroupPatching, setAssignmentGroupPatching] = useState(false)
  const [assignmentGroupPatchError, setAssignmentGroupPatchError] = useState<string | null>(null)
  const [updatedAt, setUpdatedAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [markups, setMarkups] = useState<ContentPageMarkup[]>([])

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
      setAssignmentGroupId(data.assignmentGroupId ?? null)
      setAssignmentGroupPatchError(null)
      try {
        const grading = await fetchCourseGradingSettings(courseCode)
        setGradingGroups(
          grading.assignmentGroups.filter((g) => g.id.trim()).map((g) => ({ id: g.id, name: g.name })),
        )
      } catch {
        setGradingGroups([])
      }
      setUpdatedAt(data.updatedAt)
      setMdPreset(courseRow.markdownThemePreset)
      setMdCustom(courseRow.markdownThemeCustom)
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
      setRubric(null)
      setDraftRubric(null)
      setUpdatedAt(null)
      setMarkups([])
    } finally {
      setLoading(false)
    }
  }, [courseCode, itemId, loadMarkups])

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
      setRequiresAssignmentAccessCode(data.requiresAssignmentAccessCode)
      setAssignmentAccessCode(data.assignmentAccessCode ?? '')
      setAssignmentGroupId(data.assignmentGroupId ?? null)
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
        ) : canEdit ? (
          <button
            type="button"
            onClick={beginEdit}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Pencil className="h-4 w-4" aria-hidden />
            Edit
          </button>
        ) : null
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
                <div className="flex justify-between gap-4">
                  <dt className="shrink-0 text-slate-500 dark:text-neutral-400">Due date</dt>
                  <dd className="min-w-0 text-right font-medium text-slate-900 dark:text-neutral-100">
                    {formatOptionalDateTime(dueAt)}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="shrink-0 text-slate-500 dark:text-neutral-400">Visibility start</dt>
                  <dd className="min-w-0 text-right font-medium text-slate-900 dark:text-neutral-100">
                    {formatOptionalDateTime(availableFromAt)}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="shrink-0 text-slate-500 dark:text-neutral-400">Visibility end</dt>
                  <dd className="min-w-0 text-right font-medium text-slate-900 dark:text-neutral-100">
                    {formatOptionalDateTime(availableUntilAt)}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="shrink-0 text-slate-500 dark:text-neutral-400">Submission types</dt>
                  <dd className="min-w-0 text-right font-medium text-slate-900 dark:text-neutral-100">
                    {formatSubmissionTypes(submissionAllowText, submissionAllowFileUpload, submissionAllowUrl)}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="shrink-0 text-slate-500 dark:text-neutral-400">Late submission</dt>
                  <dd className="min-w-0 text-right font-medium text-slate-900 dark:text-neutral-100">
                    {formatLateSubmissionSummary(lateSubmissionPolicy, latePenaltyPercent)}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="shrink-0 text-slate-500 dark:text-neutral-400">Points</dt>
                  <dd className="min-w-0 text-right font-medium text-slate-900 dark:text-neutral-100">
                    {formatPointsWorth(pointsWorth)}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="shrink-0 text-slate-500 dark:text-neutral-400">Assignment group</dt>
                  <dd className="min-w-0 text-right font-medium text-slate-900 dark:text-neutral-100">
                    {assignmentGroupDisplayName(assignmentGroupId, gradingGroups)}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="shrink-0 text-slate-500 dark:text-neutral-400">Rubric</dt>
                  <dd className="min-w-0 text-right font-medium text-slate-900 dark:text-neutral-100">
                    {rubric && rubric.criteria.length > 0
                      ? `${rubric.criteria.length} criteria`
                      : 'None'}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="shrink-0 text-slate-500 dark:text-neutral-400">Access code</dt>
                  <dd className="min-w-0 text-right font-medium text-slate-900 dark:text-neutral-100">
                    {requiresAssignmentAccessCode ? 'Required' : 'None'}
                  </dd>
                </div>
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
