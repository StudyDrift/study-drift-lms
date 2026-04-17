import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, Loader2, Plus, Trash2 } from 'lucide-react'
import {
  generateAssignmentRubric,
  type LateSubmissionPolicy,
  type RubricDefinition,
  type RubricCriterion,
  type RubricLevel,
} from '../../lib/coursesApi'

export type AssignmentPageSettingsPanelProps = {
  disabled?: boolean
  dueLocal: string
  onDueLocalChange: (value: string) => void
  availableFromLocal: string
  onAvailableFromLocalChange: (value: string) => void
  availableUntilLocal: string
  onAvailableUntilLocalChange: (value: string) => void
  pointsWorth: number | null
  onPointsWorthChange: (value: number | null) => void
  gradingGroups: { id: string; name: string }[]
  assignmentGroupId: string | null
  onAssignmentGroupChange: (groupId: string | null) => void
  assignmentGroupSelectDisabled?: boolean
  submissionAllowText: boolean
  onSubmissionAllowTextChange: (value: boolean) => void
  submissionAllowFileUpload: boolean
  onSubmissionAllowFileUploadChange: (value: boolean) => void
  submissionAllowUrl: boolean
  onSubmissionAllowUrlChange: (value: boolean) => void
  assignmentAccessCode: string
  onAssignmentAccessCodeChange: (value: string) => void
  lateSubmissionPolicy: LateSubmissionPolicy
  onLateSubmissionPolicyChange: (value: LateSubmissionPolicy) => void
  latePenaltyPercent: number | null
  onLatePenaltyPercentChange: (value: number | null) => void
  draftRubric: RubricDefinition | null
  onDraftRubricChange: (value: RubricDefinition | null) => void
  /** When set with `assignmentItemId`, the rubric editor can draft a rubric via AI (not saved until the user saves). */
  courseCode?: string
  assignmentItemId?: string
  /** Full assignment body (Markdown) sent with AI rubric requests — use the current editor draft. */
  assignmentMarkdown?: string
}

const inputClass =
  'w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm text-slate-900 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400 disabled:opacity-60 dark:border-neutral-600 dark:bg-neutral-950 dark:text-neutral-100 dark:focus:border-indigo-500 dark:focus:ring-indigo-500'

function SettingsAccordion({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="group border-b border-slate-100 last:border-b-0 dark:border-neutral-800/80">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-[13px] font-medium text-slate-600 outline-none transition-colors hover:bg-slate-50/80 hover:text-slate-800 dark:text-neutral-400 dark:hover:bg-neutral-800/30 dark:hover:text-neutral-200 [&::-webkit-details-marker]:hidden">
        <span>{title}</span>
        <ChevronDown
          className="h-3.5 w-3.5 shrink-0 text-slate-400/80 transition duration-200 group-open:rotate-180 dark:text-neutral-500"
          aria-hidden
        />
      </summary>
      <div className="px-3 pb-3 pt-0.5">{children}</div>
    </details>
  )
}

function SettingsAccordionGroup({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200/70 bg-white dark:border-neutral-700/50 dark:bg-neutral-950/20">
      {children}
    </div>
  )
}

function ToggleRow({
  id,
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  id: string
  label: string
  description: string
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
}) {
  return (
    <div className="flex items-start justify-between gap-3 py-2">
      <div className="min-w-0">
        <label htmlFor={id} className="text-[13px] font-medium text-slate-700 dark:text-neutral-200">
          {label}
        </label>
        <p className="mt-0.5 text-[11px] leading-relaxed text-slate-400 dark:text-neutral-500">{description}</p>
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition disabled:cursor-not-allowed disabled:opacity-50 ${
          checked ? 'bg-indigo-500' : 'bg-slate-300 dark:bg-neutral-600'
        }`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition ${
            checked ? 'left-4.5' : 'left-0.5'
          }`}
        />
      </button>
    </div>
  )
}

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string
  htmlFor: string
  hint?: string
  children: ReactNode
}) {
  return (
    <div className="space-y-1">
      <label className="block text-xs font-medium text-slate-500 dark:text-neutral-400" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint ? <p className="text-[11px] leading-snug text-slate-400 dark:text-neutral-500">{hint}</p> : null}
    </div>
  )
}

