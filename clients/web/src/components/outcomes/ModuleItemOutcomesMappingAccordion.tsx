import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, Trash2 } from 'lucide-react'
import { usePermissions } from '../../context/usePermissions'
import {
  addCourseOutcomeLink,
  courseItemCreatePermission,
  deleteCourseOutcomeLink,
  fetchCourseOutcomes,
  OUTCOME_INTENSITY_LEVEL_IDS,
  OUTCOME_MEASUREMENT_LEVEL_IDS,
  type CourseOutcome,
  type CourseOutcomeLink,
} from '../../lib/coursesApi'

const inputClass =
  'w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm text-slate-900 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400 disabled:opacity-60 dark:border-neutral-600 dark:bg-neutral-950 dark:text-neutral-100 dark:focus:border-indigo-500 dark:focus:ring-indigo-500'

const MEASUREMENT_LABELS: Record<string, string> = {
  diagnostic: 'Diagnostic',
  formative: 'Formative',
  summative: 'Summative',
  performance: 'Performance / transfer',
}

const INTENSITY_LABELS: Record<string, string> = {
  low: 'Light emphasis',
  medium: 'Moderate emphasis',
  high: 'Strong emphasis',
}

function formatLevels(link: CourseOutcomeLink): string {
  const m = MEASUREMENT_LABELS[link.measurementLevel] ?? link.measurementLevel
  const i = INTENSITY_LABELS[link.intensityLevel] ?? link.intensityLevel
  return `${m} · ${i}`
}

function linkTargetLabel(link: CourseOutcomeLink): string {
  if (link.targetKind === 'quiz_question') return 'One question'
  if (link.targetKind === 'quiz') return 'Whole quiz'
  return 'Assignment'
}

type ModuleItemOutcomesMappingAccordionProps = {
  courseCode: string
  itemId: string
  mode: 'assignment' | 'quiz'
  disabled?: boolean
  /** Saved quiz questions (ids) — used when mapping a single question. */
  quizQuestions?: { id: string; prompt: string }[]
}

