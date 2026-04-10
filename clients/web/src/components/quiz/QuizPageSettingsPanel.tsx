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
    <div className="flex items-start justify-between gap-3 border-b border-slate-100 py-3 last:border-b-0 dark:border-slate-700">
      <div className="min-w-0">
        <label htmlFor={id} className="text-[13px] font-medium text-slate-800 dark:text-slate-100">
          {label}
        </label>
        <p className="mt-0.5 text-xs leading-relaxed text-slate-500 dark:text-slate-400">{description}</p>
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition disabled:cursor-not-allowed disabled:opacity-50 ${
          checked ? 'bg-indigo-500' : 'bg-slate-300 dark:bg-slate-600'
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
}: QuizPageSettingsPanelProps) {
  return (
    <div className="space-y-1">
      <p className="mb-3 text-[13px] leading-relaxed text-slate-600 dark:text-slate-300">
        Scheduling and how the quiz is shown to learners. Save the page from the toolbar to apply changes.
      </p>
      <div>
        <label
          className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300"
          htmlFor="quiz-settings-due"
        >
          Due date
        </label>
        <input
          id="quiz-settings-due"
          type="datetime-local"
          value={dueLocal}
          onChange={(e) => onDueLocalChange(e.target.value)}
          disabled={disabled}
          className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm text-slate-900 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-indigo-500 dark:focus:ring-indigo-500"
        />
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Optional. Cleared if empty.</p>
      </div>
      <div className="pt-2">
        <label
          className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300"
          htmlFor="quiz-settings-visible-from"
        >
          Visibility start date
        </label>
        <input
          id="quiz-settings-visible-from"
          type="datetime-local"
          value={availableFromLocal}
          onChange={(e) => onAvailableFromLocalChange(e.target.value)}
          disabled={disabled}
          className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm text-slate-900 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-indigo-500 dark:focus:ring-indigo-500"
        />
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Optional. Learners cannot open the quiz before this time.</p>
      </div>
      <div className="pt-2">
        <label
          className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300"
          htmlFor="quiz-settings-visible-until"
        >
          Visibility end date
        </label>
        <input
          id="quiz-settings-visible-until"
          type="datetime-local"
          value={availableUntilLocal}
          onChange={(e) => onAvailableUntilLocalChange(e.target.value)}
          disabled={disabled}
          className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm text-slate-900 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-indigo-500 dark:focus:ring-indigo-500"
        />
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Optional. After this time the quiz is no longer available.</p>
      </div>
      <div className="mt-2 border-t border-slate-100 pt-1 dark:border-slate-700">
        <ToggleRow
          id="quiz-settings-unlimited-attempts"
          label="Unlimited attempts"
          description="Allow learners to retake without an attempt limit."
          checked={unlimitedAttempts}
          onChange={onUnlimitedAttemptsChange}
          disabled={disabled}
        />
        <ToggleRow
          id="quiz-settings-one-question"
          label="One question at a time"
          description="Show a single question per step instead of the full list."
          checked={oneQuestionAtATime}
          onChange={onOneQuestionAtATimeChange}
          disabled={disabled}
        />
      </div>
    </div>
  )
}
