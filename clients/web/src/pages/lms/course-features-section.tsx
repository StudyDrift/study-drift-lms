import { useCallback, useState } from 'react'
import { useCourseNavFeatures } from '../../context/course-nav-features-context'
import { patchCourseFeatures } from '../../lib/courses-api'
import type { CoursePublic } from './courses'

type Props = {
  courseCode: string
  course: CoursePublic
  onCourseUpdated: (c: CoursePublic) => void
}

function FeatureToggleRow({
  label,
  description,
  enabled,
  disabled,
  onToggle,
}: {
  label: string
  description: string
  enabled: boolean
  disabled: boolean
  onToggle: () => void
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4 py-4">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-slate-900 dark:text-neutral-100">{label}</p>
        <p className="mt-1 text-sm text-slate-500 dark:text-neutral-400">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        onClick={onToggle}
        disabled={disabled}
        className={`relative mt-0.5 inline-flex h-7 w-12 shrink-0 rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${
          enabled ? 'bg-indigo-600' : 'bg-slate-200 dark:bg-neutral-700'
        }`}
      >
        <span
          className={`pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow ring-0 transition ${
            enabled ? 'translate-x-5' : 'translate-x-0.5'
          }`}
        />
      </button>
    </div>
  )
}

export function CourseFeaturesSection({ courseCode, course, onCourseUpdated }: Props) {
  const { refresh } = useCourseNavFeatures()
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const notebookEnabled = course.notebookEnabled !== false
  const feedEnabled = course.feedEnabled !== false
  const calendarEnabled = course.calendarEnabled !== false
  const questionBankEnabled = course.questionBankEnabled === true
  const lockdownModeEnabled = course.lockdownModeEnabled === true
  const standardsAlignmentEnabled = course.standardsAlignmentEnabled === true
  const adaptivePathsEnabled = course.adaptivePathsEnabled === true
  const srsEnabled = course.srsEnabled === true

  const persist = useCallback(
    async (patch: {
      notebookEnabled?: boolean
      feedEnabled?: boolean
      calendarEnabled?: boolean
      questionBankEnabled?: boolean
      lockdownModeEnabled?: boolean
      standardsAlignmentEnabled?: boolean
      adaptivePathsEnabled?: boolean
      srsEnabled?: boolean
    }) => {
      setSaving(true)
      setMessage(null)
      setError(null)
      try {
        const body = {
          notebookEnabled: patch.notebookEnabled ?? notebookEnabled,
          feedEnabled: patch.feedEnabled ?? feedEnabled,
          calendarEnabled: patch.calendarEnabled ?? calendarEnabled,
          questionBankEnabled: patch.questionBankEnabled ?? questionBankEnabled,
          lockdownModeEnabled: patch.lockdownModeEnabled ?? lockdownModeEnabled,
          standardsAlignmentEnabled: patch.standardsAlignmentEnabled ?? standardsAlignmentEnabled,
          adaptivePathsEnabled: patch.adaptivePathsEnabled ?? adaptivePathsEnabled,
          srsEnabled: patch.srsEnabled ?? srsEnabled,
        }
        const updated = await patchCourseFeatures(courseCode, body)
        onCourseUpdated(updated)
        await refresh()
        setMessage('Saved.')
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not save.')
      } finally {
        setSaving(false)
      }
    },
    [
      adaptivePathsEnabled,
      srsEnabled,
      calendarEnabled,
      courseCode,
      feedEnabled,
      lockdownModeEnabled,
      notebookEnabled,
      onCourseUpdated,
      questionBankEnabled,
      refresh,
      standardsAlignmentEnabled,
    ],
  )

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-900/5 dark:border-neutral-800 dark:bg-neutral-950">
      <h2 className="text-sm font-semibold text-slate-900 dark:text-neutral-100">Course tools</h2>
      <p className="mt-1 text-sm text-slate-500 dark:text-neutral-400">
        Turn tools on or off for everyone in this course. Disabled tools disappear from the course
        menu and cannot be used until you enable them again.
      </p>

      <div className="mt-2 divide-y divide-slate-100 dark:divide-neutral-800">
        <FeatureToggleRow
          label="Notebook"
          description="Personal notes workspace for this course (stored in the browser for each learner)."
          enabled={notebookEnabled}
          disabled={saving}
          onToggle={() => void persist({ notebookEnabled: !notebookEnabled })}
        />
        <FeatureToggleRow
          label="Feed"
          description="Course-wide channels and messages, including uploads and real-time updates."
          enabled={feedEnabled}
          disabled={saving}
          onToggle={() => void persist({ feedEnabled: !feedEnabled })}
        />
        <FeatureToggleRow
          label="Calendar"
          description="Month, week, and agenda views of assignment and content due dates for this course."
          enabled={calendarEnabled}
          disabled={saving}
          onToggle={() => void persist({ calendarEnabled: !calendarEnabled })}
        />
        <FeatureToggleRow
          label="Question bank"
          description="Store quiz items in a reusable bank, optional random pools per attempt, and instructor-only bank APIs."
          enabled={questionBankEnabled}
          disabled={saving}
          onToggle={() => void persist({ questionBankEnabled: !questionBankEnabled })}
        />
        <FeatureToggleRow
          label="Quiz lockdown / kiosk"
          description="Lets instructors choose one-question-at-a-time or kiosk delivery on quizzes (server-enforced progression and optional focus-loss logging)."
          enabled={lockdownModeEnabled}
          disabled={saving}
          onToggle={() => void persist({ lockdownModeEnabled: !lockdownModeEnabled })}
        />
        <FeatureToggleRow
          label="Standards alignment"
          description="Map concepts to Common Core / NGSS codes and view per-standard coverage for this course."
          enabled={standardsAlignmentEnabled}
          disabled={saving}
          onToggle={() => void persist({ standardsAlignmentEnabled: !standardsAlignmentEnabled })}
        />
        <FeatureToggleRow
          label="Adaptive learning paths"
          description="Allow mastery-based branching between modules (requires learner model on the server). Instructors configure rules on each module in the course outline."
          enabled={adaptivePathsEnabled}
          disabled={saving}
          onToggle={() => void persist({ adaptivePathsEnabled: !adaptivePathsEnabled })}
        />
        <FeatureToggleRow
          label="Spaced repetition (review)"
          description="Let learners use the global review queue for question-bank items you mark as SRS-eligible (requires SRS_PRACTICE_ENABLED on the server)."
          enabled={srsEnabled}
          disabled={saving}
          onToggle={() => void persist({ srsEnabled: !srsEnabled })}
        />
      </div>

      {message && (
        <p className="mt-4 text-sm text-emerald-700 dark:text-emerald-400" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="mt-4 text-sm text-rose-700 dark:text-rose-400" role="status">
          {error}
        </p>
      )}
    </section>
  )
}
