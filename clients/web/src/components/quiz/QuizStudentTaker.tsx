import { useEffect, useState, useCallback } from 'react'
import { AlertCircle, ChevronLeft, ChevronRight, Clock, Send } from 'lucide-react'
import { MarkdownArticleView } from '../syllabus/SyllabusMarkdownView'
import {
  startQuizAttempt,
  submitQuizAttempt,
  type QuizAnswer,
  type ModuleQuizPayload,
} from '../../lib/coursesApi'
import type { ResolvedMarkdownTheme } from '../../lib/markdownTheme'

export type QuizStudentTakerProps = {
  courseCode: string
  quiz: ModuleQuizPayload
  theme: ResolvedMarkdownTheme
  onSubmitted: (attemptId: string, score: number | null, maxScore: number | null) => void
  onCancel: () => void
}

export function QuizStudentTaker({
  courseCode,
  quiz,
  theme,
  onSubmitted,
  onCancel,
}: QuizStudentTakerProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [attemptId, setAttemptId] = useState<string | null>(null)
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0)
  const [answers, setAnswers] = useState<QuizAnswer[]>([])
  const [timeStarted, setTimeStarted] = useState<number>(Date.now())
  const [accessCode, setAccessCode] = useState('')
  const [showAccessCodePrompt, setShowAccessCodePrompt] = useState(!!quiz.requiresQuizAccessCode)

  const oneQuestionAtATime = quiz.oneQuestionAtATime ?? false
  const questions = quiz.questions ?? []
  const totalQuestions = questions.length
  const currentQuestion = questions[currentQuestionIndex]

  // Start attempt on mount
  useEffect(() => {
    const start = async () => {
      try {
        setLoading(true)
        const response = await startQuizAttempt(courseCode, quiz.itemId)
        setAttemptId(response.attemptId)
        setTimeStarted(Date.now())
        setAnswers(new Array(totalQuestions).fill(null).map((_, i) => ({ questionIndex: i })))
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to start quiz')
      } finally {
        setLoading(false)
      }
    }

    if (!showAccessCodePrompt) {
      start()
    }
  }, [showAccessCodePrompt, courseCode, quiz.itemId, totalQuestions])

  const handleAccessCodeSubmit = async () => {
    if (!accessCode.trim()) {
      setError('Access code is required')
      return
    }
    setShowAccessCodePrompt(false)
  }

  const updateAnswer = useCallback(
    (selectedChoiceIndex?: number | null, textAnswer?: string | null) => {
      const newAnswers = [...answers]
      newAnswers[currentQuestionIndex] = {
        questionIndex: currentQuestionIndex,
        selectedChoiceIndex,
        textAnswer,
      }
      setAnswers(newAnswers)
    },
    [answers, currentQuestionIndex],
  )

  const handleNextQuestion = () => {
    if (currentQuestionIndex < totalQuestions - 1) {
      setCurrentQuestionIndex(currentQuestionIndex + 1)
    }
  }

  const handlePreviousQuestion = () => {
    if (currentQuestionIndex > 0) {
      setCurrentQuestionIndex(currentQuestionIndex - 1)
    }
  }

  const handleSubmit = async () => {
    if (!attemptId) return

    try {
      setLoading(true)
      const timeSpent = Math.floor((Date.now() - timeStarted) / 1000)
      const response = await submitQuizAttempt(courseCode, quiz.itemId, attemptId, {
        accessCode: quiz.requiresQuizAccessCode ? accessCode : undefined,
        answers,
        timeSpentSeconds: timeSpent,
      })
      onSubmitted(response.attemptId, response.score ?? null, response.maxScore ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit quiz')
    } finally {
      setLoading(false)
    }
  }

  if (showAccessCodePrompt) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-slate-200 bg-white p-8">
        <AlertCircle className="h-8 w-8 text-amber-600" />
        <h2 className="text-lg font-semibold">Access Code Required</h2>
        <p className="text-center text-sm text-slate-600">
          This quiz requires an access code to begin
        </p>
        <input
          type="password"
          placeholder="Enter access code"
          value={accessCode}
          onChange={(e) => setAccessCode(e.target.value)}
          className="w-full max-w-xs rounded border border-slate-300 px-3 py-2"
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleAccessCodeSubmit()
          }}
        />
        <div className="flex gap-2">
          <button
            onClick={onCancel}
            className="rounded border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            onClick={handleAccessCodeSubmit}
            disabled={!accessCode.trim()}
            className="rounded bg-blue-600 px-4 py-2 text-sm text-white disabled:bg-slate-300 hover:bg-blue-700"
          >
            Continue
          </button>
        </div>
      </div>
    )
  }

  if (!attemptId) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-center">
          <div className="inline-block rounded-full bg-slate-100 p-3">
            <Clock className="h-6 w-6 text-slate-400" />
          </div>
          <p className="mt-4 text-slate-600">Starting quiz...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-lg border border-red-200 bg-red-50 p-8">
        <AlertCircle className="h-8 w-8 text-red-600" />
        <p className="font-semibold text-red-900">{error}</p>
        <button
          onClick={onCancel}
          className="rounded bg-red-600 px-4 py-2 text-sm text-white hover:bg-red-700"
        >
          Go Back
        </button>
      </div>
    )
  }

  if (!currentQuestion) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-lg border border-red-200 bg-red-50 p-8">
        <AlertCircle className="h-8 w-8 text-red-600" />
        <p className="font-semibold text-red-900">Quiz has no questions</p>
        <button
          onClick={onCancel}
          className="rounded bg-red-600 px-4 py-2 text-sm text-white hover:bg-red-700"
        >
          Go Back
        </button>
      </div>
    )
  }

  const currentAnswer = answers[currentQuestionIndex]
  const answerCount = answers.filter(
    (a) => a.selectedChoiceIndex !== undefined || a.textAnswer,
  ).length

  return (
    <div className="flex flex-col gap-6">
      {/* Quiz intro (show on first question) */}
      {currentQuestionIndex === 0 && quiz.markdown && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-6">
          <h2 className="text-lg font-semibold text-slate-900">{quiz.title}</h2>
          <div className="prose prose-sm mt-3 max-w-none">
            <MarkdownArticleView markdown={quiz.markdown} theme={theme} />
          </div>
        </div>
      )}

      {/* Question progress */}
      <div className="flex items-center justify-between border-b border-slate-200 pb-4">
        <div>
          <p className="text-sm font-medium text-slate-700">
            Question {currentQuestionIndex + 1} of {totalQuestions}
          </p>
          <div className="mt-2 h-1 w-64 overflow-hidden rounded-full bg-slate-200">
            <div
              className="h-full bg-blue-600 transition-all"
              style={{
                width: `${((currentQuestionIndex + 1) / totalQuestions) * 100}%`,
              }}
            />
          </div>
        </div>
        <div className="text-right">
          <p className="text-sm text-slate-600">Answered: {answerCount} / {totalQuestions}</p>
        </div>
      </div>

      {/* Current question */}
      <div className="rounded-lg border border-slate-200 bg-white p-6">
        <div className="mb-4">
          <h3 className="text-lg font-semibold text-slate-900">{currentQuestion.prompt}</h3>
          <p className="mt-2 text-sm text-slate-600">
            {currentQuestion.points === 1 ? '1 point' : `${currentQuestion.points} points`}
            {currentQuestion.estimatedMinutes > 0 && ` · ~${currentQuestion.estimatedMinutes} min`}
          </p>
        </div>

        {/* Question rendering based on type */}
        {(currentQuestion.questionType === 'multiple_choice' ||
          currentQuestion.questionType === 'true_false') && (
          <div className="space-y-2">
            {currentQuestion.choices.map((choice, idx) => (
              <label key={idx} className="flex items-start gap-3 rounded p-2 hover:bg-slate-50">
                <input
                  type="radio"
                  name={`q-${currentQuestion.id}`}
                  checked={currentAnswer?.selectedChoiceIndex === idx}
                  onChange={() => updateAnswer(idx)}
                  className="mt-1"
                />
                <span className="flex-1 text-slate-700">{choice}</span>
              </label>
            ))}
          </div>
        )}

        {currentQuestion.questionType === 'fill_in_blank' && (
          <input
            type="text"
            placeholder="Type your answer"
            value={currentAnswer?.textAnswer ?? ''}
            onChange={(e) => updateAnswer(undefined, e.target.value)}
            className="w-full rounded border border-slate-300 px-3 py-2"
          />
        )}

        {(currentQuestion.questionType === 'short_answer' ||
          currentQuestion.questionType === 'essay') && (
          <textarea
            placeholder="Type your answer"
            value={currentAnswer?.textAnswer ?? ''}
            onChange={(e) => updateAnswer(undefined, e.target.value)}
            className="h-32 w-full rounded border border-slate-300 px-3 py-2"
          />
        )}
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between gap-4">
        <button
          onClick={handlePreviousQuestion}
          disabled={currentQuestionIndex === 0 || loading}
          className="flex items-center gap-2 rounded border border-slate-300 px-4 py-2 disabled:opacity-50 hover:bg-slate-50"
        >
          <ChevronLeft className="h-4 w-4" />
          Previous
        </button>

        {!oneQuestionAtATime && currentQuestionIndex < totalQuestions - 1 && (
          <button
            onClick={handleNextQuestion}
            disabled={loading}
            className="flex items-center gap-2 rounded border border-slate-300 px-4 py-2 hover:bg-slate-50"
          >
            Next
            <ChevronRight className="h-4 w-4" />
          </button>
        )}

        {oneQuestionAtATime && currentQuestionIndex < totalQuestions - 1 && (
          <button
            onClick={handleNextQuestion}
            disabled={loading}
            className="flex items-center gap-2 rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
          >
            Next
            <ChevronRight className="h-4 w-4" />
          </button>
        )}

        {currentQuestionIndex === totalQuestions - 1 && (
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="flex items-center gap-2 rounded bg-green-600 px-4 py-2 text-white hover:bg-green-700 disabled:bg-slate-300"
          >
            <Send className="h-4 w-4" />
            Submit Quiz
          </button>
        )}

        <button
          onClick={onCancel}
          disabled={loading}
          className="rounded border border-slate-300 px-4 py-2 disabled:opacity-50 hover:bg-slate-50"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
