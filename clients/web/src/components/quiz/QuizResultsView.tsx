import { CheckCircle2, AlertCircle, RotateCcw, X } from 'lucide-react'
import type { ModuleQuizPayload, QuizAttemptResponse } from '../../lib/coursesApi'

export type QuizResultsViewProps = {
  quiz: ModuleQuizPayload
  attempt: QuizAttemptResponse
  onRetake?: () => void
  onClose: () => void
}

export function QuizResultsView({
  quiz,
  attempt,
  onRetake,
  onClose,
}: QuizResultsViewProps) {
  const score = attempt.score ?? 0
  const maxScore = attempt.maxScore ?? 1
  const percent = attempt.percent ?? 0
  const isPassing = quiz.passingScorePercent ? percent >= quiz.passingScorePercent : true
  const canRetake = quiz.unlimitedAttempts || (attempt.attemptNumber < quiz.maxAttempts)

  // Determine display based on review_visibility
  const showScore = quiz.reviewVisibility !== 'none'
  const showAnswers = ['responses', 'correct_answers', 'full'].includes(quiz.reviewVisibility)
  const showCorrectAnswers = ['correct_answers', 'full'].includes(quiz.reviewVisibility)

  const getLetterGrade = (pct: number): string => {
    if (pct >= 90) return 'A'
    if (pct >= 80) return 'B'
    if (pct >= 70) return 'C'
    if (pct >= 60) return 'D'
    return 'F'
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-start justify-between border-b border-slate-200 pb-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Quiz Complete</h2>
          <p className="mt-1 text-sm text-slate-600">{quiz.title}</p>
        </div>
        <button
          onClick={onClose}
          className="rounded p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
        >
          <X className="h-6 w-6" />
        </button>
      </div>

      {/* Score display */}
      {showScore && (
        <div className="rounded-lg border border-slate-200 bg-gradient-to-br from-blue-50 to-indigo-50 p-8">
          <div className="flex items-center gap-4">
            {isPassing ? (
              <CheckCircle2 className="h-12 w-12 flex-shrink-0 text-green-600" />
            ) : (
              <AlertCircle className="h-12 w-12 flex-shrink-0 text-amber-600" />
            )}
            <div>
              <p className="text-sm font-medium text-slate-600">Your Score</p>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-4xl font-bold text-slate-900">{score.toFixed(1)}</span>
                <span className="text-xl text-slate-600">/ {maxScore.toFixed(1)}</span>
              </div>
              <p className="mt-2 text-lg font-semibold text-slate-900">
                {percent.toFixed(1)}% ({getLetterGrade(percent)})
              </p>
              {quiz.passingScorePercent && (
                <p className="mt-1 text-xs text-slate-600">
                  {isPassing
                    ? `Passed (${quiz.passingScorePercent}% required)`
                    : `Did not pass (${quiz.passingScorePercent}% required)`}
                </p>
              )}
            </div>
          </div>

          {/* Attempt and timing info */}
          <div className="mt-6 flex gap-6 text-sm">
            <div>
              <p className="text-slate-600">Attempt</p>
              <p className="font-semibold text-slate-900">{attempt.attemptNumber}</p>
            </div>
            <div>
              <p className="text-slate-600">Submitted</p>
              <p className="font-semibold text-slate-900">
                {new Date(attempt.submittedAt).toLocaleString()}
              </p>
            </div>
            {/* Time spent could be calculated from submission details if tracked */}
          </div>
        </div>
      )}

      {/* Feedback based on score */}
      <div className="rounded-lg border border-slate-200 bg-white p-6">
        <h3 className="font-semibold text-slate-900">Feedback</h3>
        <p className="mt-2 text-slate-700">
          {isPassing
            ? "Great job! You have passed this quiz. Review the material if you'd like to improve your understanding."
            : 'You did not meet the passing score. Consider reviewing the course material and retaking the quiz if allowed.'}
        </p>
      </div>

      {/* Answers review */}
      {showAnswers && (
        <div className="rounded-lg border border-slate-200 bg-white p-6">
          <h3 className="font-semibold text-slate-900">Your Answers</h3>
          <p className="mt-1 text-sm text-slate-600">
            {showCorrectAnswers ? 'Review your answers and the correct answers below.' : 'Review your answers below.'}
          </p>
          <div className="mt-4 space-y-4">
            {/* This would typically show detailed answer feedback, but requires more data from the server */}
            <p className="text-sm text-slate-600 italic">
              Detailed answer review would be displayed here if available.
            </p>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3 border-t border-slate-200 pt-4">
        <button
          onClick={onClose}
          className="flex-1 rounded border border-slate-300 px-4 py-2 font-medium text-slate-700 hover:bg-slate-50"
        >
          Return to Quiz
        </button>
        {canRetake && onRetake && (
          <button
            onClick={onRetake}
            className="flex-1 flex items-center justify-center gap-2 rounded bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700"
          >
            <RotateCcw className="h-4 w-4" />
            Retake Quiz
          </button>
        )}
      </div>

      {!canRetake && (
        <p className="text-xs text-slate-600">
          You have used all available attempts for this quiz.
        </p>
      )}
    </div>
  )
}
