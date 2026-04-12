import type { ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'

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
