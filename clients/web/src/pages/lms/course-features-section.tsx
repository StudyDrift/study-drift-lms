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

  const persist = useCallback(
    async (body: {
      notebookEnabled: boolean
      feedEnabled: boolean
      calendarEnabled: boolean
      questionBankEnabled: boolean
      lockdownModeEnabled: boolean
    }) => {
      setSaving(true)
      setMessage(null)
      setError(null)
      try {
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
    [courseCode, onCourseUpdated, refresh],
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
          onToggle={() =>
            void persist({
              notebookEnabled: !notebookEnabled,
              feedEnabled,
              calendarEnabled,
              questionBankEnabled,
              lockdownModeEnabled,
            })
          }
        />
        <FeatureToggleRow
          label="Feed"
          description="Course-wide channels and messages, including uploads and real-time updates."
          enabled={feedEnabled}
          disabled={saving}
          onToggle={() =>
            void persist({
              notebookEnabled,
              feedEnabled: !feedEnabled,
              calendarEnabled,
              questionBankEnabled,
              lockdownModeEnabled,
            })
          }
        />
        <FeatureToggleRow
          label="Calendar"
          description="Month, week, and agenda views of assignment and content due dates for this course."
          enabled={calendarEnabled}
          disabled={saving}
          onToggle={() =>
            void persist({
              notebookEnabled,
              feedEnabled,
              calendarEnabled: !calendarEnabled,
              questionBankEnabled,
              lockdownModeEnabled,
            })
          }
        />
        <FeatureToggleRow
          label="Question bank"
          description="Store quiz items in a reusable bank, optional random pools per attempt, and instructor-only bank APIs."
          enabled={questionBankEnabled}
          disabled={saving}
          onToggle={() =>
            void persist({
              notebookEnabled,
              feedEnabled,
              calendarEnabled,
              questionBankEnabled: !questionBankEnabled,
              lockdownModeEnabled,
            })
          }
        />
        <FeatureToggleRow
          label="Quiz lockdown / kiosk"
          description="Lets instructors choose one-question-at-a-time or kiosk delivery on quizzes (server-enforced progression and optional focus-loss logging)."
          enabled={lockdownModeEnabled}
          disabled={saving}
          onToggle={() =>
            void persist({
              notebookEnabled,
              feedEnabled,
              calendarEnabled,
              questionBankEnabled,
              lockdownModeEnabled: !lockdownModeEnabled,
            })
          }
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
