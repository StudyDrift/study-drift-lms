import { useCallback, useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { MarkdownArticleView } from '../syllabus/SyllabusMarkdownView'
import {
  postAdaptiveQuizNext,
  type AdaptiveQuizGeneratedQuestion,
  type AdaptiveQuizHistoryTurn,
  type QuizQuestion,
} from '../../lib/coursesApi'
import type { ResolvedMarkdownTheme } from '../../lib/markdownTheme'

export type QuizStudentPreviewModalProps = {
  open: boolean
  onClose: () => void
  quizTitle: string
  markdown: string
  dueAt: string | null
  questions: QuizQuestion[]
  theme: ResolvedMarkdownTheme
  courseCode?: string
  itemId?: string
  isAdaptive?: boolean
  adaptiveQuestionCount?: number
}

function visibleChoices(q: QuizQuestion): string[] {
  return q.choices.map((c) => c.trim()).filter((c) => c.length > 0)
}

function QuestionMeta({ q }: { q: QuizQuestion }) {
  const parts: string[] = []
  parts.push(q.required ? 'Required' : 'Optional')
  parts.push(q.points === 1 ? '1 point' : `${q.points} points`)
  if (q.estimatedMinutes > 0) {
    parts.push(`~${q.estimatedMinutes} min`)
  }
  return <p className="text-xs text-slate-500">{parts.join(' · ')}</p>
}

function StudentQuestionBlock({ q, index }: { q: QuizQuestion; index: number }) {
  const choices = visibleChoices(q)
  const showChoices = q.questionType === 'multiple_choice' || q.questionType === 'true_false'

  return (
    <section
      className="rounded-xl border border-slate-200/90 bg-white p-5 shadow-sm shadow-slate-900/[0.03]"
      aria-labelledby={`preview-q-${q.id}-heading`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2
          id={`preview-q-${q.id}-heading`}
          className="text-xs font-semibold uppercase tracking-wide text-slate-500"
        >
          Question {index + 1}
        </h2>
      </div>
      <p className="mt-2 whitespace-pre-wrap text-sm font-medium text-slate-900">{q.prompt || '—'}</p>
      <div className="mt-2">
        <QuestionMeta q={q} />
      </div>

      {showChoices && (
        <div className="mt-4 space-y-2">
          {choices.length === 0 ? (
            <p className="text-sm italic text-slate-500">No answer choices are set for this question.</p>
          ) : q.multipleAnswer ? (
            choices.map((label, i) => (
              <label
                key={`${q.id}-c-${i}`}
                className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 bg-slate-50/50 px-3 py-2.5 text-sm text-slate-800 transition hover:border-slate-300"
              >
                <input
                  type="checkbox"
                  name={`preview-${q.id}`}
                  value={String(i)}
                  className="mt-0.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500/30"
                />
                <span className="min-w-0 flex-1">{label}</span>
              </label>
            ))
          ) : (
            choices.map((label, i) => (
              <label
                key={`${q.id}-c-${i}`}
                className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 bg-slate-50/50 px-3 py-2.5 text-sm text-slate-800 transition hover:border-slate-300"
              >
                <input
                  type="radio"
                  name={`preview-${q.id}`}
                  value={String(i)}
                  className="mt-0.5 border-slate-300 text-indigo-600 focus:ring-indigo-500/30"
                />
                <span className="min-w-0 flex-1">{label}</span>
              </label>
            ))
          )}
        </div>
      )}

      {q.questionType === 'fill_in_blank' && (
        <div className="mt-4">
          <label className="sr-only" htmlFor={`preview-fib-${q.id}`}>
            Your answer
          </label>
          <input
            id={`preview-fib-${q.id}`}
            type="text"
            placeholder="Type your answer"
            className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-400/30"
          />
        </div>
      )}

      {q.questionType === 'short_answer' && (
        <div className="mt-4">
          <label className="sr-only" htmlFor={`preview-sa-${q.id}`}>
            Your answer
          </label>
          <textarea
            id={`preview-sa-${q.id}`}
            rows={3}
            placeholder="Type your answer"
            className="w-full resize-y rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-400/30"
          />
        </div>
      )}

      {q.questionType === 'essay' && (
        <div className="mt-4">
          <label className="sr-only" htmlFor={`preview-essay-${q.id}`}>
            Your response
          </label>
          <textarea
            id={`preview-essay-${q.id}`}
            rows={8}
            placeholder="Write your response"
            className="w-full resize-y rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-400/30"
          />
        </div>
      )}

      {q.answerWithImage && (
        <div className="mt-4">
          <label className="block text-sm font-medium text-slate-700" htmlFor={`preview-img-${q.id}`}>
            Image upload
          </label>
          <input
            id={`preview-img-${q.id}`}
            type="file"
            accept="image/*"
            className="mt-1 block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-indigo-700 hover:file:bg-indigo-100"
          />
        </div>
      )}
    </section>
  )
}

function AdaptivePreviewPanel({
  courseCode,
  itemId,
  maxQuestions,
}: {
  courseCode: string
  itemId: string
  maxQuestions: number
}) {
  const [phase, setPhase] = useState<'loading' | 'question' | 'done' | 'error'>('loading')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [history, setHistory] = useState<AdaptiveQuizHistoryTurn[]>([])
  const [current, setCurrent] = useState<AdaptiveQuizGeneratedQuestion | null>(null)
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null)

  const loadNext = useCallback(
    async (nextHistory: AdaptiveQuizHistoryTurn[]) => {
      setPhase('loading')
      setErrorMessage(null)
      try {
        const res = await postAdaptiveQuizNext(courseCode, itemId, { history: nextHistory })
        if (res.finished) {
          setCurrent(null)
          setPhase('done')
          return
        }
        setCurrent(res.question)
        setSelectedIdx(null)
        setPhase('question')
      } catch (e) {
        setErrorMessage(e instanceof Error ? e.message : 'Could not load the next question.')
        setPhase('error')
      }
    },
    [courseCode, itemId],
  )

  useEffect(() => {
    setHistory([])
    setCurrent(null)
    setSelectedIdx(null)
    setErrorMessage(null)
    void loadNext([])
  }, [courseCode, itemId, loadNext])

  async function submitAndContinue() {
    if (!current) return
    if (current.questionType === 'multiple_choice' || current.questionType === 'true_false') {
      if (selectedIdx == null) {
        setErrorMessage('Select an answer to continue.')
        return
      }
    }
    const turn: AdaptiveQuizHistoryTurn = {
      prompt: current.prompt,
      questionType: current.questionType,
      choices: current.choices,
      choiceWeights: current.choiceWeights,
      selectedChoiceIndex: selectedIdx,
    }
    const nextHist = [...history, turn]
    setHistory(nextHist)
    await loadNext(nextHist)
  }

  return (
    <div className="rounded-xl border border-slate-200/90 bg-white p-4 shadow-sm">
      <p className="text-sm font-medium text-slate-800">Adaptive quiz preview</p>
      <p className="mt-1 text-xs text-slate-600">
        Questions are generated one at a time (up to {maxQuestions} steps). Each answer informs the next question.
        Nothing here is saved.
      </p>
      {phase === 'loading' && (
        <p className="mt-4 text-sm text-slate-500" role="status">
          Generating question…
        </p>
      )}
      {phase === 'error' && errorMessage && (
        <p className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {errorMessage}
        </p>
      )}
      {phase === 'done' && (
        <p className="mt-4 text-sm text-slate-600">End of preview — you have reached the configured question count.</p>
      )}
      {phase === 'question' && current && (
        <div className="mt-4 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Question {Math.min(history.length + 1, maxQuestions)} of {maxQuestions}
          </p>
          <p className="whitespace-pre-wrap text-sm font-medium text-slate-900">{current.prompt}</p>
          <div className="space-y-2">
            {current.choices.map((label, i) => (
              <label
                key={`ad-c-${i}`}
                className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 bg-slate-50/50 px-3 py-2.5 text-sm text-slate-800 transition hover:border-slate-300"
              >
                <input
                  type="radio"
                  name="adaptive-preview-choice"
                  checked={selectedIdx === i}
                  onChange={() => {
                    setSelectedIdx(i)
                    setErrorMessage(null)
                  }}
                  className="mt-0.5 border-slate-300 text-indigo-600 focus:ring-indigo-500/30"
                />
                <span className="min-w-0 flex-1">{label}</span>
              </label>
            ))}
          </div>
          <button
            type="button"
            onClick={() => void submitAndContinue()}
            className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500"
          >
            Submit answer
          </button>
        </div>
      )}
    </div>
  )
}

export function QuizStudentPreviewModal({
  open,
  onClose,
  quizTitle,
  markdown,
  dueAt,
  questions,
  theme,
  courseCode,
  itemId,
  isAdaptive,
  adaptiveQuestionCount = 5,
}: QuizStudentPreviewModalProps) {
  if (!open) return null

  const adaptiveOn = Boolean(isAdaptive && courseCode && itemId)

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="quiz-preview-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="flex h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div className="min-w-0">
            <h2 id="quiz-preview-title" className="text-sm font-semibold text-slate-900">
              Student preview
            </h2>
            <p className="mt-0.5 truncate text-xs text-slate-500" title={quizTitle}>
              {quizTitle}
            </p>
            <p className="mt-2 text-xs text-slate-600">
              This is how the quiz appears to learners. Nothing you enter here is saved.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
            aria-label="Close preview"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50/60 p-4">
          <div className="mx-auto max-w-2xl space-y-6">
            {dueAt && (
              <p className="text-sm text-slate-600">
                <span className="font-medium text-slate-800">Due:</span>{' '}
                {new Date(dueAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
              </p>
            )}
            <div className="rounded-xl border border-slate-200/90 bg-white p-4 shadow-sm">
              <MarkdownArticleView
                markdown={markdown}
                emptyMessage="This quiz does not include an introduction."
                theme={theme}
              />
            </div>
            {adaptiveOn ? (
              <AdaptivePreviewPanel
                key={`${courseCode}-${itemId}`}
                courseCode={courseCode!}
                itemId={itemId!}
                maxQuestions={Math.min(30, Math.max(1, adaptiveQuestionCount))}
              />
            ) : questions.length === 0 ? (
              <p className="rounded-xl border border-dashed border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-600">
                There are no questions in this quiz yet.
              </p>
            ) : (
              <div className="space-y-4">
                {questions.map((q, index) => (
                  <StudentQuestionBlock key={q.id} q={q} index={index} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
