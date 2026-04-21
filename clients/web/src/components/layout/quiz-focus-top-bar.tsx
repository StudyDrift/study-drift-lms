import { Bookmark, Clock } from 'lucide-react'
import type { QuizShellFocusMode } from './quiz-shell-focus-context'

export function QuizFocusTopBar({ model }: { model: QuizShellFocusMode }) {
  const { quizTitle, timeRemainingLabel, timeUrgent, questionProgress, saveStatusText, lockdownAccent, flaggedForCurrent, onToggleFlagForReview } =
    model

  const barTint =
    lockdownAccent === 'kiosk'
      ? 'border-b-amber-700/40 bg-amber-950 text-amber-50 dark:border-b-amber-500/30 dark:bg-amber-950/90 dark:text-amber-50'
      : lockdownAccent === 'one_at_a_time'
        ? 'border-b-indigo-900/25 bg-indigo-950 text-indigo-50 dark:border-b-indigo-400/20 dark:bg-indigo-950/90 dark:text-indigo-50'
        : 'border-b-slate-200 bg-slate-900 text-slate-50 dark:border-b-neutral-700 dark:bg-neutral-950 dark:text-neutral-100'

  return (
    <header
      className={`flex min-h-14 shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b px-3 py-2 shadow-md print:hidden sm:px-4 md:px-6 ${barTint}`}
      role="banner"
      aria-label="Quiz session"
    >
      <div className="min-w-0 flex-1 basis-[min(100%,14rem)]">
        <p className="truncate text-xs font-semibold uppercase tracking-wide opacity-80">Assessment</p>
        <h1 className="truncate text-sm font-semibold tracking-tight sm:text-base">{quizTitle || 'Quiz'}</h1>
      </div>

      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
        {questionProgress ? (
          <p className="shrink-0 rounded-lg bg-white/10 px-2.5 py-1 text-xs font-semibold tabular-nums sm:text-sm" aria-live="polite">
            {questionProgress}
          </p>
        ) : null}

        {timeRemainingLabel ? (
          <p
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold tabular-nums sm:text-sm ${
              timeUrgent ? 'bg-rose-600 text-white' : 'bg-white/10'
            }`}
            role="timer"
            aria-live={timeUrgent ? 'assertive' : 'polite'}
          >
            <Clock className="h-3.5 w-3.5 shrink-0 opacity-90" aria-hidden />
            <span>{timeRemainingLabel}</span>
          </p>
        ) : null}

        <p className="max-w-[14rem] truncate text-xs opacity-90 sm:text-sm" title={saveStatusText}>
          {saveStatusText}
        </p>

        {onToggleFlagForReview ? (
          <button
            type="button"
            onClick={onToggleFlagForReview}
            aria-pressed={flaggedForCurrent}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold transition sm:text-sm ${
              flaggedForCurrent
                ? 'border-amber-300 bg-amber-400/20 text-amber-50'
                : 'border-white/25 bg-white/5 text-inherit hover:bg-white/10'
            }`}
          >
            <Bookmark className={`h-3.5 w-3.5 shrink-0 ${flaggedForCurrent ? 'fill-current' : ''}`} aria-hidden />
            {flaggedForCurrent ? 'Flagged' : 'Flag for review'}
          </button>
        ) : null}
      </div>

      {lockdownAccent === 'kiosk' ? (
        <p className="w-full text-[11px] font-medium leading-snug opacity-90 sm:text-xs">
          Kiosk mode: stay in this window. Leaving the tab may be logged.
        </p>
      ) : lockdownAccent === 'one_at_a_time' ? (
        <p className="w-full text-[11px] font-medium leading-snug opacity-90 sm:text-xs">
          One question at a time — you cannot return to earlier questions after you continue.
        </p>
      ) : null}
    </header>
  )
}
