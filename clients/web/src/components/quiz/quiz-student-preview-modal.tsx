import { useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { MathPlainText } from '../math/math-plain-text'
import { BookLoader } from './book-loader'
import { MathKeyboard } from './math-keyboard'
import { MarkdownArticleView } from '../syllabus/syllabus-markdown-view'
import {
  postAdaptiveQuizNext,
  type AdaptiveQuizGeneratedQuestion,
  type AdaptiveQuizHistoryTurn,
  type QuizAdvancedSettings,
  type QuizQuestion,
} from '../../lib/courses-api'
import { shuffleArray, shuffledIndices } from '../../lib/shuffle'
import type { ResolvedMarkdownTheme } from '../../lib/markdown-theme'

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

/** Apply shuffle choices to a copy of the question. */
function withShuffledChoices(q: QuizQuestion): QuizQuestion {
  if (q.questionType !== 'multiple_choice' && q.questionType !== 'true_false') {
    return q
  }
  const choices = visibleChoices(q)
  if (choices.length === 0) return q
  const order = shuffledIndices(choices.length)
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

function orderingItemsForPreview(q: QuizQuestion): string[] {
  const configured = q.typeConfig?.items
  if (Array.isArray(configured)) {
    const items = configured.map((x) => String(x).trim()).filter((x) => x.length > 0)
    if (items.length > 0) return items
  }
  return visibleChoices(q)
}

function previewQuestionResetKey(q: QuizQuestion): string {
  return `${q.id}\0${q.questionType}\0${JSON.stringify(q.typeConfig)}\0${JSON.stringify(q.choices)}`
}

type MatchingPairDraft = {
  leftId?: string
  rightId?: string
  left?: string
  right?: string
}

function matchingPairsForPreview(q: QuizQuestion): MatchingPairDraft[] {
  const configured = q.typeConfig?.pairs
  if (!Array.isArray(configured)) return []
  return configured
    .map((pair) => {
      const p = pair as Record<string, unknown>
      return {
        leftId: typeof p.leftId === 'string' ? p.leftId : typeof p.left_id === 'string' ? p.left_id : undefined,
        rightId:
          typeof p.rightId === 'string' ? p.rightId : typeof p.right_id === 'string' ? p.right_id : undefined,
        left: typeof p.left === 'string' ? p.left : undefined,
        right: typeof p.right === 'string' ? p.right : undefined,
      }
    })
    .filter((p) => (p.left ?? '').trim().length > 0 || (p.right ?? '').trim().length > 0)
}

function StudentQuestionBlock({ q, index }: { q: QuizQuestion; index: number }) {
  const choices = visibleChoices(q)
  const showChoices = q.questionType === 'multiple_choice' || q.questionType === 'true_false'
  const textRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null)
  const [ordering, setOrdering] = useState<string[]>(() => orderingItemsForPreview(q))
  const baseOrdering = orderingItemsForPreview(q)
  const [matchingAnswers, setMatchingAnswers] = useState<Record<string, string>>({})
  const [hotspotClick, setHotspotClick] = useState<{ x: number; y: number } | null>(null)

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
      <p className="mt-2 text-sm font-medium text-slate-900">
        <MathPlainText text={q.prompt || '—'} />
      </p>
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
                <span className="min-w-0 flex-1">
                  <MathPlainText text={label} />
                </span>
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
                <span className="min-w-0 flex-1">
                  <MathPlainText text={label} />
                </span>
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
            ref={(el) => {
              textRef.current = el
            }}
            id={`preview-fib-${q.id}`}
            type="text"
            placeholder="Type your answer"
            className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-400/30"
          />
          <MathKeyboard
            className="mt-2"
            onInsert={(snippet, caret) => {
              const el = textRef.current
              if (!el || !('value' in el)) return
              const cur = el.value
              const start = el.selectionStart ?? cur.length
              const end = el.selectionEnd ?? cur.length
              const next = cur.slice(0, start) + snippet + cur.slice(end)
              el.value = next
              const pos = start + (caret ?? snippet.length)
              requestAnimationFrame(() => {
                el.focus()
                el.setSelectionRange(pos, pos)
              })
            }}
          />
        </div>
      )}

      {q.questionType === 'short_answer' && (
        <div className="mt-4">
          <label className="sr-only" htmlFor={`preview-sa-${q.id}`}>
            Your answer
          </label>
          <textarea
            ref={(el) => {
              textRef.current = el
            }}
            id={`preview-sa-${q.id}`}
            rows={3}
            placeholder="Type your answer"
            className="w-full resize-y rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-400/30"
          />
          <MathKeyboard
            className="mt-2"
            onInsert={(snippet, caret) => {
              const el = textRef.current
              if (!el || !('value' in el)) return
              const cur = el.value
              const start = el.selectionStart ?? cur.length
              const end = el.selectionEnd ?? cur.length
              const next = cur.slice(0, start) + snippet + cur.slice(end)
              el.value = next
              const pos = start + (caret ?? snippet.length)
              requestAnimationFrame(() => {
                el.focus()
                el.setSelectionRange(pos, pos)
              })
            }}
          />
        </div>
      )}

      {q.questionType === 'essay' && (
        <div className="mt-4">
          <label className="sr-only" htmlFor={`preview-essay-${q.id}`}>
            Your response
          </label>
          <textarea
            ref={(el) => {
              textRef.current = el
            }}
            id={`preview-essay-${q.id}`}
            rows={8}
            placeholder="Write your response"
            className="w-full resize-y rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-400/30"
          />
          <MathKeyboard
            className="mt-2"
            onInsert={(snippet, caret) => {
              const el = textRef.current
              if (!el || !('value' in el)) return
              const cur = el.value
              const start = el.selectionStart ?? cur.length
              const end = el.selectionEnd ?? cur.length
              const next = cur.slice(0, start) + snippet + cur.slice(end)
              el.value = next
              const pos = start + (caret ?? snippet.length)
              requestAnimationFrame(() => {
                el.focus()
                el.setSelectionRange(pos, pos)
              })
            }}
          />
        </div>
      )}

      {q.questionType === 'ordering' && (
        <div className="mt-4 space-y-2">
          {ordering.length === 0 ? (
            <p className="text-sm italic text-slate-500">Add ordering items in the question editor.</p>
          ) : (
            ordering.map((item, i) => (
              <div
                key={`${q.id}-ordering-${i}-${item}`}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = 'move'
                  e.dataTransfer.setData('text/plain', String(i))
                }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  const fromRaw = e.dataTransfer.getData('text/plain')
                  const from = Number(fromRaw)
                  if (!Number.isFinite(from) || from < 0 || from === i) return
                  setOrdering((prev) => {
                    const next = [...prev]
                    const [moved] = next.splice(from, 1)
                    next.splice(i, 0, moved)
                    return next
                  })
                }}
                className="flex cursor-grab items-center justify-between rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2 text-sm text-slate-800"
              >
                <span className="truncate">
                  {(baseOrdering.findIndex((x) => x === item) + 1 || i + 1)}. <MathPlainText text={item} />
                </span>
                <span className="text-xs text-slate-400">Drag</span>
              </div>
            ))
          )}
        </div>
      )}

      {q.questionType === 'numeric' && (
        <div className="mt-4">
          <label className="sr-only" htmlFor={`preview-numeric-${q.id}`}>
            Numeric answer
          </label>
          <input
            id={`preview-numeric-${q.id}`}
            type="number"
            step="any"
            placeholder="Enter a number"
            className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-400/30"
          />
        </div>
      )}

      {q.questionType === 'code' && (
        <div className="mt-4">
          <label className="sr-only" htmlFor={`preview-code-${q.id}`}>
            Code response
          </label>
          <textarea
            id={`preview-code-${q.id}`}
            rows={8}
            placeholder="Write your code here"
            className="w-full resize-y rounded-lg border border-slate-200 bg-slate-950 px-3 py-2.5 font-mono text-sm text-slate-100 placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-400/30"
          />
        </div>
      )}

      {q.questionType === 'matching' && (
        <div className="mt-4 space-y-2">
          {matchingPairsForPreview(q).length === 0 ? (
            <p className="text-sm italic text-slate-500">Add matching pairs in the question editor.</p>
          ) : (
            matchingPairsForPreview(q).map((pair, i) => {
              const leftLabel = pair.left ?? ''
              const key = pair.leftId ?? `left-${i}`
              const options = shuffleArray(matchingPairsForPreview(q).map((p, idx) => p.right ?? `Option ${idx + 1}`))
              return (
                <div key={`${q.id}-matching-${i}`} className="grid gap-2 md:grid-cols-2">
                  <p className="rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2 text-sm text-slate-800">
                    <MathPlainText text={leftLabel} />
                  </p>
                  <select
                    value={matchingAnswers[key] ?? ''}
                    onChange={(e) =>
                      setMatchingAnswers((prev) => ({
                        ...prev,
                        [key]: e.target.value,
                      }))
                    }
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                  >
                    <option value="">Select match...</option>
                    {options.map((opt, optIdx) => (
                      <option key={`${q.id}-match-opt-${i}-${optIdx}`} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                </div>
              )
            })
          )}
        </div>
      )}

      {q.questionType === 'formula' && (
        <div className="mt-4">
          <label className="sr-only" htmlFor={`preview-formula-${q.id}`}>
            Formula answer
          </label>
          <input
            ref={(el) => {
              textRef.current = el
            }}
            id={`preview-formula-${q.id}`}
            type="text"
            placeholder="Enter LaTeX, e.g. x^2+2x+1"
            className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-400/30"
          />
          <MathKeyboard
            className="mt-2"
            onInsert={(snippet, caret) => {
              const el = textRef.current
              if (!el || !('value' in el)) return
              const cur = el.value
              const start = el.selectionStart ?? cur.length
              const end = el.selectionEnd ?? cur.length
              const next = cur.slice(0, start) + snippet + cur.slice(end)
              el.value = next
              const pos = start + (caret ?? snippet.length)
              requestAnimationFrame(() => {
                el.focus()
                el.setSelectionRange(pos, pos)
              })
            }}
          />
        </div>
      )}

      {q.questionType === 'hotspot' && (
        <div className="mt-4 space-y-2">
          {typeof q.typeConfig?.imageUrl === 'string' && q.typeConfig.imageUrl.trim().length > 0 ? (
            <div
              className="relative overflow-hidden rounded-lg border border-slate-200 bg-slate-50"
              onClick={(e) => {
                const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
                const x = Math.round(e.clientX - rect.left)
                const y = Math.round(e.clientY - rect.top)
                setHotspotClick({ x, y })
              }}
            >
              <img
                src={q.typeConfig.imageUrl}
                alt="Hotspot prompt"
                className="max-h-72 w-full object-contain"
              />
              {hotspotClick ? (
                <span
                  className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-indigo-600 ring-2 ring-white"
                  style={{ left: hotspotClick.x, top: hotspotClick.y }}
                />
              ) : null}
            </div>
          ) : (
            <p className="text-sm italic text-slate-500">Set an image URL in the question editor.</p>
          )}
          <p className="text-xs text-slate-500">
            {hotspotClick ? `Selected point: (${hotspotClick.x}, ${hotspotClick.y})` : 'Click the image to choose a point.'}
          </p>
        </div>
      )}

      {q.questionType === 'file_upload' && (
        <div className="mt-4">
          <input
            type="file"
            className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-indigo-700 hover:file:bg-indigo-100"
          />
        </div>
      )}

      {q.questionType === 'audio_response' && (
        <div className="mt-4">
          <input
            type="file"
            accept="audio/*"
            className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-indigo-700 hover:file:bg-indigo-100"
          />
        </div>
      )}

      {q.questionType === 'video_response' && (
        <div className="mt-4">
          <input
            type="file"
            accept="video/*"
            className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-indigo-700 hover:file:bg-indigo-100"
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

function StaticQuizPreviewBody({
  prepared,
  advanced,
  oneQuestionAtATime,
  reviewNote,
}: {
  prepared: QuizQuestion[]
  advanced: QuizAdvancedSettings
  oneQuestionAtATime: boolean
  reviewNote: string
}) {
  const [step, setStep] = useState(0)
  const [secondsLeft, setSecondsLeft] = useState<number | null>(() =>
    advanced.timeLimitMinutes != null ? advanced.timeLimitMinutes * 60 : null,
  )
  const [paused, setPaused] = useState(false)

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
        prepared.map((q, index) => (
          <StudentQuestionBlock key={`${index}-${previewQuestionResetKey(q)}`} q={q} index={index} />
        ))
      ) : !atEnd && current ? (
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Question {step + 1} of {prepared.length}
          </p>
          <StudentQuestionBlock key={previewQuestionResetKey(current)} q={current} index={step} />
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

  const preparedSessionKey = useMemo(
    () => `${prepared.map((q) => q.id).join('|')}#${advanced.timeLimitMinutes ?? ''}`,
    [prepared, advanced.timeLimitMinutes],
  )

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

  return (
    <StaticQuizPreviewBody
      key={preparedSessionKey}
      prepared={prepared}
      advanced={advanced}
      oneQuestionAtATime={oneQuestionAtATime}
      reviewNote={reviewNote}
    />
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
      ...(current.questionId ? { questionId: current.questionId } : {}),
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
          <p className="text-sm font-medium text-slate-900">
            <MathPlainText text={current.prompt} />
          </p>
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

type QuizStudentPreviewModalContentProps = Omit<QuizStudentPreviewModalProps, 'open'>

function QuizStudentPreviewModalContent({
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
}: QuizStudentPreviewModalContentProps) {
  const [accessUnlocked, setAccessUnlocked] = useState(false)
  const accessOk = !advanced.requiresQuizAccessCode || accessUnlocked
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
              <AccessCodeGate advanced={advanced} onUnlocked={() => setAccessUnlocked(true)} />
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

export function QuizStudentPreviewModal({ open, onClose, ...rest }: QuizStudentPreviewModalProps) {
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

  return <QuizStudentPreviewModalContent onClose={onClose} {...rest} />
}
