import type { ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import type {
  AdaptiveDifficulty,
  AdaptiveStopRule,
  GradeAttemptPolicy,
  LateSubmissionPolicy,
  QuizAdvancedSettings,
  ReviewVisibility,
  ReviewWhen,
  ShowScoreTiming,
} from '../../lib/coursesApi'
import { ModuleItemOutcomesMappingAccordion } from '../outcomes/ModuleItemOutcomesMappingAccordion'

export type QuizPageSettingsPanelProps = {
  disabled?: boolean
  dueLocal: string
  onDueLocalChange: (value: string) => void
  availableFromLocal: string
  onAvailableFromLocalChange: (value: string) => void
  availableUntilLocal: string
  onAvailableUntilLocalChange: (value: string) => void
  unlimitedAttempts: boolean
  onUnlimitedAttemptsChange: (value: boolean) => void
  oneQuestionAtATime: boolean
  onOneQuestionAtATimeChange: (value: boolean) => void
  pointsWorth: number | null
  onPointsWorthChange: (value: number | null) => void
  /** Saved assignment groups (with server ids). */
  gradingGroups: { id: string; name: string }[]
  assignmentGroupId: string | null
  onAssignmentGroupChange: (groupId: string | null) => void
  /** When true, only the assignment-group control is locked (e.g. patch in flight). */
  assignmentGroupSelectDisabled?: boolean
  advanced: QuizAdvancedSettings
  onAdvancedChange: (next: QuizAdvancedSettings) => void
  showAdaptiveSection: boolean
  /** When set, settings include outcome links for this quiz item. */
  courseCode?: string
  quizItemId?: string
  quizOutcomesQuestions?: { id: string; prompt: string }[]
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

export function QuizPageSettingsPanel({
  disabled,
  dueLocal,
  onDueLocalChange,
  availableFromLocal,
  onAvailableFromLocalChange,
  availableUntilLocal,
  onAvailableUntilLocalChange,
  unlimitedAttempts,
  onUnlimitedAttemptsChange,
  oneQuestionAtATime,
  onOneQuestionAtATimeChange,
  pointsWorth,
  onPointsWorthChange,
  gradingGroups,
  assignmentGroupId,
  onAssignmentGroupChange,
  assignmentGroupSelectDisabled,
  advanced,
  onAdvancedChange,
  showAdaptiveSection,
  courseCode,
  quizItemId,
  quizOutcomesQuestions,
}: QuizPageSettingsPanelProps) {
  function patch(p: Partial<QuizAdvancedSettings>) {
    onAdvancedChange({ ...advanced, ...p })
  }

  return (
    <div className="space-y-3">
      <p className="text-xs leading-relaxed text-slate-500 dark:text-neutral-400">
        Save the page from the toolbar to apply changes.
      </p>

      <SettingsAccordionGroup>
        <SettingsAccordion title="Scheduling">
          <div className="space-y-3 pt-1">
            <Field label="Due date" htmlFor="quiz-settings-due" hint="Optional. Cleared if empty.">
              <input
                id="quiz-settings-due"
                type="datetime-local"
                value={dueLocal}
                onChange={(e) => onDueLocalChange(e.target.value)}
                disabled={disabled}
                className={inputClass}
              />
            </Field>
            <Field
              label="Visibility start"
              htmlFor="quiz-settings-visible-from"
              hint="Learners cannot open the quiz before this time."
            >
              <input
                id="quiz-settings-visible-from"
                type="datetime-local"
                value={availableFromLocal}
                onChange={(e) => onAvailableFromLocalChange(e.target.value)}
                disabled={disabled}
                className={inputClass}
              />
            </Field>
            <Field
              label="Visibility end"
              htmlFor="quiz-settings-visible-until"
              hint="After this time the quiz is no longer available."
            >
              <input
                id="quiz-settings-visible-until"
                type="datetime-local"
                value={availableUntilLocal}
                onChange={(e) => onAvailableUntilLocalChange(e.target.value)}
                disabled={disabled}
                className={inputClass}
              />
            </Field>
          </div>
        </SettingsAccordion>

        <SettingsAccordion title="Attempts & grading">
          <div className="divide-y divide-slate-100/90 dark:divide-neutral-800/80">
            <ToggleRow
              id="quiz-settings-unlimited-attempts"
              label="Unlimited attempts"
              description="Allow learners to retake without an attempt limit."
              checked={unlimitedAttempts}
              onChange={onUnlimitedAttemptsChange}
              disabled={disabled}
            />
            {!unlimitedAttempts ? (
              <div className="py-3">
                <Field label="Max attempts" htmlFor="quiz-max-attempts">
                  <input
                    id="quiz-max-attempts"
                    type="number"
                    min={1}
                    max={100}
                    value={advanced.maxAttempts}
                    onChange={(e) => patch({ maxAttempts: Math.min(100, Math.max(1, Number(e.target.value) || 1)) })}
                    disabled={disabled}
                    className={`max-w-[8rem] ${inputClass}`}
                  />
                </Field>
              </div>
            ) : null}
            <div className="py-3">
              <Field
                label="Grade uses"
                htmlFor="quiz-grade-policy"
                hint="Which attempt counts when multiple tries are allowed."
              >
                <select
                  id="quiz-grade-policy"
                  value={advanced.gradeAttemptPolicy}
                  onChange={(e) => patch({ gradeAttemptPolicy: e.target.value as GradeAttemptPolicy })}
                  disabled={disabled}
                  className={inputClass}
                >
                  <option value="latest">Latest attempt</option>
                  <option value="highest">Highest score</option>
                  <option value="first">First attempt</option>
                  <option value="average">Average of attempts</option>
                </select>
              </Field>
            </div>
            <div className="py-3">
              <Field label="Passing score (%)" htmlFor="quiz-passing" hint="Leave empty for no pass requirement.">
                <input
                  id="quiz-passing"
                  type="number"
                  min={0}
                  max={100}
                  placeholder="None"
                  value={advanced.passingScorePercent ?? ''}
                  onChange={(e) => {
                    const v = e.target.value
                    patch({ passingScorePercent: v === '' ? null : Math.min(100, Math.max(0, Number(v))) })
                  }}
                  disabled={disabled}
                  className={`max-w-[8rem] ${inputClass}`}
                />
              </Field>
            </div>
            <div className="py-3">
              <Field
                label="Points worth"
                htmlFor="quiz-points-worth"
                hint="How many points this quiz counts for. Leave empty if not set (use 0 for explicitly no points)."
              >
                <input
                  id="quiz-points-worth"
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
            </div>
            <div className="py-3">
              <Field label="Late submission (after due)" htmlFor="quiz-late-policy">
                <select
                  id="quiz-late-policy"
                  value={advanced.lateSubmissionPolicy}
                  onChange={(e) => patch({ lateSubmissionPolicy: e.target.value as LateSubmissionPolicy })}
                  disabled={disabled}
                  className={inputClass}
                >
                  <option value="allow">Allow (no block)</option>
                  <option value="penalty">Allow with penalty</option>
                  <option value="block">Block after due</option>
                </select>
              </Field>
            </div>
            {advanced.lateSubmissionPolicy === 'penalty' ? (
              <div className="py-3">
                <Field label="Late penalty (% of points)" htmlFor="quiz-late-penalty">
                  <input
                    id="quiz-late-penalty"
                    type="number"
                    min={0}
                    max={100}
                    value={advanced.latePenaltyPercent ?? ''}
                    onChange={(e) => {
                      const v = e.target.value
                      patch({ latePenaltyPercent: v === '' ? null : Math.min(100, Math.max(0, Number(v))) })
                    }}
                    disabled={disabled}
                    className={`max-w-[8rem] ${inputClass}`}
                  />
                </Field>
              </div>
            ) : null}
          </div>
        </SettingsAccordion>

        <SettingsAccordion title="Grading">
          <div className="space-y-3 pt-1">
            <Field
              label="Assignment group"
              htmlFor="quiz-assignment-group"
              hint="Used with weighted assignment groups in course grading settings. Saves immediately when changed."
            >
              <select
                id="quiz-assignment-group"
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

        <SettingsAccordion title="Time limits">
          <div className="space-y-3 pt-1">
            <Field label="Total time limit (minutes)" htmlFor="quiz-time-limit">
              <input
                id="quiz-time-limit"
                type="number"
                min={1}
                max={10080}
                placeholder="None"
                value={advanced.timeLimitMinutes ?? ''}
                onChange={(e) => {
                  const v = e.target.value
                  patch({ timeLimitMinutes: v === '' ? null : Math.min(10080, Math.max(1, Number(v))) })
                }}
                disabled={disabled}
                className={`max-w-[8rem] ${inputClass}`}
              />
            </Field>
            <ToggleRow
              id="quiz-timer-pause"
              label="Pause timer when tab is hidden"
              description="When a time limit is set, the countdown pauses if the learner switches away from the tab."
              checked={advanced.timerPauseWhenTabHidden}
              onChange={(next) => patch({ timerPauseWhenTabHidden: next })}
              disabled={disabled}
            />
            <Field
              label="Per-question time limit (seconds)"
              htmlFor="quiz-per-q-time"
              hint="Optional cap for each question in one-question-at-a-time mode."
            >
              <input
                id="quiz-per-q-time"
                type="number"
                min={10}
                max={86400}
                placeholder="None"
                value={advanced.perQuestionTimeLimitSeconds ?? ''}
                onChange={(e) => {
                  const v = e.target.value
                  patch({
                    perQuestionTimeLimitSeconds: v === '' ? null : Math.min(86400, Math.max(10, Number(v))),
                  })
                }}
                disabled={disabled}
                className={`max-w-[8rem] ${inputClass}`}
              />
            </Field>
          </div>
        </SettingsAccordion>

        <SettingsAccordion title="Scores & review">
          <div className="space-y-3 pt-1">
            <Field label="When to show score" htmlFor="quiz-show-score">
              <select
                id="quiz-show-score"
                value={advanced.showScoreTiming}
                onChange={(e) => patch({ showScoreTiming: e.target.value as ShowScoreTiming })}
                disabled={disabled}
                className={inputClass}
              >
                <option value="immediate">Immediately after submit</option>
                <option value="after_due">After the due date</option>
                <option value="manual">When released by instructor</option>
              </select>
            </Field>
            <Field label="What learners can see" htmlFor="quiz-review-vis">
              <select
                id="quiz-review-vis"
                value={advanced.reviewVisibility}
                onChange={(e) => patch({ reviewVisibility: e.target.value as ReviewVisibility })}
                disabled={disabled}
                className={inputClass}
              >
                <option value="full">Full feedback (score, responses, correct answers)</option>
                <option value="correct_answers">Correct answers only</option>
                <option value="responses">Their responses only</option>
                <option value="score_only">Score only</option>
                <option value="none">Nothing</option>
              </select>
            </Field>
            <Field label="When they can review" htmlFor="quiz-review-when">
              <select
                id="quiz-review-when"
                value={advanced.reviewWhen}
                onChange={(e) => patch({ reviewWhen: e.target.value as ReviewWhen })}
                disabled={disabled}
                className={inputClass}
              >
                <option value="after_submit">Right after submitting</option>
                <option value="after_due">After the due date</option>
                <option value="always">Anytime after availability</option>
                <option value="never">Never</option>
              </select>
            </Field>
          </div>
        </SettingsAccordion>

        <SettingsAccordion title="Presentation">
          <div className="divide-y divide-slate-100/90 dark:divide-neutral-800/80">
            <ToggleRow
              id="quiz-settings-one-question"
              label="One question at a time"
              description="Show a single question per step instead of the full list."
              checked={oneQuestionAtATime}
              onChange={onOneQuestionAtATimeChange}
              disabled={disabled}
            />
            <ToggleRow
              id="quiz-shuffle-q"
              label="Shuffle question order"
              description="Each learner sees questions in a random order (non-adaptive quizzes)."
              checked={advanced.shuffleQuestions}
              onChange={(next) => patch({ shuffleQuestions: next })}
              disabled={disabled}
            />
            <ToggleRow
              id="quiz-shuffle-c"
              label="Shuffle answer choices"
              description="Randomize multiple-choice and true/false option order per question."
              checked={advanced.shuffleChoices}
              onChange={(next) => patch({ shuffleChoices: next })}
              disabled={disabled}
            />
            <ToggleRow
              id="quiz-back-nav"
              label="Allow back navigation"
              description="Let learners move to previous questions when using one question at a time."
              checked={advanced.allowBackNavigation}
              onChange={(next) => patch({ allowBackNavigation: next })}
              disabled={disabled}
            />
            <div className="py-3">
              <Field
                label="Random question pool size"
                htmlFor="quiz-pool"
                hint="If set, each attempt draws this many questions from the bank (non-adaptive)."
              >
                <input
                  id="quiz-pool"
                  type="number"
                  min={1}
                  max={300}
                  placeholder="All questions"
                  value={advanced.randomQuestionPoolCount ?? ''}
                  onChange={(e) => {
                    const v = e.target.value
                    patch({ randomQuestionPoolCount: v === '' ? null : Math.min(300, Math.max(1, Number(v))) })
                  }}
                  disabled={disabled}
                  className={`max-w-[8rem] ${inputClass}`}
                />
              </Field>
            </div>
          </div>
        </SettingsAccordion>

        {courseCode && quizItemId ? (
          <SettingsAccordion title="Outcomes mapping">
            <ModuleItemOutcomesMappingAccordion
              courseCode={courseCode}
              itemId={quizItemId}
              mode="quiz"
              disabled={disabled}
              quizQuestions={quizOutcomesQuestions ?? []}
            />
          </SettingsAccordion>
        ) : null}

        <SettingsAccordion title="Access">
          <div className="pt-1">
            <Field
              label="Quiz access code"
              htmlFor="quiz-access-code"
              hint="Learners must enter this before starting. Leave empty for none."
            >
              <input
                id="quiz-access-code"
                type="password"
                autoComplete="new-password"
                value={advanced.quizAccessCode}
                onChange={(e) => patch({ quizAccessCode: e.target.value })}
                disabled={disabled}
                placeholder="Optional"
                className={inputClass}
              />
            </Field>
          </div>
        </SettingsAccordion>

        {showAdaptiveSection ? (
          <SettingsAccordion title="Adaptive AI">
            <div className="space-y-3 pt-1">
              <Field label="Difficulty target" htmlFor="quiz-ad-diff">
                <select
                  id="quiz-ad-diff"
                  value={advanced.adaptiveDifficulty}
                  onChange={(e) => patch({ adaptiveDifficulty: e.target.value as AdaptiveDifficulty })}
                  disabled={disabled}
                  className={inputClass}
                >
                  <option value="introductory">Introductory</option>
                  <option value="standard">Standard</option>
                  <option value="challenging">Challenging</option>
                </select>
              </Field>
              <ToggleRow
                id="quiz-ad-balance"
                label="Balance topics across sources"
                description="Try to cover reference materials evenly across questions."
                checked={advanced.adaptiveTopicBalance}
                onChange={(next) => patch({ adaptiveTopicBalance: next })}
                disabled={disabled}
              />
              <Field label="Stop rule" htmlFor="quiz-ad-stop">
                <select
                  id="quiz-ad-stop"
                  value={advanced.adaptiveStopRule}
                  onChange={(e) => patch({ adaptiveStopRule: e.target.value as AdaptiveStopRule })}
                  disabled={disabled}
                  className={inputClass}
                >
                  <option value="fixed_count">Fixed number of questions</option>
                  <option value="mastery_estimate">Adapt until mastery (within cap)</option>
                </select>
              </Field>
            </div>
          </SettingsAccordion>
        ) : null}
      </SettingsAccordionGroup>
    </div>
  )
}
