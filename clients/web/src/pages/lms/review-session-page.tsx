import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import {
  fetchLearnerReviewQueue,
  postLearnerSrsReview,
  type ReviewQueueItem,
} from '../../lib/courses-api'
import { getJwtSubject } from '../../lib/auth'
import { LmsPage } from './lms-page'

function formatAnswerPreview(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'string') return v
  try {
    return JSON.stringify(v, null, 2)
  } catch {
    return String(v)
  }
}

export default function ReviewSessionPage() {
  const userId = getJwtSubject()
  const [queue, setQueue] = useState<ReviewQueueItem[]>([])
  const [totalDue, setTotalDue] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [revealed, setRevealed] = useState(false)

  const reload = useCallback(async () => {
    if (!userId) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetchLearnerReviewQueue(userId, { limit: 200, offset: 0 })
      setQueue(res.items)
      setTotalDue(res.totalDue)
      setRevealed(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load review queue.')
    } finally {
      setLoading(false)
    }
  }, [userId])

  useEffect(() => {
    void reload()
  }, [reload])

  const current = queue[0] ?? null
  const reviewedCount = Math.max(0, totalDue - queue.length)

  const onGrade = async (grade: 'again' | 'hard' | 'good' | 'easy') => {
    if (!userId || !current) return
    setError(null)
    try {
      await postLearnerSrsReview(userId, { questionId: current.questionId, grade })
      const next = queue.slice(1)
      setQueue(next)
      setRevealed(false)
      if (next.length === 0) {
        await reload()
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save review.')
    }
  }

  if (!userId) {
    return (
      <LmsPage title="Review" description="Sign in to use spaced repetition.">
        <p className="mt-6 text-sm text-slate-600 dark:text-neutral-400">You need to be signed in.</p>
      </LmsPage>
    )
  }

  return (
    <LmsPage
      title="Review"
      description="Spaced repetition for question-bank items marked SRS-eligible in courses that enable review."
    >
      <div className="mt-4">
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-sm font-medium text-indigo-600 hover:text-indigo-500 dark:text-indigo-400"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Back to dashboard
        </Link>
      </div>

      {error && (
        <p className="mt-6 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-100">
          {error}
        </p>
      )}

      {loading && <p className="mt-8 text-sm text-slate-500 dark:text-neutral-400">Loading queue…</p>}

      {!loading && !current && (
        <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-8 text-center dark:border-neutral-800 dark:bg-neutral-950">
          <p className="text-sm font-medium text-slate-800 dark:text-neutral-100">You&apos;re caught up</p>
          <p className="mt-2 text-xs text-slate-500 dark:text-neutral-400">
            When instructors enable SRS on a course and tag questions, due items appear here.
          </p>
        </div>
      )}

      {!loading && current && (
        <div className="mt-8 space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500 dark:text-neutral-400">
            <span>
              {reviewedCount + 1} of {totalDue || queue.length} due
            </span>
            <span className="font-mono text-[11px] text-slate-400 dark:text-neutral-500">{current.courseTitle}</span>
          </div>
          <div
            role="region"
            aria-label="Review card"
            tabIndex={0}
            onKeyDown={(ev) => {
              if (ev.key === ' ' || ev.key === 'Enter') {
                ev.preventDefault()
                setRevealed((r) => !r)
              }
            }}
            className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm outline-none ring-indigo-500 focus-visible:ring-2 dark:border-neutral-800 dark:bg-neutral-950"
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-neutral-500">
              Question
            </p>
            <div className="mt-3 whitespace-pre-wrap text-base text-slate-900 dark:text-neutral-50">{current.stem}</div>
            <button
              type="button"
              className="mt-6 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-800 transition hover:bg-slate-100 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800"
              onClick={() => setRevealed((r) => !r)}
            >
              {revealed ? 'Hide answer' : 'Show answer (Space)'}
            </button>
            {revealed && (
              <div className="mt-4 rounded-xl border border-emerald-100 bg-emerald-50/60 p-4 text-sm text-emerald-950 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-50">
                <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800 dark:text-emerald-200">
                  Answer
                </p>
                <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap font-sans text-sm">
                  {formatAnswerPreview(current.correctAnswer)}
                </pre>
                {current.explanation ? (
                  <p className="mt-3 text-xs text-emerald-900 dark:text-emerald-100">{current.explanation}</p>
                ) : null}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <GradeButton
              label="Again"
              shortcut="1"
              color="bg-rose-600 hover:bg-rose-500"
              onClick={() => void onGrade('again')}
            />
            <GradeButton
              label="Hard"
              shortcut="2"
              color="bg-orange-600 hover:bg-orange-500"
              onClick={() => void onGrade('hard')}
            />
            <GradeButton
              label="Good"
              shortcut="3"
              color="bg-indigo-600 hover:bg-indigo-500"
              onClick={() => void onGrade('good')}
            />
            <GradeButton
              label="Easy"
              shortcut="4"
              color="bg-emerald-600 hover:bg-emerald-500"
              onClick={() => void onGrade('easy')}
            />
          </div>
        </div>
      )}
    </LmsPage>
  )
}

function GradeButton({
  label,
  shortcut,
  color,
  onClick,
}: {
  label: string
  shortcut: string
  color: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${label}, keyboard shortcut ${shortcut}`}
      className={`rounded-xl px-3 py-3 text-center text-sm font-semibold text-white shadow-sm transition ${color}`}
    >
      <span className="block">{label}</span>
      <span className="mt-1 block text-[10px] font-normal opacity-90">Key {shortcut}</span>
    </button>
  )
}
