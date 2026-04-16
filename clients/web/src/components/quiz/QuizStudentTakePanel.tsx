import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { X } from 'lucide-react'
import { BookLoader } from './BookLoader'
import {
  fetchQuizResults,
  postAdaptiveQuizNext,
  postQuizStart,
  postQuizSubmit,
  type AdaptiveQuizGeneratedQuestion,
  type AdaptiveQuizHistoryTurn,
  type ModuleQuizPayload,
  type QuizAdvancedSettings,
  type QuizQuestion,
} from '../../lib/coursesApi'

function shuffleIndices(n: number): number[] {
  const a = Array.from({ length: n }, (_, i) => i)
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function shuffleArray<T>(items: T[]): T[] {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

function visibleChoices(q: QuizQuestion): string[] {
  return q.choices.map((c) => c.trim()).filter((c) => c.length > 0)
}

function withShuffledChoices(q: QuizQuestion): QuizQuestion {
  if (q.questionType !== 'multiple_choice' && q.questionType !== 'true_false') {
    return q
  }
  const choices = visibleChoices(q)
  if (choices.length === 0) return q
  const order = shuffleIndices(choices.length)
  const newChoices = order.map((i) => choices[i])
  return {
    ...q,
    choices: newChoices,
    correctChoiceIndex: null,
  }
}

function prepareStaticQuestions(questions: QuizQuestion[], advanced: QuizAdvancedSettings): QuizQuestion[] {
  let qs = [...questions]
  if (advanced.shuffleQuestions) {
    qs = shuffleArray(qs)
  }
  const pool = advanced.randomQuestionPoolCount
  if (typeof pool === 'number' && pool >= 1 && pool < qs.length) {
    qs = shuffleArray(qs).slice(0, pool)
  }
  if (advanced.shuffleChoices) {
    qs = qs.map((q) => withShuffledChoices({ ...q, choices: [...q.choices] }))
  }
  return qs
}

export type QuizStudentTakePanelProps = {
  open: boolean
  onClose: () => void
  courseCode: string
  itemId: string
  quiz: ModuleQuizPayload
  advanced: QuizAdvancedSettings
  oneQuestionAtATime: boolean
  allowBackNavigation: boolean
}

type UiPhase =
  | { kind: 'idle' }
  | { kind: 'starting' }
  | { kind: 'static' }
  | { kind: 'done'; summary: string }

export function QuizStudentTakePanel({
  open,
  onClose,
  courseCode,
  itemId,
  quiz,
  advanced,
  oneQuestionAtATime,
  allowBackNavigation,
}: QuizStudentTakePanelProps) {
  const [accessCode, setAccessCode] = useState('')
  const [uiPhase, setUiPhase] = useState<UiPhase>({ kind: 'idle' })
  const [error, setError] = useState<string | null>(null)

  const [staticQuestions, setStaticQuestions] = useState<QuizQuestion[]>([])
  const [attemptId, setAttemptId] = useState<string | null>(null)
  const [answers, setAnswers] = useState<Record<string, { choice?: number; text?: string }>>({})

  const [adHistory, setAdHistory] = useState<AdaptiveQuizHistoryTurn[]>([])
  const [adPending, setAdPending] = useState<AdaptiveQuizGeneratedQuestion[]>([])
  const [adSelected, setAdSelected] = useState<number | null>(null)
  const [adPhase, setAdPhase] = useState<'idle' | 'loading' | 'question' | 'submitting' | 'done'>('idle')

  const adaptiveSessionRef = useRef(0)
  const historySeqRef = useRef(0)
  const fetchInFlightRef = useRef(false)
  const adaptiveSubmitStartedRef = useRef(false)

  const maxAdaptive = useMemo(
    () => Math.min(30, Math.max(1, quiz.adaptiveQuestionCount || 1)),
    [quiz.adaptiveQuestionCount],
  )

  const reset = useCallback(() => {
    adaptiveSessionRef.current += 1
    historySeqRef.current += 1
    fetchInFlightRef.current = false
    adaptiveSubmitStartedRef.current = false
    setUiPhase({ kind: 'idle' })
    setError(null)
    setAccessCode('')
    setStaticQuestions([])
    setAttemptId(null)
    setAnswers({})
    setAdHistory([])
    setAdPending([])
    setAdSelected(null)
    setAdPhase('idle')
  }, [])

  useEffect(() => {
    if (!open) reset()
  }, [open, reset])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      e.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  async function beginAttempt() {
    setError(null)
    setUiPhase({ kind: 'starting' })
    try {
      const start = await postQuizStart(courseCode, itemId, {
        quizAccessCode: advanced.requiresQuizAccessCode ? accessCode : undefined,
      })
      setAttemptId(start.attemptId)
      if (quiz.isAdaptive) {
        adaptiveSessionRef.current += 1
        adaptiveSubmitStartedRef.current = false
        setAdHistory([])
        setAdPending([])
        setAdSelected(null)
        setAdPhase('loading')
        setUiPhase({ kind: 'static' })
        return
      }
      const prepared = prepareStaticQuestions(quiz.questions, advanced)
      if (prepared.length === 0) {
        throw new Error('This quiz has no questions yet.')
      }
      setStaticQuestions(prepared)
      setUiPhase({ kind: 'static' })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start the quiz.')
      setUiPhase({ kind: 'idle' })
    }
  }

  const finishWithSummary = useCallback(
    async (sub: { attemptId: string }) => {
      let extra = ''
      try {
        const res = await fetchQuizResults(courseCode, itemId, { attemptId: sub.attemptId })
        if (res.score) {
          extra = ` Score: ${res.score.pointsEarned.toFixed(2)} / ${res.score.pointsPossible.toFixed(2)} (${res.score.scorePercent.toFixed(0)}%).`
        }
      } catch {
        /* review policy may hide results */
      }
      setUiPhase({ kind: 'done', summary: `Submitted successfully.${extra}` })
      setAdPhase('done')
    },
    [courseCode, itemId],
  )

  async function submitStatic() {
    if (!attemptId) return
    setError(null)
    try {
      const responses = staticQuestions.map((q) => {
        const a = answers[q.id]
        if (q.questionType === 'multiple_choice' || q.questionType === 'true_false') {
          return { questionId: q.id, selectedChoiceIndex: a?.choice ?? undefined }
        }
        return { questionId: q.id, textAnswer: a?.text ?? '' }
      })
      const sub = await postQuizSubmit(courseCode, itemId, { attemptId, responses })
      await finishWithSummary(sub)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Submit failed.')
    }
  }

  // Adaptive: prefetch next questions (mirrors QuizStudentPreviewModal)
  useEffect(() => {
    if (!open || !quiz.isAdaptive || !attemptId) return
    if (adPhase === 'idle' || adPhase === 'done' || adPhase === 'submitting') return

    const answered = adHistory.length
    if (answered >= maxAdaptive) {
      if (adaptiveSubmitStartedRef.current) return
      adaptiveSubmitStartedRef.current = true
      setAdPhase('submitting')
      void (async () => {
        try {
          const sub = await postQuizSubmit(courseCode, itemId, {
            attemptId,
            adaptiveHistory: adHistory,
          })
          await finishWithSummary(sub)
        } catch (e) {
          adaptiveSubmitStartedRef.current = false
          setError(e instanceof Error ? e.message : 'Submit failed.')
          setAdPhase('idle')
        }
      })()
      return
    }

    const remainingSlots = maxAdaptive - answered
    const need = Math.min(2, remainingSlots)
    if (adPending.length >= need) {
      if (adPending.length > 0) {
        setAdPhase((p) => (p === 'submitting' ? p : 'question'))
      }
      return
    }

    if (fetchInFlightRef.current) return
    fetchInFlightRef.current = true
    if (adPending.length === 0) {
      setAdPhase((p) => (p === 'submitting' ? p : 'loading'))
    }

    const sessionAtStart = adaptiveSessionRef.current
    const historySeqAtStart = historySeqRef.current
    const historyForRequest = adHistory

    void (async () => {
      try {
        const res = await postAdaptiveQuizNext(courseCode, itemId, {
          history: historyForRequest,
          attemptId,
        })
        if (sessionAtStart !== adaptiveSessionRef.current) return
        if (historySeqAtStart !== historySeqRef.current) return
        if (res.finished) {
          const sub = await postQuizSubmit(courseCode, itemId, {
            attemptId,
            adaptiveHistory: historyForRequest,
          })
          await finishWithSummary(sub)
          return
        }
        const batch = res.questions
        if (!batch.length) {
          setError('The server returned no questions.')
          setAdPhase('idle')
          return
        }
        setAdPending((prev) => [...prev, ...batch])
        setAdPhase('question')
      } catch (e) {
        if (sessionAtStart !== adaptiveSessionRef.current) return
        setError(e instanceof Error ? e.message : 'Could not load the next question.')
        setAdPhase('idle')
      } finally {
        fetchInFlightRef.current = false
      }
    })()
  }, [
    open,
    quiz.isAdaptive,
    attemptId,
    adHistory,
    adPending.length,
    maxAdaptive,
    adPhase,
    courseCode,
    itemId,
    finishWithSummary,
  ])

  async function submitAdaptiveAnswer() {
    const current = adPending[0]
    if (!current || !attemptId) return
    if (current.questionType === 'multiple_choice' || current.questionType === 'true_false') {
      if (adSelected == null) {
        setError('Select an answer to continue.')
        return
      }
    }
    setError(null)
    const turn: AdaptiveQuizHistoryTurn = {
      prompt: current.prompt,
      questionType: current.questionType,
      choices: current.choices,
      choiceWeights: current.choiceWeights,
      selectedChoiceIndex: adSelected,
      points: current.points,
    }
    const nextHist = [...adHistory, turn]
    historySeqRef.current += 1
    setAdHistory(nextHist)
    setAdPending((q) => q.slice(1))
    setAdSelected(null)
  }

  if (!open) return null

  const currentAdaptive = adPending[0] ?? null

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="quiz-take-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="flex h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-neutral-600 dark:bg-neutral-900">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-neutral-600">
          <div className="min-w-0">
            <h2 id="quiz-take-title" className="text-sm font-semibold text-slate-900 dark:text-neutral-100">
              Take quiz
            </h2>
            <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-neutral-400" title={quiz.title}>
              {quiz.title || 'Quiz'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:hover:bg-neutral-800"
            aria-label="Close"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50/60 p-4 dark:bg-neutral-950/80">
          {error && (
            <p className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-200">
              {error}
            </p>
          )}

          {uiPhase.kind === 'idle' && (
            <div className="space-y-4">
              <p className="text-sm text-slate-600 dark:text-neutral-300">
                {quiz.isAdaptive
                  ? 'You will answer up to the configured number of AI-generated questions. Your attempt is saved when you finish.'
                  : 'Answer each question, then submit. Your score is recorded for this course.'}
              </p>
              {advanced.requiresQuizAccessCode ? (
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-neutral-400">
                    Access code
                  </label>
                  <input
                    type="password"
                    value={accessCode}
                    onChange={(e) => setAccessCode(e.target.value)}
                    className="w-full max-w-sm rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-neutral-600 dark:bg-neutral-900"
                    placeholder="Enter code"
                  />
                </div>
              ) : null}
              <button
                type="button"
                onClick={() => void beginAttempt()}
                className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500"
              >
                Begin
              </button>
            </div>
          )}

          {uiPhase.kind === 'starting' && (
            <div className="flex items-center gap-3 text-sm text-slate-600 dark:text-neutral-300">
              <span className="inline-flex shrink-0 origin-left scale-[0.32]">
                <BookLoader />
              </span>
              Starting…
            </div>
          )}

          {uiPhase.kind === 'static' && !quiz.isAdaptive && staticQuestions.length > 0 && (
            <StaticTakeBody
              questions={staticQuestions}
              oneQuestionAtATime={oneQuestionAtATime}
              allowBackNavigation={allowBackNavigation}
              answers={answers}
              setAnswers={setAnswers}
              onSubmit={() => void submitStatic()}
            />
          )}

          {uiPhase.kind === 'static' && quiz.isAdaptive && (
            <div className="space-y-4">
              {adPhase === 'loading' && (
                <div className="flex items-center gap-3 text-sm text-slate-600 dark:text-neutral-300">
                  <span className="inline-flex shrink-0 origin-left scale-[0.32]">
                    <BookLoader />
                  </span>
                  {adHistory.length === 0 ? 'Setting up the quiz…' : 'Preparing the next question…'}
                </div>
              )}
              {adPhase === 'question' && currentAdaptive && (
                <div className="space-y-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-neutral-400">
                    Question {Math.min(adHistory.length + 1, maxAdaptive)} of {maxAdaptive}
                  </p>
                  <p className="whitespace-pre-wrap text-sm font-medium text-slate-900 dark:text-neutral-100">
                    {currentAdaptive.prompt}
                  </p>
                  <div className="space-y-2">
                    {currentAdaptive.choices.map((label, i) => (
                      <label
                        key={`ad-${i}`}
                        className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100"
                      >
                        <input
                          type="radio"
                          name="adaptive-take-choice"
                          checked={adSelected === i}
                          onChange={() => {
                            setAdSelected(i)
                            setError(null)
                          }}
                          className="mt-0.5 border-slate-300 text-indigo-600"
                        />
                        <span className="min-w-0 flex-1">{label}</span>
                      </label>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => void submitAdaptiveAnswer()}
                    className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500"
                  >
                    Submit answer
                  </button>
                </div>
              )}
              {adPhase === 'submitting' && (
                <p className="text-sm text-slate-600 dark:text-neutral-300">Submitting your quiz…</p>
              )}
            </div>
          )}

          {uiPhase.kind === 'done' && (
            <div className="space-y-3">
              <p className="text-sm text-slate-800 dark:text-neutral-200">{uiPhase.summary}</p>
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-800 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-200"
              >
                Close
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function StaticTakeBody({
  questions,
  oneQuestionAtATime,
  allowBackNavigation,
  answers,
  setAnswers,
  onSubmit,
}: {
  questions: QuizQuestion[]
  oneQuestionAtATime: boolean
  allowBackNavigation: boolean
  answers: Record<string, { choice?: number; text?: string }>
  setAnswers: Dispatch<SetStateAction<Record<string, { choice?: number; text?: string }>>>
  onSubmit: () => void
}) {
  const [step, setStep] = useState(0)
  useEffect(() => {
    setStep(0)
  }, [questions])

  function renderQuestion(q: QuizQuestion, index: number) {
    const choices = visibleChoices(q)
    const showChoices = q.questionType === 'multiple_choice' || q.questionType === 'true_false'
    const a = answers[q.id] ?? {}

    return (
      <section
        key={q.id}
        className="rounded-xl border border-slate-200/90 bg-white p-5 shadow-sm dark:border-neutral-600 dark:bg-neutral-900"
      >
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-neutral-400">
          Question {index + 1}
        </p>
        <p className="mt-2 whitespace-pre-wrap text-sm font-medium text-slate-900 dark:text-neutral-100">{q.prompt || '—'}</p>
        {showChoices && (
          <div className="mt-4 space-y-2">
            {choices.map((label, i) => (
              <label
                key={`${q.id}-c-${i}`}
                className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 bg-slate-50/50 px-3 py-2.5 text-sm dark:border-neutral-600 dark:bg-neutral-800/50"
              >
                <input
                  type="radio"
                  name={`take-${q.id}`}
                  checked={a.choice === i}
                  onChange={() =>
                    setAnswers((prev) => ({
                      ...prev,
                      [q.id]: { ...prev[q.id], choice: i },
                    }))
                  }
                  className="mt-0.5 border-slate-300 text-indigo-600"
                />
                <span className="min-w-0 flex-1">{label}</span>
              </label>
            ))}
          </div>
        )}
        {q.questionType === 'fill_in_blank' && (
          <input
            type="text"
            className="mt-4 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-neutral-600 dark:bg-neutral-900"
            value={a.text ?? ''}
            onChange={(e) =>
              setAnswers((prev) => ({
                ...prev,
                [q.id]: { ...prev[q.id], text: e.target.value },
              }))
            }
            placeholder="Your answer"
          />
        )}
        {(q.questionType === 'short_answer' || q.questionType === 'essay') && (
          <textarea
            rows={q.questionType === 'essay' ? 8 : 3}
            className="mt-4 w-full resize-y rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-neutral-600 dark:bg-neutral-900"
            value={a.text ?? ''}
            onChange={(e) =>
              setAnswers((prev) => ({
                ...prev,
                [q.id]: { ...prev[q.id], text: e.target.value },
              }))
            }
            placeholder="Your answer"
          />
        )}
      </section>
    )
  }

  if (!oneQuestionAtATime) {
    return (
      <div className="space-y-6">
        {questions.map((q, i) => renderQuestion(q, i))}
        <button
          type="button"
          onClick={onSubmit}
          className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500"
        >
          Submit quiz
        </button>
      </div>
    )
  }

  const current = questions[step]
  if (!current) return null
  const isLast = step + 1 >= questions.length

  return (
    <div className="space-y-4">
      <p className="text-xs font-semibold text-slate-500 dark:text-neutral-400">
        Question {step + 1} of {questions.length}
      </p>
      {renderQuestion(current, step)}
      <div className="flex flex-wrap justify-end gap-2">
        {allowBackNavigation && step > 0 ? (
          <button
            type="button"
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm dark:border-neutral-600 dark:bg-neutral-900"
          >
            Back
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => {
            if (isLast) {
              onSubmit()
            } else {
              setStep((s) => s + 1)
            }
          }}
          className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500"
        >
          {isLast ? 'Submit' : 'Next'}
        </button>
      </div>
    </div>
  )
}
