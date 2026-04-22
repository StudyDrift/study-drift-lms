import type { ModuleAssignmentSubmissionApi } from '../../lib/courses-api'

export type GradedFilter = 'all' | 'graded' | 'ungraded'

export type SubmissionNavigatorProps = {
  submissions: ModuleAssignmentSubmissionApi[]
  index: number
  onIndexChange: (i: number) => void
  gradedFilter: GradedFilter
  onGradedFilterChange: (f: GradedFilter) => void
  disabled?: boolean
  /** Plan 3.3 — inline label (e.g. "Student 3" or "Submission 2"). */
  currentSubmissionDisplayLabel?: string
  /** When blind grading is active, exposes WCAG label for the current submission. */
  anonymisedAriaLabel?: string
}

export function SubmissionNavigator({
  submissions,
  index,
  onIndexChange,
  gradedFilter,
  onGradedFilterChange,
  disabled,
  currentSubmissionDisplayLabel,
  anonymisedAriaLabel,
}: SubmissionNavigatorProps) {
  const prev = () => onIndexChange(Math.max(0, index - 1))
  const next = () => onIndexChange(Math.min(Math.max(submissions.length - 1, 0), index + 1))

  return (
    <div
      className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900/80"
      aria-label={anonymisedAriaLabel}
    >
      <label className="inline-flex items-center gap-2 font-medium text-slate-700 dark:text-neutral-200">
        <span className="sr-only">Filter submissions</span>
        <select
          className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm dark:border-neutral-600 dark:bg-neutral-950"
          value={gradedFilter}
          disabled={disabled}
          onChange={(e) => onGradedFilterChange(e.target.value as GradedFilter)}
        >
          <option value="all">All</option>
          <option value="graded">Graded</option>
          <option value="ungraded">Ungraded</option>
        </select>
      </label>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold hover:bg-slate-50 disabled:opacity-50 dark:border-neutral-600 dark:bg-neutral-950 dark:hover:bg-neutral-900"
          disabled={disabled || index <= 0}
          onClick={prev}
          aria-label="Previous submission"
        >
          Prev
        </button>
        <span className="tabular-nums text-slate-600 dark:text-neutral-300">
          {submissions.length === 0
            ? '0 / 0'
            : currentSubmissionDisplayLabel
              ? `${currentSubmissionDisplayLabel} · ${index + 1} / ${submissions.length}`
              : `${index + 1} / ${submissions.length}`}
        </span>
        <button
          type="button"
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold hover:bg-slate-50 disabled:opacity-50 dark:border-neutral-600 dark:bg-neutral-950 dark:hover:bg-neutral-900"
          disabled={disabled || submissions.length === 0 || index >= submissions.length - 1}
          onClick={next}
          aria-label="Next submission"
        >
          Next
        </button>
      </div>
    </div>
  )
}