export function AssignmentPageSettingsPanel({
  disabled,
  dueLocal,
  onDueLocalChange,
  availableFromLocal,
  onAvailableFromLocalChange,
  availableUntilLocal,
  onAvailableUntilLocalChange,
  pointsWorth,
  onPointsWorthChange,
  gradingGroups,
  assignmentGroupId,
  onAssignmentGroupChange,
  assignmentGroupSelectDisabled,
  submissionAllowText,
  onSubmissionAllowTextChange,
  submissionAllowFileUpload,
  onSubmissionAllowFileUploadChange,
  submissionAllowUrl,
  onSubmissionAllowUrlChange,
  assignmentAccessCode,
  onAssignmentAccessCodeChange,
  lateSubmissionPolicy,
  onLateSubmissionPolicyChange,
  latePenaltyPercent,
  onLatePenaltyPercentChange,
  draftRubric,
  onDraftRubricChange,
  courseCode,
  assignmentItemId,
  assignmentMarkdown,
}: AssignmentPageSettingsPanelProps) {
  const submissionCount =
    Number(submissionAllowText) + Number(submissionAllowFileUpload) + Number(submissionAllowUrl)

  return (
    <div className="space-y-3">
      <p className="text-xs leading-relaxed text-slate-500 dark:text-neutral-400">
        Save the page from the toolbar to apply changes.
      </p>

      <SettingsAccordionGroup>
        <SettingsAccordion title="Scheduling">
          <div className="space-y-3 pt-1">
            <Field label="Due date" htmlFor="assignment-settings-due" hint="Shown on the course calendar. Clear the field to remove.">
              <input
                id="assignment-settings-due"
                type="datetime-local"
                value={dueLocal}
                onChange={(e) => onDueLocalChange(e.target.value)}
                disabled={disabled}
                className={inputClass}
              />
            </Field>
            <Field
              label="Visibility start"
              htmlFor="assignment-settings-visible-from"
              hint="Learners cannot open the assignment before this time. Clear to remove."
            >
              <input
                id="assignment-settings-visible-from"
                type="datetime-local"
                value={availableFromLocal}
                onChange={(e) => onAvailableFromLocalChange(e.target.value)}
                disabled={disabled}
                className={inputClass}
              />
            </Field>
            <Field
              label="Visibility end"
              htmlFor="assignment-settings-visible-until"
              hint="After this time the assignment is no longer available. Clear to remove."
            >
              <input
                id="assignment-settings-visible-until"
                type="datetime-local"
                value={availableUntilLocal}
                onChange={(e) => onAvailableUntilLocalChange(e.target.value)}
                disabled={disabled}
                className={inputClass}
              />
            </Field>
          </div>
        </SettingsAccordion>

        <SettingsAccordion title="Submission type">
          <div className="divide-y divide-slate-100/90 pt-1 dark:divide-neutral-800/80">
            <ToggleRow
              id="assignment-submission-text"
              label="Text entry"
              description="Learners can type or paste a written response."
              checked={submissionAllowText}
              onChange={(next) => {
                if (!next && submissionCount <= 1) return
                onSubmissionAllowTextChange(next)
              }}
              disabled={disabled}
            />
            <ToggleRow
              id="assignment-submission-file"
              label="File upload"
              description="Learners can attach one or more files when submitting."
              checked={submissionAllowFileUpload}
              onChange={(next) => {
                if (!next && submissionCount <= 1) return
                onSubmissionAllowFileUploadChange(next)
              }}
              disabled={disabled}
            />
            <ToggleRow
              id="assignment-submission-url"
              label="Website URL"
              description="Learners can submit a link (e.g. portfolio or cloud document)."
              checked={submissionAllowUrl}
              onChange={(next) => {
                if (!next && submissionCount <= 1) return
                onSubmissionAllowUrlChange(next)
              }}
              disabled={disabled}
            />
          </div>
        </SettingsAccordion>

        <SettingsAccordion title="Late submission (after due)">
          <div className="space-y-3 pt-1">
            <Field label="Policy" htmlFor="assignment-late-policy">
              <select
                id="assignment-late-policy"
                value={lateSubmissionPolicy}
                onChange={(e) => onLateSubmissionPolicyChange(e.target.value as LateSubmissionPolicy)}
                disabled={disabled}
                className={inputClass}
              >
                <option value="allow">Allow (no block)</option>
                <option value="penalty">Allow with penalty</option>
                <option value="block">Block after due</option>
              </select>
            </Field>
            {lateSubmissionPolicy === 'penalty' ? (
              <Field label="Late penalty (% of points)" htmlFor="assignment-late-penalty">
                <input
                  id="assignment-late-penalty"
                  type="number"
                  min={0}
                  max={100}
                  value={latePenaltyPercent ?? ''}
                  onChange={(e) => {
                    const v = e.target.value
                    onLatePenaltyPercentChange(v === '' ? null : Math.min(100, Math.max(0, Number(v))))
                  }}
                  disabled={disabled}
                  className={`max-w-[8rem] ${inputClass}`}
                />
              </Field>
            ) : null}
            <p className="text-[11px] leading-snug text-slate-400 dark:text-neutral-500">
              For quizzes, penalties apply automatically to auto-graded scores. For file or text
              assignments, use this when recording grades or when a submission workflow is enabled.
            </p>
          </div>
        </SettingsAccordion>

        <SettingsAccordion title="Grading">
          <div className="space-y-3 pt-1">
            <Field
              label="Points worth"
              htmlFor="assignment-settings-points"
              hint="How many points this assignment counts for. Leave empty if not set (use 0 for no points)."
            >
              <input
                id="assignment-settings-points"
                type="number"
                min={0}
                max={1000000}
                placeholder="Not set"
                value={pointsWorth ?? ''}
                onChange={(e) => {
                  const v = e.target.value.trim()
                  if (v === '') {
                    onPointsWorthChange(null)
                    return
                  }
                  const n = Math.floor(Number(v))
                  if (!Number.isFinite(n)) return
                  onPointsWorthChange(Math.min(1_000_000, Math.max(0, n)))
                }}
                disabled={disabled}
                className={`max-w-[10rem] ${inputClass}`}
              />
            </Field>
            <Field
              label="Assignment group"
              htmlFor="assignment-settings-group"
              hint="Used with weighted assignment groups in course grading settings. Saves immediately when changed."
            >
              <select
                id="assignment-settings-group"
                value={assignmentGroupId ?? ''}
                onChange={(e) => {
                  const v = e.target.value
                  onAssignmentGroupChange(v === '' ? null : v)
                }}
                disabled={disabled || Boolean(assignmentGroupSelectDisabled)}
                className={inputClass}
              >
                <option value="">— None —</option>
                {gradingGroups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </Field>
            {gradingGroups.length === 0 ? (
              <p className="text-[11px] leading-snug text-slate-400 dark:text-neutral-500">
                Add groups under Course Settings → Assignment groups & weights.
              </p>
            ) : null}
          </div>
        </SettingsAccordion>

        <SettingsAccordion title="Rubric">
          <AssignmentRubricSection
            disabled={disabled}
            pointsWorth={pointsWorth}
            draftRubric={draftRubric}
            onDraftRubricChange={onDraftRubricChange}
            courseCode={courseCode}
            assignmentItemId={assignmentItemId}
            assignmentMarkdown={assignmentMarkdown}
          />
        </SettingsAccordion>

        <SettingsAccordion title="Access">
          <div className="space-y-3 pt-1">
            <Field
              label="Assignment access code"
              htmlFor="assignment-access-code"
              hint="Learners must enter this before submitting. Leave empty for none. Cleared when you save with an empty field."
            >
              <input
                id="assignment-access-code"
                type="password"
                autoComplete="new-password"
                value={assignmentAccessCode}
                onChange={(e) => onAssignmentAccessCodeChange(e.target.value)}
                disabled={disabled}
                placeholder="Optional"
                className={inputClass}
              />
            </Field>
          </div>
        </SettingsAccordion>
      </SettingsAccordionGroup>
    </div>
  )
}

function newRubricId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `r-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function rubricMaxSum(r: RubricDefinition): number {
  return r.criteria.reduce((sum, c) => {
    const mx = c.levels.reduce((m, l) => (Number.isFinite(l.points) ? Math.max(m, l.points) : m), 0)
    return sum + mx
  }, 0)
}

function createDefaultRubric(pointsWorth: number | null): RubricDefinition {
  const pts = pointsWorth && pointsWorth > 0 ? pointsWorth : 10
  return {
    title: null,
    criteria: [
      {
        id: newRubricId(),
        title: 'Criterion 1',
        description: null,
        /** One rating column by default; add more like inserting columns in a spreadsheet. */
        levels: [{ label: 'Rating 1', points: pts }],
      },
    ],
  }
}

/** Pad every criterion so each row has the same number of ratings (columns), then sync rating names from row 1. */
function normalizeRubricLevels(r: RubricDefinition): RubricDefinition {
  const max = Math.max(1, ...r.criteria.map((c) => c.levels.length))
  const padded: RubricDefinition = {
    ...r,
    criteria: r.criteria.map((c) => {
      const levels = [...c.levels]
      while (levels.length < max) {
        levels.push({ label: `Rating ${levels.length + 1}`, points: 0, description: null })
      }
      return { ...c, levels }
    }),
  }
  const ref = padded.criteria[0]
  if (!ref) return padded
  const labels = ref.levels.map((l) => l.label)
  return {
    ...padded,
    criteria: padded.criteria.map((c) => ({
      ...c,
      levels: c.levels.map((lvl, j) => ({
        ...lvl,
        label: labels[j] ?? lvl.label,
      })),
    })),
  }
}

function cloneRubric(r: RubricDefinition): RubricDefinition {
  return JSON.parse(JSON.stringify(r)) as RubricDefinition
}

/** Fixed widths so sticky column offsets stay aligned when scrolling horizontally. */
const RUBRIC_STICKY_NUM = 'w-10 min-w-10 max-w-10'
/** Wider so criterion title + description stack comfortably when scrolling horizontally. */
const RUBRIC_STICKY_CRIT = 'w-[18rem] min-w-[18rem] max-w-[18rem]'
const RUBRIC_STICKY_LEFT_CRIT = 'left-10'

const rubricStickyCell =
  'border-r border-slate-200 bg-slate-50 shadow-[4px_0_6px_-4px_rgba(15,23,42,0.12)] dark:border-neutral-700 dark:bg-neutral-800 dark:shadow-[4px_0_8px_-4px_rgba(0,0,0,0.45)]'

const rubricCellInput =
  'w-full min-w-0 border-0 bg-transparent px-2 py-1.5 text-sm text-slate-900 outline-none ring-0 placeholder:text-slate-400 focus:bg-white focus:ring-2 focus:ring-inset focus:ring-indigo-400/80 dark:bg-transparent dark:text-neutral-100 dark:placeholder:text-neutral-500 dark:focus:bg-neutral-900/90 dark:focus:ring-indigo-500/70'

const rubricCriterionDescInput =
  `${rubricCellInput} min-h-[2.75rem] resize-y text-xs leading-relaxed text-slate-600 placeholder:text-slate-400 dark:text-neutral-400 dark:placeholder:text-neutral-500`

/** Per–rating-band notes in the grid (under points). */
const rubricRatingBandDescInput =
  `${rubricCellInput} min-h-[2.5rem] resize-y text-xs leading-relaxed text-slate-600 placeholder:text-slate-400 dark:text-neutral-400 dark:placeholder:text-neutral-500`

const rubricCellInputNum =
  `${rubricCellInput} text-right tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`

const rubricToolbarBtn =
  'inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800'

const rubricStickyActions =
  'sticky right-0 z-20 w-[5.25rem] min-w-[5.25rem] max-w-[5.25rem] border-l border-slate-200 bg-slate-50 shadow-[-4px_0_6px_-4px_rgba(15,23,42,0.12)] dark:border-neutral-700 dark:bg-neutral-800 dark:shadow-[-4px_0_8px_-4px_rgba(0,0,0,0.45)]'

/** Google Sheets / Excel–style grid lines on all cells */
const sheetTableClass =
  'w-full min-w-max border-collapse border border-slate-300 bg-white text-left text-sm dark:border-neutral-600 dark:bg-neutral-950 [&_th]:border [&_th]:border-slate-300 [&_td]:border [&_td]:border-slate-300 dark:[&_th]:border-neutral-600 dark:[&_td]:border-neutral-600'

const rubricRatingHeaderInput =
  'w-full min-w-0 rounded border border-slate-200 bg-white px-2 py-1.5 text-sm font-medium text-slate-900 shadow-sm outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:focus:border-indigo-500 dark:focus:ring-indigo-500'

function rubricForSave(r: RubricDefinition): RubricDefinition {
  const t = r.title?.trim()
  return {
    ...r,
    title: t ? t : null,
    criteria: r.criteria.map((c) => {
      const d = c.description?.trim()
      return {
        ...c,
        description: d ? d : null,
        levels: c.levels.map((lvl, j) => {
          const ld = lvl.description?.trim()
          return {
            ...lvl,
            label: lvl.label.trim() || `Rating ${j + 1}`,
            description: ld ? ld : null,
          }
        }),
      }
    }),
  }
}

function RubricEditorModal({
  open,
  mode,
  seed,
  pointsWorth,
  disabled,
  courseCode,
  assignmentItemId,
  assignmentMarkdown,
  onClose,
  onSave,
}: {
  open: boolean
  mode: 'create' | 'edit'
  seed: RubricDefinition | null
  pointsWorth: number | null
  disabled?: boolean
  courseCode?: string
  assignmentItemId?: string
  /** Current assignment Markdown (full editor draft); included in the AI request. */
  assignmentMarkdown?: string
  onClose: () => void
  onSave: (r: RubricDefinition) => void
}) {
  const [draft, setDraft] = useState<RubricDefinition>(() =>
    normalizeRubricLevels(createDefaultRubric(pointsWorth)),
  )
  const [aiInstruction, setAiInstruction] = useState('')
  const [aiBusy, setAiBusy] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    if (mode === 'create' || seed == null) {
      setDraft(normalizeRubricLevels(createDefaultRubric(pointsWorth)))
    } else {
      setDraft(normalizeRubricLevels(cloneRubric(seed)))
    }
  }, [open, mode, seed, pointsWorth])

  useEffect(() => {
    if (!open) return
    setAiError(null)
  }, [open])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !aiBusy) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose, aiBusy])

  if (typeof document === 'undefined') return null

  const levelCount = draft.criteria[0]?.levels.length ?? 0

  function updateCriterion(next: RubricCriterion, index: number) {
    setDraft((prev) => ({
      ...prev,
      criteria: prev.criteria.map((c, i) => (i === index ? next : c)),
    }))
  }

  /** Rating names are shared across all criteria (one column header per rating). */
  function setRatingColumnLabel(ratingIndex: number, label: string) {
    setDraft((prev) => ({
      ...prev,
      criteria: prev.criteria.map((c) => ({
        ...c,
        levels: c.levels.map((lvl, k) => (k === ratingIndex ? { ...lvl, label } : lvl)),
      })),
    }))
  }

  function templateLevelsFrom(prev: RubricDefinition, index: number): RubricLevel[] {
    const ref = prev.criteria[index] ?? prev.criteria[0]
    return (ref?.levels ?? [{ label: 'Full credit', points: 1 }, { label: 'No credit', points: 0 }]).map(
      (l) => ({ ...l }),
    )
  }

  function addRowAtEnd() {
    setDraft((prev) => {
      const n = prev.criteria.length + 1
      const levels = templateLevelsFrom(prev, prev.criteria.length - 1)
      return normalizeRubricLevels({
        ...prev,
        criteria: [
          ...prev.criteria,
          {
            id: newRubricId(),
            title: `Criterion ${n}`,
            description: null,
            levels,
          },
        ],
      })
    })
  }

  function insertRowAfter(index: number) {
    setDraft((prev) => {
      const levels = templateLevelsFrom(prev, index)
      const next = [...prev.criteria]
      next.splice(index + 1, 0, {
        id: newRubricId(),
        title: `Criterion ${prev.criteria.length + 1}`,
        description: null,
        levels,
      })
      return normalizeRubricLevels({ ...prev, criteria: next })
    })
  }

  function removeRow(index: number) {
    setDraft((prev) => ({
      ...prev,
      criteria: prev.criteria.filter((_, i) => i !== index),
    }))
  }

  function addRating() {
    setDraft((prev) =>
      normalizeRubricLevels({
        ...prev,
        criteria: prev.criteria.map((c) => ({
          ...c,
          levels: [
            ...c.levels,
            { label: `Rating ${c.levels.length + 1}`, points: 0, description: null },
          ],
        })),
      }),
    )
  }

  function removeRating() {
    setDraft((prev) => {
      const lc = prev.criteria[0]?.levels.length ?? 0
      if (lc <= 1) return prev
      return normalizeRubricLevels({
        ...prev,
        criteria: prev.criteria.map((c) => ({
          ...c,
          levels: c.levels.slice(0, -1),
        })),
      })
    })
  }

  const totalMax = rubricMaxSum(draft)
  const pointsMismatch =
    pointsWorth != null && pointsWorth > 0 && Math.abs(totalMax - pointsWorth) > 1e-6

  const aiAvailable = Boolean(courseCode && assignmentItemId)

  async function generateRubricFromAi() {
    if (!courseCode || !assignmentItemId) return
    const text = aiInstruction.trim()
    if (!text) {
      setAiError('Describe what you want the rubric to assess.')
      return
    }
    setAiBusy(true)
    setAiError(null)
    try {
      const { rubric } = await generateAssignmentRubric(courseCode, assignmentItemId, {
        prompt: text,
        assignmentMarkdown: assignmentMarkdown ?? '',
      })
      setDraft(normalizeRubricLevels(rubric))
    } catch (e) {
      setAiError(e instanceof Error ? e.message : 'Could not generate rubric.')
    } finally {
      setAiBusy(false)
    }
  }

  const modal = (
    <div
      className="fixed inset-0 z-[400] flex items-center justify-center bg-black/50 p-4"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !aiBusy) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal
        aria-labelledby="rubric-editor-title"
        className="flex max-h-[min(92vh,800px)] w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-neutral-600 dark:bg-neutral-900"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 border-b border-slate-100 px-5 py-4 dark:border-neutral-700">
          <h2 id="rubric-editor-title" className="text-lg font-semibold text-slate-950 dark:text-neutral-100">
            {mode === 'create' ? 'Add rubric' : 'Edit rubric'}
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-neutral-400">
            Like a spreadsheet: each <strong className="font-medium text-slate-700 dark:text-neutral-300">row</strong>{' '}
            is a criterion (optional description under the title), each{' '}
            <strong className="font-medium text-slate-700 dark:text-neutral-300">column</strong> is a rating. Edit rating
            names in the header row; enter points in the grid. When assignment points are set, the sum of each row&apos;s
            highest rating must equal that total.
          </p>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
          <div className="flex flex-col gap-3 rounded-xl border border-slate-200/90 bg-slate-50/90 px-3 py-3 dark:border-neutral-700 dark:bg-neutral-900/40 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 text-sm">
              <span className="text-slate-600 dark:text-neutral-400">Rubric max total</span>{' '}
              <span
                className={`font-semibold tabular-nums text-slate-900 dark:text-neutral-100 ${
                  pointsWorth != null && pointsWorth > 0
                    ? pointsMismatch
                      ? 'text-amber-800 dark:text-amber-200'
                      : 'text-emerald-800 dark:text-emerald-200'
                    : ''
                }`}
              >
                {totalMax}
              </span>
              {pointsWorth != null && pointsWorth > 0 ? (
                <>
                  <span className="text-slate-400 dark:text-neutral-500"> / </span>
                  <span className="tabular-nums text-slate-700 dark:text-neutral-300">{pointsWorth}</span>
                  <span className="text-slate-500 dark:text-neutral-500"> pts worth</span>
                  {pointsMismatch ? (
                    <span className="ml-2 text-xs font-medium text-amber-800 dark:text-amber-200">
                      Needs to match before save
                    </span>
                  ) : (
                    <span className="ml-2 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                      OK
                    </span>
                  )}
                </>
              ) : (
                <span className="text-slate-500 dark:text-neutral-500"> pts (set assignment points to validate)</span>
              )}
            </div>
          </div>
          {pointsMismatch ? (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100">
              Adjust each criterion&apos;s highest rating column so the row totals add up to assignment points worth (
              {pointsWorth}).
            </p>
          ) : null}
          {aiAvailable ? (
            <div className="rounded-xl border border-indigo-200/80 bg-indigo-50/60 px-3 py-3 dark:border-indigo-900/50 dark:bg-indigo-950/35">
              <label
                className="block text-xs font-medium text-indigo-900 dark:text-indigo-200"
                htmlFor="rubric-ai-instruction"
              >
                Build with AI
              </label>
              <textarea
                id="rubric-ai-instruction"
                rows={3}
                value={aiInstruction}
                disabled={disabled || aiBusy}
                onChange={(e) => setAiInstruction(e.target.value)}
                placeholder="Describe the rubric (criteria, proficiency levels, what to emphasize)…"
                className={`mt-1.5 ${inputClass} min-h-[4.5rem] resize-y`}
              />
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={disabled || aiBusy}
                  onClick={() => void generateRubricFromAi()}
                  className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:opacity-50 dark:bg-indigo-500 dark:hover:bg-indigo-400"
                >
                  {aiBusy ? <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden /> : null}
                  {aiBusy ? 'Generating…' : 'Generate draft'}
                </button>
                <span className="text-[11px] text-slate-600 dark:text-neutral-400">
                  The full assignment text from the editor is included automatically. Fills the grid below;
                  nothing is stored until you click Save rubric.
                </span>
              </div>
              {aiError ? <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">{aiError}</p> : null}
            </div>
          ) : null}
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-0 flex-1">
              <label
                className="block text-xs font-medium text-slate-500 dark:text-neutral-400"
                htmlFor="rubric-sheet-header"
              >
                Header (optional)
              </label>
              <input
                id="rubric-sheet-header"
                type="text"
                value={draft.title ?? ''}
                disabled={disabled}
                placeholder="Optional title shown above the rubric"
                onChange={(e) =>
                  setDraft((prev) => ({ ...prev, title: e.target.value ? e.target.value : null }))
                }
                className={`mt-1 ${inputClass}`}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="sr-only">Structure</span>
              <button
                type="button"
                disabled={disabled}
                onClick={addRowAtEnd}
                className={rubricToolbarBtn}
              >
                <Plus className="size-3.5 shrink-0" aria-hidden />
                Add row
              </button>
              <button type="button" disabled={disabled} onClick={addRating} className={rubricToolbarBtn}>
                <Plus className="size-3.5 shrink-0" aria-hidden />
                Add rating
              </button>
              <button
                type="button"
                disabled={disabled || levelCount <= 1}
                onClick={removeRating}
                className={rubricToolbarBtn}
                title="Remove the rightmost rating column"
              >
                Remove rating
              </button>
            </div>
          </div>
          <div className="max-h-[min(56vh,560px)] overflow-auto rounded-sm border border-slate-300 bg-white shadow-sm dark:border-neutral-600 dark:bg-neutral-950">
            <table
              className={sheetTableClass}
              role="grid"
              aria-label="Rubric: one row per criterion (title and optional description), one column per rating"
            >
              <thead>
                <tr className="bg-[#f3f3f3] dark:bg-neutral-800">
                  <th
                    scope="col"
                    className={`sticky top-0 z-[41] ${RUBRIC_STICKY_NUM} ${rubricStickyCell} px-1 py-1.5 text-center text-[11px] font-normal text-slate-600 dark:text-neutral-400`}
                  >
                    #
                  </th>
                  <th
                    scope="col"
                    className={`sticky top-0 z-[40] ${RUBRIC_STICKY_CRIT} ${RUBRIC_STICKY_LEFT_CRIT} ${rubricStickyCell} px-2 py-2 text-left text-xs font-semibold text-slate-800 dark:text-neutral-200`}
                  >
                    Criterion
                  </th>
                  {Array.from({ length: levelCount }, (_, ri) => (
                    <th
                      key={`rating-h-${ri}`}
                      scope="col"
                      className={`sticky top-0 z-10 min-w-[9.5rem] bg-[#f3f3f3] px-1.5 py-1.5 text-left align-bottom dark:bg-neutral-800 ${
                        ri === 0 ? 'border-l-2 border-l-indigo-400 dark:border-l-indigo-500' : ''
                      }`}
                    >
                      <div className="flex flex-col gap-1">
                        <span className="text-[0.65rem] font-normal uppercase tracking-wide text-slate-500 dark:text-neutral-500">
                          Rating {ri + 1}
                        </span>
                        <input
                          type="text"
                          value={draft.criteria[0]?.levels[ri]?.label ?? ''}
                          disabled={disabled}
                          placeholder={`Rating ${ri + 1}`}
                          aria-label={`Rating column ${ri + 1} name`}
                          onChange={(e) => setRatingColumnLabel(ri, e.target.value)}
                          className={rubricRatingHeaderInput}
                        />
                      </div>
                    </th>
                  ))}
                  <th
                    scope="col"
                    className={`sticky top-0 z-[42] ${rubricStickyActions} bg-[#f3f3f3] px-0 py-1 text-center dark:bg-neutral-800`}
                  >
                    <span className="sr-only">Row</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {draft.criteria.map((criterion, ci) => {
                  const rowBg =
                    ci % 2 === 0
                      ? 'bg-white dark:bg-neutral-950'
                      : 'bg-[#fafafa] dark:bg-neutral-900/50'
                  return (
                    <tr key={criterion.id} className={rowBg}>
                      <th
                        scope="row"
                        className={`sticky left-0 z-[31] ${RUBRIC_STICKY_NUM} ${rubricStickyCell} px-1 py-2 align-top text-center text-[11px] font-normal tabular-nums text-slate-600 dark:text-neutral-400 ${rowBg}`}
                      >
                        {ci + 1}
                      </th>
                      <td
                        className={`sticky z-[30] ${RUBRIC_STICKY_CRIT} ${RUBRIC_STICKY_LEFT_CRIT} ${rubricStickyCell} p-0 align-top ${rowBg}`}
                      >
                        <div className="flex flex-col gap-1.5 px-2 py-2">
                          <input
                            type="text"
                            value={criterion.title}
                            disabled={disabled}
                            aria-label={`Row ${ci + 1}, criterion title`}
                            onChange={(e) => updateCriterion({ ...criterion, title: e.target.value }, ci)}
                            className={`${rubricCellInput} font-medium`}
                          />
                          <textarea
                            value={criterion.description ?? ''}
                            disabled={disabled}
                            rows={2}
                            placeholder="Description (optional)"
                            aria-label={`Row ${ci + 1}, criterion description`}
                            onChange={(e) =>
                              updateCriterion(
                                {
                                  ...criterion,
                                  description: e.target.value === '' ? null : e.target.value,
                                },
                                ci,
                              )
                            }
                            className={rubricCriterionDescInput}
                          />
                        </div>
                      </td>
                      {criterion.levels.map((lvl, ri) => (
                        <td
                          key={`${criterion.id}-r-${ri}`}
                          className={`p-0 align-top ${rowBg} ${ri === 0 ? 'border-l-2 border-l-indigo-300 dark:border-l-indigo-500/50' : ''}`}
                        >
                          <div className="flex min-h-[5rem] flex-col gap-1.5 px-1.5 py-2">
                            <input
                              type="number"
                              min={0}
                              step="any"
                              value={Number.isFinite(lvl.points) ? lvl.points : ''}
                              disabled={disabled}
                              aria-label={`Row ${ci + 1}, ${draft.criteria[0]?.levels[ri]?.label || `Rating ${ri + 1}`}, points`}
                              onChange={(e) => {
                                const v = e.target.value.trim()
                                const p = v === '' ? 0 : Number(v)
                                const levels = criterion.levels.map((x, j) =>
                                  j === ri ? { ...x, points: Number.isFinite(p) ? p : 0 } : x,
                                )
                                updateCriterion({ ...criterion, levels }, ci)
                              }}
                              className={rubricCellInputNum}
                            />
                            <textarea
                              value={lvl.description ?? ''}
                              disabled={disabled}
                              rows={2}
                              placeholder="Description (optional)"
                              aria-label={`Row ${ci + 1}, ${draft.criteria[0]?.levels[ri]?.label || `Rating ${ri + 1}`}, band notes`}
                              onChange={(e) => {
                                const levels = criterion.levels.map((x, j) =>
                                  j === ri
                                    ? {
                                        ...x,
                                        description: e.target.value === '' ? null : e.target.value,
                                      }
                                    : x,
                                )
                                updateCriterion({ ...criterion, levels }, ci)
                              }}
                              className={rubricRatingBandDescInput}
                            />
                          </div>
                        </td>
                      ))}
                      <td className={`${rubricStickyActions} p-0.5 align-top ${rowBg}`}>
                        <div className="flex min-h-[5rem] flex-row items-start justify-center gap-0.5 pt-2">
                          <button
                            type="button"
                            disabled={disabled}
                            onClick={() => insertRowAfter(ci)}
                            className="inline-flex items-center justify-center rounded-md p-1.5 text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-950/50"
                            title="Insert row below"
                            aria-label={`Insert row below row ${ci + 1}`}
                          >
                            <Plus className="size-4" aria-hidden />
                          </button>
                          <button
                            type="button"
                            disabled={disabled || draft.criteria.length <= 1}
                            onClick={() => removeRow(ci)}
                            className="inline-flex items-center justify-center rounded-md p-1.5 text-rose-600 hover:bg-rose-50 disabled:opacity-40 dark:text-rose-400 dark:hover:bg-rose-950/40"
                            title="Delete row"
                            aria-label={`Delete row ${ci + 1}`}
                          >
                            <Trash2 className="size-4" aria-hidden />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="bg-[#ececec] dark:bg-neutral-800/95">
                  <td
                    colSpan={2}
                    className={`sticky left-0 z-[31] border-r border-slate-300 bg-[#ececec] px-2 py-2 text-xs font-semibold text-slate-800 shadow-[4px_0_6px_-4px_rgba(15,23,42,0.12)] dark:border-neutral-600 dark:bg-neutral-800/95 dark:text-neutral-200 dark:shadow-[4px_0_8px_-4px_rgba(0,0,0,0.45)]`}
                  >
                    Max total (highest rating per row)
                  </td>
                  {levelCount > 0 ? (
                    <td
                      colSpan={levelCount}
                      className="bg-[#ececec] px-2 py-2 text-right text-[0.65rem] font-medium uppercase tracking-wide text-slate-600 dark:bg-neutral-800/95 dark:text-neutral-400"
                    >
                      {pointsWorth != null && pointsWorth > 0 ? (
                        <span>
                          Target{' '}
                          <span className="tabular-nums text-slate-900 dark:text-neutral-100">{pointsWorth}</span>
                        </span>
                      ) : (
                        <span>No assignment points set</span>
                      )}
                    </td>
                  ) : null}
                  <td className={`${rubricStickyActions} bg-[#ececec] dark:bg-neutral-800/95`} />
                </tr>
                <tr className="bg-[#f3f3f3] dark:bg-neutral-800/80">
                  <td
                    colSpan={2}
                    className={`sticky left-0 z-[31] border-r border-slate-300 bg-[#f3f3f3] px-2 py-2 text-sm font-bold tabular-nums text-slate-900 shadow-[4px_0_6px_-4px_rgba(15,23,42,0.12)] dark:border-neutral-600 dark:bg-neutral-800/80 dark:text-neutral-100 dark:shadow-[4px_0_8px_-4px_rgba(0,0,0,0.45)]`}
                  >
                    {totalMax}
                  </td>
                  {levelCount > 0 ? (
                    <td
                      colSpan={levelCount}
                      className="bg-[#f3f3f3] px-2 py-2 text-right text-sm font-semibold tabular-nums dark:bg-neutral-800/80"
                    >
                      {pointsWorth != null && pointsWorth > 0 ? (
                        <span
                          className={
                            pointsMismatch
                              ? 'text-amber-800 dark:text-amber-200'
                              : 'text-emerald-800 dark:text-emerald-200'
                          }
                        >
                          {pointsMismatch ? 'Mismatch' : 'Aligned'}
                        </span>
                      ) : (
                        <span className="text-slate-500 dark:text-neutral-500">—</span>
                      )}
                    </td>
                  ) : null}
                  <td className={`${rubricStickyActions} bg-[#f3f3f3] dark:bg-neutral-800/80`} />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
        <div className="flex shrink-0 justify-end gap-2 border-t border-slate-100 px-5 py-4 dark:border-neutral-700">
          <button
            type="button"
            disabled={disabled || aiBusy}
            onClick={onClose}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 dark:border-neutral-600 dark:text-neutral-100 dark:hover:bg-neutral-800"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={disabled || aiBusy || draft.criteria.length === 0}
            onClick={() => onSave(rubricForSave(draft))}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50 dark:bg-indigo-500 dark:hover:bg-indigo-400"
          >
            Save rubric
          </button>
        </div>
      </div>
    </div>
  )

  if (!open) return null
  return createPortal(modal, document.body)
}

function AssignmentRubricSection({
  disabled,
  pointsWorth,
  draftRubric,
  onDraftRubricChange,
  courseCode,
  assignmentItemId,
  assignmentMarkdown,
}: {
  disabled?: boolean
  pointsWorth: number | null
  draftRubric: RubricDefinition | null
  onDraftRubricChange: (value: RubricDefinition | null) => void
  courseCode?: string
  assignmentItemId?: string
  assignmentMarkdown?: string
}) {
  const [editorOpen, setEditorOpen] = useState(false)
  const [editorMode, setEditorMode] = useState<'create' | 'edit'>('create')

  const totalMax = draftRubric ? rubricMaxSum(draftRubric) : 0
  const pointsMismatch =
    pointsWorth != null && pointsWorth > 0 && draftRubric && Math.abs(totalMax - pointsWorth) > 1e-6

  function openCreate() {
    setEditorMode('create')
    setEditorOpen(true)
  }

  function openEdit() {
    if (!draftRubric) return
    setEditorMode('edit')
    setEditorOpen(true)
  }

  return (
    <div className="space-y-3 pt-1">
      <p className="text-[11px] leading-relaxed text-slate-500 dark:text-neutral-400">
        Optional structured grading: each row is a criterion, each column is a rating. Add or edit in the
        dialog—changes apply when you save the rubric, then save the assignment from the toolbar.
      </p>
      {!draftRubric ? (
        <button
          type="button"
          disabled={disabled}
          onClick={openCreate}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50 disabled:opacity-50 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800"
        >
          Add rubric
        </button>
      ) : (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 text-sm text-slate-700 dark:text-neutral-300">
            {draftRubric.title ? (
              <span className="mr-1 font-medium text-slate-900 dark:text-neutral-100">
                {draftRubric.title}
                <span className="font-normal text-slate-400 dark:text-neutral-500"> · </span>
              </span>
            ) : null}
            <span className="font-medium text-slate-900 dark:text-neutral-100">
              {draftRubric.criteria.length}{' '}
              {draftRubric.criteria.length === 1 ? 'criterion' : 'criteria'}
            </span>
            <span className="text-slate-500 dark:text-neutral-500"> · max total {totalMax} pts</span>
            {pointsMismatch ? (
              <span className="ml-2 text-amber-700 dark:text-amber-300">
                (should match {pointsWorth} pts worth)
              </span>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={disabled}
              onClick={openEdit}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50 disabled:opacity-50 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800"
            >
              Edit rubric
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onDraftRubricChange(null)}
              className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
            >
              Remove rubric
            </button>
          </div>
        </div>
      )}
      <RubricEditorModal
        open={editorOpen}
        mode={editorMode}
        seed={draftRubric}
        pointsWorth={pointsWorth}
        disabled={disabled}
        courseCode={courseCode}
        assignmentItemId={assignmentItemId}
        assignmentMarkdown={assignmentMarkdown}
        onClose={() => setEditorOpen(false)}
        onSave={(r) => {
          onDraftRubricChange(r)
          setEditorOpen(false)
        }}
      />
    </div>
  )
}
