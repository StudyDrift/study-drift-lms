import { useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { BookLoader } from './BookLoader'
import { MarkdownArticleView } from '../syllabus/SyllabusMarkdownView'
import {
  postAdaptiveQuizNext,
  type AdaptiveQuizGeneratedQuestion,
  type AdaptiveQuizHistoryTurn,
  type QuizAdvancedSettings,
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
  /** Delivery settings used for preview behavior. */
  advanced: QuizAdvancedSettings
  oneQuestionAtATime: boolean
}

function visibleChoices(q: QuizQuestion): string[] {
  return q.choices.map((c) => c.trim()).filter((c) => c.length > 0)
}

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

/** Apply shuffle choices to a copy of the question. */
function withShuffledChoices(q: QuizQuestion): QuizQuestion {
  if (q.questionType !== 'multiple_choice' && q.questionType !== 'true_false') {
    return q
  }
  const choices = visibleChoices(q)
  if (choices.length === 0) return q
  const order = shuffleIndices(choices.length)
  const newChoices = order.map((i) => choices[i])
  let newCorrect: number | null = null
  if (q.correctChoiceIndex != null) {
    const oldIdx = q.correctChoiceIndex
    newCorrect = order.findIndex((orig) => orig === oldIdx)
    if (newCorrect < 0) newCorrect = null
  }
  return {
    ...q,
    choices: newChoices,
    correctChoiceIndex: newCorrect,
  }
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

function StaticQuizPreview({
  questions,
  advanced,
  oneQuestionAtATime,
}: {
  questions: QuizQuestion[]
  advanced: QuizAdvancedSettings
  oneQuestionAtATime: boolean
}) {
  const prepared = useMemo(() => {
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
  }, [questions, advanced.shuffleQuestions, advanced.shuffleChoices, advanced.randomQuestionPoolCount])

  const [step, setStep] = useState(0)
  useEffect(() => {
    setStep(0)
  }, [prepared])

  const [secondsLeft, setSecondsLeft] = useState<number | null>(() =>
    advanced.timeLimitMinutes != null ? advanced.timeLimitMinutes * 60 : null,
  )
  const [paused, setPaused] = useState(false)

  useEffect(() => {
    setSecondsLeft(advanced.timeLimitMinutes != null ? advanced.timeLimitMinutes * 60 : null)
  }, [advanced.timeLimitMinutes, prepared])

  useEffect(() => {
    if (secondsLeft == null || secondsLeft <= 0 || paused) return
    const t = window.setInterval(() => {
      setSecondsLeft((s) => (s == null || s <= 1 ? 0 : s - 1))
    }, 1000)
    return () => window.clearInterval(t)
  }, [secondsLeft, paused])

  useEffect(() => {
    if (!advanced.timerPauseWhenTabHidden) return
    function onVis() {
      setPaused(document.visibilityState === 'hidden')
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [advanced.timerPauseWhenTabHidden])

  const reviewNote = useMemo(() => {
    const v = advanced.reviewVisibility
    const w = advanced.reviewWhen
    const timing = advanced.showScoreTiming
    return `Preview note: scores shown ${timing.replace('_', ' ')}; review shows ${v.replace(/_/g, ' ')}; available ${w.replace(/_/g, ' ')}.`
  }, [advanced.reviewVisibility, advanced.reviewWhen, advanced.showScoreTiming])

  if (prepared.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-600">
        No questions to display (check pool size and question bank).
      </p>
    )
  }

  const atEnd = step >= prepared.length
  const current = prepared[step]

  return (
    <div className="space-y-4">
      {secondsLeft != null && (
        <p className="text-sm font-medium text-slate-800">
          Time remaining: {Math.floor(secondsLeft / 60)}:
          {(secondsLeft % 60).toString().padStart(2, '0')}
          {paused ? ' (paused)' : ''}
        </p>
      )}
      <p className="text-xs text-slate-500">{reviewNote}</p>
      {!oneQuestionAtATime ? (
        prepared.map((q, index) => <StudentQuestionBlock key={`${q.id}-${index}`} q={q} index={index} />)
      ) : !atEnd && current ? (
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Question {step + 1} of {prepared.length}
          </p>
          <StudentQuestionBlock q={current} index={step} />
          <div className="flex flex-wrap justify-end gap-2">
            {advanced.allowBackNavigation && step > 0 ? (
              <button
                type="button"
                onClick={() => setStep((s) => Math.max(0, s - 1))}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Back
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setStep((s) => s + 1)}
              className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500"
            >
              {step + 1 >= prepared.length ? 'Finish' : 'Next'}
            </button>
          </div>
        </div>
      ) : (
        <p className="text-sm text-slate-600">End of preview for one-question-at-a-time flow.</p>
      )}
    </div>
  )
}

function AccessCodeGate({
  advanced,
  onUnlocked,
}: {
  advanced: QuizAdvancedSettings
  onUnlocked: () => void
}) {
  const [value, setValue] = useState('')
  const [err, setErr] = useState<string | null>(null)

  const secret = advanced.quizAccessCode.trim()

  if (!secret) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <p>This quiz requires an access code. Save a code in quiz settings to test the full gate.</p>
        <button
          type="button"
          onClick={onUnlocked}
          className="mt-3 rounded-lg bg-amber-800/10 px-3 py-1.5 text-xs font-medium text-amber-950 hover:bg-amber-800/20"
        >
          Continue to question preview anyway
        </button>
      </div>
    )
  }

  function tryUnlock() {
    if (value.trim() === secret) {
      setErr(null)
      onUnlocked()
    } else {
      setErr('Code does not match.')
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-sm font-medium text-slate-800">Enter access code</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <input
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="min-w-[12rem] flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm"
          placeholder="Access code"
        />
        <button
          type="button"
          onClick={tryUnlock}
          className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500"
        >
          Continue
        </button>
      </div>
      {err ? <p className="mt-2 text-sm text-rose-600">{err}</p> : null}
    </div>
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
  const [pendingQueue, setPendingQueue] = useState<AdaptiveQuizGeneratedQuestion[]>([])
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null)
  const adaptiveSessionRef = useRef(0)
  const historySeqRef = useRef(0)
  const fetchInFlightRef = useRef(false)

  const current = pendingQueue[0] ?? null

  useEffect(() => {
    adaptiveSessionRef.current += 1
    historySeqRef.current += 1
    fetchInFlightRef.current = false
    setHistory([])
    setPendingQueue([])
    setSelectedIdx(null)
    setErrorMessage(null)
    setPhase('loading')
  }, [courseCode, itemId])

  useEffect(() => {
    const answered = history.length
    if (answered >= maxQuestions) {
      setPhase('done')
      return
    }

    const remainingSlots = maxQuestions - answered
    const need = Math.min(2, remainingSlots)
    if (pendingQueue.length >= need) {
      if (pendingQueue.length > 0) {
        setPhase((p) => (p === 'error' ? p : 'question'))
      }
      return
    }

    if (fetchInFlightRef.current) return
    fetchInFlightRef.current = true

    if (pendingQueue.length === 0) {
      setPhase((p) => (p === 'error' ? p : 'loading'))
    }

    const sessionAtStart = adaptiveSessionRef.current
    const historySeqAtStart = historySeqRef.current
    const historyForRequest = history

    void (async () => {
      try {
        const res = await postAdaptiveQuizNext(courseCode, itemId, { history: historyForRequest })
        if (sessionAtStart !== adaptiveSessionRef.current) return
        if (historySeqAtStart !== historySeqRef.current) return
        if (res.finished) {
          setPhase('done')
          return
        }
        const batch = res.questions
        if (!batch.length) {
          setErrorMessage('The server returned no questions.')
          setPhase('error')
          return
        }
        setPendingQueue((prev) => [...prev, ...batch])
        setPhase('question')
      } catch (e) {
        if (sessionAtStart !== adaptiveSessionRef.current) return
        if (historySeqAtStart !== historySeqRef.current) return
        setErrorMessage(e instanceof Error ? e.message : 'Could not load the next question.')
        setPhase('error')
      } finally {
        fetchInFlightRef.current = false
      }
    })()
  }, [courseCode, itemId, history, pendingQueue.length, maxQuestions])

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
    historySeqRef.current += 1
    setHistory(nextHist)
    setPendingQueue((q) => q.slice(1))
    setSelectedIdx(null)
    if (nextHist.length >= maxQuestions) {
      setPhase('done')
    }
  }

  return (
    <div className="rounded-xl border border-slate-200/90 bg-white p-4 shadow-sm">
      <p className="text-sm font-medium text-slate-800">Adaptive quiz preview</p>
      <p className="mt-1 text-xs text-slate-600">
        Questions are generated in pairs and kept one step ahead when possible (up to {maxQuestions} steps). Each
        answer informs the next batch. Nothing here is saved.
      </p>
      {phase === 'loading' && (
        <div
          className="mt-4 flex items-center gap-4 pl-2.5 text-sm leading-snug text-slate-600"
          role="status"
          aria-busy="true"
          aria-live="polite"
        >
          <div className="inline-flex shrink-0 origin-left scale-[0.32] translate-x-[10px] translate-y-[5px] self-center">
            <BookLoader />
          </div>
          <span className="min-w-0 flex-1">
            {history.length === 0 ? 'Setting up the quiz…' : 'Preparing the next question…'}
          </span>
        </div>
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
        <div className="mt-4 flex flex-col space-y-3">
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
            className="self-end rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500"
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
  advanced,
  oneQuestionAtATime,
}: QuizStudentPreviewModalProps) {
  const [accessOk, setAccessOk] = useState(false)

  useEffect(() => {
    if (open) {
      setAccessOk(!advanced.requiresQuizAccessCode)
    }
  }, [open, advanced.requiresQuizAccessCode])

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
                courseCode={courseCode}
              />
            </div>
            {advanced.requiresQuizAccessCode ? (
              <AccessCodeGate advanced={advanced} onUnlocked={() => setAccessOk(true)} />
            ) : null}
            {accessOk ? (
              adaptiveOn ? (
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
                <StaticQuizPreview questions={questions} advanced={advanced} oneQuestionAtATime={oneQuestionAtATime} />
              )
            ) : (
              <p className="text-center text-sm text-slate-500">Enter the code above to preview questions.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