export function ModuleItemOutcomesMappingAccordion({
  courseCode,
  itemId,
  mode,
  disabled,
  quizQuestions = [],
}: ModuleItemOutcomesMappingAccordionProps) {
  const { allows, loading: permLoading } = usePermissions()
  const canMap = !permLoading && allows(courseItemCreatePermission(courseCode))

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [outcomes, setOutcomes] = useState<CourseOutcome[]>([])

  const [outcomeId, setOutcomeId] = useState('')
  const [measurementLevel, setMeasurementLevel] = useState('formative')
  const [intensityLevel, setIntensityLevel] = useState('medium')
  const [quizScope, setQuizScope] = useState<'whole' | 'question'>('whole')
  const [questionId, setQuestionId] = useState('')
  const [adding, setAdding] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const data = await fetchCourseOutcomes(courseCode)
      setOutcomes(data.outcomes)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not load outcomes.')
    } finally {
      setLoading(false)
    }
  }, [courseCode])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (quizScope !== 'question') return
    setQuestionId((cur) => {
      if (quizQuestions.some((q) => q.id === cur)) return cur
      return quizQuestions[0]?.id ?? ''
    })
  }, [quizScope, quizQuestions])

  const mappedRows = useMemo(() => {
    const rows: { outcome: CourseOutcome; link: CourseOutcomeLink }[] = []
    for (const o of outcomes) {
      for (const link of o.links) {
        if (link.structureItemId !== itemId) continue
        if (mode === 'assignment') {
          if (link.targetKind !== 'assignment') continue
        } else if (link.targetKind !== 'quiz' && link.targetKind !== 'quiz_question') {
          continue
        }
        rows.push({ outcome: o, link })
      }
    }
    return rows
  }, [outcomes, itemId, mode])

  async function onAdd(e: React.FormEvent) {
    e.preventDefault()
    setActionError(null)
    if (!outcomeId) {
      setActionError('Choose an outcome.')
      return
    }
    const targetKind =
      mode === 'assignment'
        ? 'assignment'
        : quizScope === 'whole'
          ? 'quiz'
          : 'quiz_question'
    if (targetKind === 'quiz_question') {
      if (!questionId.trim()) {
        setActionError('Pick a question, or choose whole quiz.')
        return
      }
    }
    setAdding(true)
    try {
      await addCourseOutcomeLink(courseCode, outcomeId, {
        structureItemId: itemId,
        targetKind,
        quizQuestionId: targetKind === 'quiz_question' ? questionId.trim() : undefined,
        measurementLevel,
        intensityLevel,
      })
      setOutcomeId('')
      setMeasurementLevel('formative')
      setIntensityLevel('medium')
      setQuizScope('whole')
      setQuestionId('')
      await load()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not add mapping.')
    } finally {
      setAdding(false)
    }
  }

  async function onRemove(outcomeOid: string, linkId: string) {
    setActionError(null)
    try {
      await deleteCourseOutcomeLink(courseCode, outcomeOid, linkId)
      await load()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not remove mapping.')
    }
  }

  const settingsOutcomesUrl = `/courses/${encodeURIComponent(courseCode)}/settings/outcomes`

  return (
    <div className="space-y-3 pt-1">
      <p className="text-[11px] leading-snug text-slate-400 dark:text-neutral-500">
        Link this {mode === 'assignment' ? 'assignment' : 'quiz'} to course learning outcomes with
        measurement and intensity.{' '}
        <Link to={settingsOutcomesUrl} className="font-medium text-indigo-600 hover:text-indigo-500 dark:text-indigo-400">
          Open full outcomes page
        </Link>
        .
      </p>

      {!canMap ? (
        <p className="text-[11px] text-slate-500 dark:text-neutral-500">
          You need course edit permission to change outcome mappings.
        </p>
      ) : null}

      {loadError ? (
        <p className="text-[11px] text-rose-600 dark:text-rose-400">{loadError}</p>
      ) : null}
      {actionError ? (
        <p className="text-[11px] text-rose-600 dark:text-rose-400">{actionError}</p>
      ) : null}

      {loading ? (
        <p className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-neutral-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          Loading…
        </p>
      ) : null}

      {!loading && canMap && (
        <>
          {mappedRows.length === 0 ? (
            <p className="text-[11px] text-slate-500 dark:text-neutral-500">No outcome links for this item yet.</p>
          ) : (
            <ul className="space-y-2">
              {mappedRows.map(({ outcome, link }) => {
                const qSnippet =
                  link.targetKind === 'quiz_question'
                    ? quizQuestions.find((q) => q.id === link.quizQuestionId)?.prompt ??
                      link.quizQuestionId
                    : null
                return (
                <li
                  key={link.id}
                  className="flex items-start justify-between gap-2 rounded-md border border-slate-100 bg-slate-50/80 px-2 py-1.5 dark:border-neutral-800 dark:bg-neutral-900/40"
                >
                  <div className="min-w-0 text-[11px] leading-snug">
                    <p className="font-medium text-slate-800 dark:text-neutral-200">{outcome.title}</p>
                    <p className="mt-0.5 text-slate-500 dark:text-neutral-500">
                      {linkTargetLabel(link)}
                      {qSnippet
                        ? ` · ${qSnippet.replace(/\s+/g, ' ').slice(0, 56)}${qSnippet.length > 56 ? '…' : ''}`
                        : null}
                    </p>
                    <p className="mt-0.5 text-slate-500 dark:text-neutral-500">{formatLevels(link)}</p>
                  </div>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => void onRemove(outcome.id, link.id)}
                    className="shrink-0 rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-50 dark:hover:bg-rose-950/50 dark:hover:text-rose-300"
                    aria-label="Remove outcome link"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
                )
              })}
            </ul>
          )}

          <form onSubmit={onAdd} className="space-y-2 border-t border-slate-100 pt-2 dark:border-neutral-800/80">
            <div>
              <label className="mb-0.5 block text-[11px] font-medium text-slate-500 dark:text-neutral-400">
                Outcome
              </label>
              <select
                value={outcomeId}
                onChange={(e) => setOutcomeId(e.target.value)}
                disabled={disabled || adding}
                className={inputClass}
              >
                <option value="">Select outcome…</option>
                {outcomes.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.title}
                  </option>
                ))}
              </select>
            </div>

            {mode === 'quiz' ? (
              <fieldset className="space-y-1.5">
                <legend className="text-[11px] font-medium text-slate-500 dark:text-neutral-400">Map</legend>
                <div className="flex flex-wrap gap-3 text-[11px]">
                  <label className="inline-flex items-center gap-1.5">
                    <input
                      type="radio"
                      name={`item-outcome-scope-${itemId}`}
                      checked={quizScope === 'whole'}
                      onChange={() => setQuizScope('whole')}
                      disabled={disabled || adding}
                    />
                    Whole quiz
                  </label>
                  <label className="inline-flex items-center gap-1.5">
                    <input
                      type="radio"
                      name={`item-outcome-scope-${itemId}`}
                      checked={quizScope === 'question'}
                      onChange={() => setQuizScope('question')}
                      disabled={disabled || adding}
                    />
                    One question
                  </label>
                </div>
                {quizScope === 'question' ? (
                  <div>
                    <label className="mb-0.5 block text-[11px] font-medium text-slate-500 dark:text-neutral-400">
                      Question
                    </label>
                    {quizQuestions.length === 0 ? (
                      <p className="text-[11px] text-slate-500 dark:text-neutral-500">
                        Add questions in the quiz editor to map a single question.
                      </p>
                    ) : (
                      <select
                        value={questionId}
                        onChange={(e) => setQuestionId(e.target.value)}
                        disabled={disabled || adding}
                        className={inputClass}
                      >
                        {quizQuestions.map((q) => (
                          <option key={q.id} value={q.id}>
                            {(q.prompt || q.id).replace(/\s+/g, ' ').slice(0, 72)}
                            {(q.prompt || '').length > 72 ? '…' : ''}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                ) : null}
              </fieldset>
            ) : null}

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-0.5 block text-[11px] font-medium text-slate-500 dark:text-neutral-400">
                  Measurement
                </label>
                <select
                  value={measurementLevel}
                  onChange={(e) => setMeasurementLevel(e.target.value)}
                  disabled={disabled || adding}
                  className={inputClass}
                >
                  {OUTCOME_MEASUREMENT_LEVEL_IDS.map((id) => (
                    <option key={id} value={id}>
                      {MEASUREMENT_LABELS[id] ?? id}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-0.5 block text-[11px] font-medium text-slate-500 dark:text-neutral-400">
                  Intensity
                </label>
                <select
                  value={intensityLevel}
                  onChange={(e) => setIntensityLevel(e.target.value)}
                  disabled={disabled || adding}
                  className={inputClass}
                >
                  {OUTCOME_INTENSITY_LEVEL_IDS.map((id) => (
                    <option key={id} value={id}>
                      {INTENSITY_LABELS[id] ?? id}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <button
              type="submit"
              disabled={disabled || adding || !outcomeId || outcomes.length === 0}
              className="w-full rounded-lg bg-indigo-600 px-2 py-1.5 text-[12px] font-semibold text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {adding ? 'Adding…' : 'Add mapping'}
            </button>
            {outcomes.length === 0 ? (
              <p className="text-[11px] text-slate-500 dark:text-neutral-500">
                Create outcomes under Course Settings → Outcomes first.
              </p>
            ) : null}
          </form>
        </>
      )}
    </div>
  )
}
