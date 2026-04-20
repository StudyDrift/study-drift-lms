import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ChevronDown,
  Link2,
  Loader2,
  Plus,
  Target,
  Trash2,
  TrendingUp,
} from 'lucide-react'
import { usePermissions } from '../../context/use-permissions'
import {
  addCourseOutcomeLink,
  courseItemCreatePermission,
  createCourseOutcome,
  deleteCourseOutcome,
  deleteCourseOutcomeLink,
  fetchCourseOutcomes,
  fetchCourseStructure,
  fetchModuleQuiz,
  patchCourseOutcome,
  OUTCOME_INTENSITY_LEVEL_IDS,
  OUTCOME_MEASUREMENT_LEVEL_IDS,
  type CourseOutcome,
  type CourseOutcomeLink,
  type CourseStructureItem,
} from '../../lib/courses-api'

type GradableOption = {
  id: string
  label: string
  kind: 'assignment' | 'quiz'
}

function gradableOptionsFromStructure(items: CourseStructureItem[]): GradableOption[] {
  const byId = new Map(items.map((i) => [i.id, i]))
  const rows = items.filter(
    (i) => (i.kind === 'assignment' || i.kind === 'quiz') && !i.archived,
  )
  const withLabels: GradableOption[] = rows.map((i) => {
    let modTitle = ''
    let p: CourseStructureItem | undefined = i.parentId ? byId.get(i.parentId) : undefined
    const guard = new Set<string>()
    while (p && !guard.has(p.id)) {
      guard.add(p.id)
      if (p.kind === 'module') {
        modTitle = p.title
        break
      }
      p = p.parentId ? byId.get(p.parentId) : undefined
    }
    const label = modTitle ? `${modTitle} — ${i.title}` : i.title
    const kind = i.kind === 'assignment' ? 'assignment' : 'quiz'
    return { id: i.id, label, kind }
  })
  withLabels.sort((a, b) => a.label.localeCompare(b.label))
  return withLabels
}

function progressLabel(link: CourseOutcomeLink): string {
  const { progress } = link
  const pct =
    progress.avgScorePercent != null && Number.isFinite(progress.avgScorePercent)
      ? `${Math.round(progress.avgScorePercent)}%`
      : '—'
  return `Class avg ${pct} · ${progress.gradedLearners}/${progress.enrolledLearners} learners with scores`
}

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

const MEASUREMENT_HINTS: Record<string, string> = {
  diagnostic: 'Check prior knowledge before instruction.',
  formative: 'Practice and feedback during the unit.',
  summative: 'End-of-unit or final demonstration of mastery.',
  performance: 'Apply skills in realistic or novel contexts.',
}

const INTENSITY_HINTS: Record<string, string> = {
  low: 'This item lightly signals progress toward the outcome.',
  medium: 'Meaningful signal, balanced with other evidence.',
  high: 'This item is a strong indicator for this outcome.',
}

function formatOutcomeLevels(link: CourseOutcomeLink): string {
  const m = MEASUREMENT_LABELS[link.measurementLevel] ?? link.measurementLevel
  const i = INTENSITY_LABELS[link.intensityLevel] ?? link.intensityLevel
  return `${m} · ${i}`
}

function linkSummary(link: CourseOutcomeLink): string {
  const levels = formatOutcomeLevels(link)
  if (link.targetKind === 'quiz_question') {
    return `${link.itemTitle} (question) · ${levels}`
  }
  if (link.targetKind === 'quiz') {
    return `${link.itemTitle} (whole quiz) · ${levels}`
  }
  return `${link.itemTitle} · ${levels}`
}

export function CourseOutcomesSection({ courseCode }: { courseCode: string }) {
  const { allows, loading: permLoading } = usePermissions()
  const canEdit = !permLoading && allows(courseItemCreatePermission(courseCode))

  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [outcomes, setOutcomes] = useState<CourseOutcome[]>([])
  const [enrolledLearners, setEnrolledLearners] = useState(0)
  const [structure, setStructure] = useState<CourseStructureItem[]>([])

  const [newTitle, setNewTitle] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [creating, setCreating] = useState(false)

  const gradableOptions = useMemo(() => gradableOptionsFromStructure(structure), [structure])

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const [o, s] = await Promise.all([
        fetchCourseOutcomes(courseCode),
        fetchCourseStructure(courseCode),
      ])
      setOutcomes(o.outcomes)
      setEnrolledLearners(o.enrolledLearners)
      setStructure(s)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not load outcomes.')
    } finally {
      setLoading(false)
    }
  }, [courseCode])

  useEffect(() => {
    void load()
  }, [load])

  async function onCreateOutcome(e: React.FormEvent) {
    e.preventDefault()
    const t = newTitle.trim()
    if (!t || creating) return
    setCreating(true)
    setLoadError(null)
    try {
      const row = await createCourseOutcome(courseCode, {
        title: t,
        description: newDescription.trim(),
      })
      setOutcomes((prev) => [...prev, row])
      setNewTitle('')
      setNewDescription('')
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not create outcome.')
    } finally {
      setCreating(false)
    }
  }

  async function onDeleteOutcome(id: string) {
    if (!window.confirm('Delete this outcome and all of its mappings?')) return
    setLoadError(null)
    try {
      await deleteCourseOutcome(courseCode, id)
      setOutcomes((prev) => prev.filter((o) => o.id !== id))
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not delete outcome.')
    }
  }

  async function onSaveOutcomeMeta(o: CourseOutcome, title: string, description: string) {
    setLoadError(null)
    try {
      const updated = await patchCourseOutcome(courseCode, o.id, { title, description })
      setOutcomes((prev) => prev.map((x) => (x.id === o.id ? updated : x)))
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not save outcome.')
    }
  }

  if (!canEdit) {
    return (
      <p className="text-sm text-slate-600 dark:text-neutral-400">
        You do not have permission to manage course outcomes.
      </p>
    )
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-900/5 dark:border-neutral-800 dark:bg-neutral-950">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 dark:bg-indigo-950/50">
              <Target className="h-5 w-5 text-indigo-600 dark:text-indigo-400" aria-hidden />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-slate-900 dark:text-neutral-100">
                Learning outcomes
              </h2>
              <p className="mt-1 text-sm text-slate-600 dark:text-neutral-400">
                State what learners should demonstrate, then connect graded assignments or quiz items so
                you can see class-level progress on each goal.
              </p>
              <ol className="mt-3 space-y-1.5 text-sm text-slate-700 dark:text-neutral-300">
                <li className="flex gap-2">
                  <span className="font-semibold text-indigo-600 dark:text-indigo-400">1.</span>
                  <span>Add an outcome (title and optional description).</span>
                </li>
                <li className="flex gap-2">
                  <span className="font-semibold text-indigo-600 dark:text-indigo-400">2.</span>
                  <span>Under that outcome, link module assignments or quizzes (whole quiz or one question).</span>
                </li>
                <li className="flex gap-2">
                  <span className="font-semibold text-indigo-600 dark:text-indigo-400">3.</span>
                  <span>Pick measurement type and emphasis so duplicate links to the same item stay meaningful.</span>
                </li>
              </ol>
            </div>
          </div>
        </div>

        <details className="group mt-4 border-t border-slate-100 pt-4 dark:border-neutral-800">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium text-indigo-700 outline-none hover:text-indigo-600 dark:text-indigo-300 dark:hover:text-indigo-200 [&::-webkit-details-marker]:hidden">
            <ChevronDown
              className="h-4 w-4 shrink-0 text-indigo-500 transition group-open:rotate-180 dark:text-indigo-400"
              aria-hidden
            />
            How scores roll up into outcome progress
          </summary>
          <div className="mt-3 space-y-2 text-sm text-slate-600 dark:text-neutral-400">
            <p>
              You can attach the same assignment or quiz question to more than one outcome, or attach
              several different items to a single outcome. Each link should describe a distinct role using
              measurement level (for example formative versus summative) and intensity.
            </p>
            <p>
              Class progress uses gradebook scores for whole assignments and whole quizzes, and each
              learner’s latest submitted attempt for individual mapped questions.
            </p>
            <p>
              When several links point at the same underlying item, the rollup average counts that item
              only once so overlapping links do not inflate the percentage.
            </p>
          </div>
        </details>
      </section>

      {loadError && (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-200">
          {loadError}
        </p>
      )}

      {loading && (
        <p className="flex items-center gap-2 text-sm text-slate-500 dark:text-neutral-400">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Loading outcomes…
        </p>
      )}

      {!loading && (
        <>
          {outcomes.length > 0 && (
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-neutral-100">
                  Course outcomes
                </h3>
                <p className="mt-0.5 text-sm text-slate-500 dark:text-neutral-400">
                  {outcomes.length} outcome{outcomes.length === 1 ? '' : 's'} — expand each card to edit
                  details or add linked work.
                </p>
              </div>
            </div>
          )}

          <div className="space-y-6">
            {outcomes.map((o) => (
              <OutcomeCard
                key={o.id}
                courseCode={courseCode}
                outcome={o}
                enrolledLearners={enrolledLearners}
                gradableOptions={gradableOptions}
                onDelete={() => void onDeleteOutcome(o.id)}
                onSaveMeta={(title, description) => void onSaveOutcomeMeta(o, title, description)}
                onLinksChanged={() => void load()}
              />
            ))}
          </div>

          {outcomes.length === 0 ? (
            <form
              onSubmit={onCreateOutcome}
              className="rounded-2xl border border-dashed border-indigo-200 bg-indigo-50/40 p-5 dark:border-indigo-900/50 dark:bg-indigo-950/20"
            >
              <h3 className="text-sm font-semibold text-slate-900 dark:text-neutral-100">
                Add your first outcome
              </h3>
              <p className="mt-1 text-sm text-slate-600 dark:text-neutral-400">
                Start with a short, learner-facing title. You can link graded work after it is saved.
              </p>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <label className="block sm:col-span-2">
                  <span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-neutral-300">
                    Title
                  </span>
                  <input
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none ring-indigo-500/20 focus:border-indigo-400 focus:ring-2 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                    placeholder="e.g. Analyze primary sources"
                  />
                </label>
                <label className="block sm:col-span-2">
                  <span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-neutral-300">
                    Description (optional)
                  </span>
                  <textarea
                    value={newDescription}
                    onChange={(e) => setNewDescription(e.target.value)}
                    rows={3}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none ring-indigo-500/20 focus:border-indigo-400 focus:ring-2 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                    placeholder="What should learners be able to do?"
                  />
                </label>
              </div>
              <div className="mt-4">
                <button
                  type="submit"
                  disabled={creating || !newTitle.trim()}
                  className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Plus className="h-4 w-4" aria-hidden />
                  {creating ? 'Adding…' : 'Create outcome'}
                </button>
              </div>
            </form>
          ) : (
            <details className="group rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-neutral-800 dark:bg-neutral-950">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-2xl px-5 py-4 text-sm font-semibold text-slate-900 outline-none ring-indigo-500/0 transition hover:bg-slate-50/80 dark:text-neutral-100 dark:hover:bg-neutral-900/60 [&::-webkit-details-marker]:hidden">
                <span className="inline-flex items-center gap-2">
                  <Plus className="h-4 w-4 text-indigo-600 dark:text-indigo-400" aria-hidden />
                  Add another outcome
                </span>
                <ChevronDown
                  className="h-4 w-4 shrink-0 text-slate-400 transition group-open:rotate-180 dark:text-neutral-500"
                  aria-hidden
                />
              </summary>
              <form
                onSubmit={onCreateOutcome}
                className="border-t border-slate-100 px-5 pb-5 pt-4 dark:border-neutral-800"
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block sm:col-span-2">
                    <span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-neutral-300">
                      Title
                    </span>
                    <input
                      value={newTitle}
                      onChange={(e) => setNewTitle(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none ring-indigo-500/20 focus:border-indigo-400 focus:ring-2 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                      placeholder="e.g. Analyze primary sources"
                    />
                  </label>
                  <label className="block sm:col-span-2">
                    <span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-neutral-300">
                      Description (optional)
                    </span>
                    <textarea
                      value={newDescription}
                      onChange={(e) => setNewDescription(e.target.value)}
                      rows={3}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none ring-indigo-500/20 focus:border-indigo-400 focus:ring-2 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                      placeholder="What should learners be able to do?"
                    />
                  </label>
                </div>
                <div className="mt-4">
                  <button
                    type="submit"
                    disabled={creating || !newTitle.trim()}
                    className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <Plus className="h-4 w-4" aria-hidden />
                    {creating ? 'Adding…' : 'Create outcome'}
                  </button>
                </div>
              </form>
            </details>
          )}
        </>
      )}
    </div>
  )
}

function OutcomeCard({
  courseCode,
  outcome,
  enrolledLearners,
  gradableOptions,
  onDelete,
  onSaveMeta,
  onLinksChanged,
}: {
  courseCode: string
  outcome: CourseOutcome
  enrolledLearners: number
  gradableOptions: GradableOption[]
  onDelete: () => void
  onSaveMeta: (title: string, description: string) => void
  onLinksChanged: () => void
}) {
  const [titleDraft, setTitleDraft] = useState(outcome.title)
  const [descDraft, setDescDraft] = useState(outcome.description)
  const [savingMeta, setSavingMeta] = useState(false)

  const [itemId, setItemId] = useState('')
  const [quizScope, setQuizScope] = useState<'whole' | 'question'>('whole')
  const [questionId, setQuestionId] = useState('')
  const [quizQuestions, setQuizQuestions] = useState<{ id: string; prompt: string }[]>([])
  const [loadingQuiz, setLoadingQuiz] = useState(false)
  const [addingLink, setAddingLink] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const [measurementLevel, setMeasurementLevel] = useState<string>('formative')
  const [intensityLevel, setIntensityLevel] = useState<string>('medium')

  useEffect(() => {
    setTitleDraft(outcome.title)
    setDescDraft(outcome.description)
  }, [outcome.title, outcome.description])

  const selectedGradable = gradableOptions.find((g) => g.id === itemId)

  useEffect(() => {
    if (!itemId || selectedGradable?.kind !== 'quiz') {
      setQuizQuestions([])
      setQuestionId('')
      return
    }
    let cancelled = false
    setLoadingQuiz(true)
    void fetchModuleQuiz(courseCode, itemId)
      .then((q) => {
        if (cancelled) return
        const qs = (q.questions ?? []).map((x) => ({
          id: x.id,
          prompt: x.prompt.replace(/\s+/g, ' ').slice(0, 120) + (x.prompt.length > 120 ? '…' : ''),
        }))
        setQuizQuestions(qs)
        setQuestionId((cur) => (qs.some((x) => x.id === cur) ? cur : qs[0]?.id ?? ''))
      })
      .catch(() => {
        if (!cancelled) setQuizQuestions([])
      })
      .finally(() => {
        if (!cancelled) setLoadingQuiz(false)
      })
    return () => {
      cancelled = true
    }
  }, [courseCode, itemId, selectedGradable?.kind])

  async function onAddLink(e: React.FormEvent) {
    e.preventDefault()
    setLocalError(null)
    if (!itemId || !selectedGradable) {
      setLocalError('Choose an assignment or quiz.')
      return
    }
    const targetKind =
      selectedGradable.kind === 'assignment'
        ? 'assignment'
        : quizScope === 'whole'
          ? 'quiz'
          : 'quiz_question'
    if (targetKind === 'quiz_question' && !questionId.trim()) {
      setLocalError('Pick a question for this quiz.')
      return
    }
    setAddingLink(true)
    try {
      await addCourseOutcomeLink(courseCode, outcome.id, {
        structureItemId: itemId,
        targetKind,
        quizQuestionId: targetKind === 'quiz_question' ? questionId.trim() : undefined,
        measurementLevel,
        intensityLevel,
      })
      setItemId('')
      setQuizScope('whole')
      setQuestionId('')
      setMeasurementLevel('formative')
      setIntensityLevel('medium')
      onLinksChanged()
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Could not add mapping.')
    } finally {
      setAddingLink(false)
    }
  }

  async function onRemoveLink(linkId: string) {
    setLocalError(null)
    try {
      await deleteCourseOutcomeLink(courseCode, outcome.id, linkId)
      onLinksChanged()
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Could not remove mapping.')
    }
  }

  async function saveMeta() {
    setSavingMeta(true)
    setLocalError(null)
    try {
      onSaveMeta(titleDraft.trim(), descDraft)
    } finally {
      setSavingMeta(false)
    }
  }

  const rollup = outcome.rollupAvgScorePercent

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-neutral-800 dark:bg-neutral-950">
      <div className="border-b border-slate-100 bg-slate-50/60 px-5 py-4 dark:border-neutral-800 dark:bg-neutral-900/40">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-1 items-start gap-2.5">
            <Target
              className="mt-0.5 h-4 w-4 shrink-0 text-indigo-600 dark:text-indigo-400"
              aria-hidden
            />
            <div className="min-w-0 flex-1 space-y-3">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-600 dark:text-neutral-400">
                  Outcome title
                </span>
                <input
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-600 dark:text-neutral-400">
                  Description
                </span>
                <textarea
                  value={descDraft}
                  onChange={(e) => setDescDraft(e.target.value)}
                  rows={2}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                />
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void saveMeta()}
                  disabled={savingMeta || !titleDraft.trim()}
                  className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {savingMeta ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onDelete}
            className="inline-flex items-center gap-1 rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-800 hover:bg-rose-50 dark:border-rose-900/60 dark:text-rose-200 dark:hover:bg-rose-950/50"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
            Delete outcome
          </button>
        </div>
      </div>

      <div className="px-5 py-4">
        <div className="flex items-start gap-2.5">
          <TrendingUp
            className="mt-0.5 h-4 w-4 shrink-0 text-slate-400 dark:text-neutral-500"
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-neutral-500">
              Class progress
            </p>
            <p className="mt-1 text-sm text-slate-800 dark:text-neutral-200">
              {rollup != null && Number.isFinite(rollup) ? (
                <>
                  Combined average from linked graded work (each assignment or question counted once):{' '}
                  <span className="font-semibold text-indigo-700 dark:text-indigo-300">
                    {Math.round(rollup)}%
                  </span>
                </>
              ) : (
                <span className="text-slate-600 dark:text-neutral-400">
                  Link at least one graded assignment or quiz below. Enrolled learners: {enrolledLearners}.
                </span>
              )}
            </p>
            {outcome.links.length > 0 && rollup != null && Number.isFinite(rollup) && (
              <div
                className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-neutral-800"
                role="progressbar"
                aria-valuenow={Math.round(rollup)}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Outcome progress"
              >
                <div
                  className="h-full rounded-full bg-indigo-600 transition-all dark:bg-indigo-500"
                  style={{ width: `${Math.min(100, Math.max(0, rollup))}%` }}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="border-t border-slate-100 px-5 py-4 dark:border-neutral-800">
        <div className="flex items-center gap-2">
          <Link2 className="h-4 w-4 text-slate-400 dark:text-neutral-500" aria-hidden />
          <h4 className="text-sm font-semibold text-slate-900 dark:text-neutral-100">
            Linked graded work
          </h4>
          {outcome.links.length > 0 && (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-neutral-800 dark:text-neutral-400">
              {outcome.links.length}
            </span>
          )}
        </div>
        <p className="mt-1 text-xs text-slate-500 dark:text-neutral-500">
          Tie this outcome to a module assignment or quiz. For quizzes, use the whole score or pick one
          question.
        </p>
        {localError && (
          <p className="mt-2 text-sm text-rose-700 dark:text-rose-300">{localError}</p>
        )}
        {outcome.links.length === 0 ? (
          <p className="mt-3 rounded-xl border border-dashed border-slate-200 bg-slate-50/50 px-3 py-3 text-sm text-slate-600 dark:border-neutral-700 dark:bg-neutral-900/30 dark:text-neutral-400">
            No links yet — use the form below to connect evidence.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {outcome.links.map((link) => (
              <li
                key={link.id}
                className="flex flex-wrap items-start justify-between gap-2 rounded-xl border border-slate-100 bg-slate-50/40 px-3 py-2.5 text-sm dark:border-neutral-800 dark:bg-neutral-900/40"
              >
                <div className="min-w-0">
                  <p className="font-medium text-slate-900 dark:text-neutral-100">{linkSummary(link)}</p>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-neutral-500">{progressLabel(link)}</p>
                </div>
                <button
                  type="button"
                  onClick={() => void onRemoveLink(link.id)}
                  className="shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-700 dark:hover:bg-rose-950/40 dark:hover:text-rose-300"
                  aria-label="Remove link"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <form
          onSubmit={onAddLink}
          className="mt-4 rounded-xl border border-slate-100 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950"
        >
          <p className="text-xs font-semibold text-slate-700 dark:text-neutral-300">Add a link</p>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-xs font-medium text-slate-600 dark:text-neutral-400">
                Module assignment or quiz
              </span>
              <select
                value={itemId}
                onChange={(e) => {
                  setItemId(e.target.value)
                  setQuizScope('whole')
                }}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
              >
                <option value="">Choose from the course…</option>
                {gradableOptions.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.kind === 'quiz' ? 'Quiz: ' : 'Assignment: '}
                    {g.label}
                  </option>
                ))}
              </select>
            </label>

            {selectedGradable?.kind === 'quiz' && (
              <>
                <fieldset className="sm:col-span-2">
                  <legend className="mb-1.5 text-xs font-medium text-slate-600 dark:text-neutral-400">
                    What to measure (this quiz)
                  </legend>
                  <div className="flex flex-wrap gap-4 text-sm">
                    <label className="inline-flex cursor-pointer items-center gap-2">
                      <input
                        type="radio"
                        name={`scope-${outcome.id}`}
                        checked={quizScope === 'whole'}
                        onChange={() => setQuizScope('whole')}
                      />
                      Whole quiz (gradebook score)
                    </label>
                    <label className="inline-flex cursor-pointer items-center gap-2">
                      <input
                        type="radio"
                        name={`scope-${outcome.id}`}
                        checked={quizScope === 'question'}
                        onChange={() => setQuizScope('question')}
                      />
                      Single question
                    </label>
                  </div>
                </fieldset>
                {quizScope === 'question' && (
                  <label className="block sm:col-span-2">
                    <span className="mb-1 block text-xs font-medium text-slate-600 dark:text-neutral-400">
                      Question
                    </span>
                    {loadingQuiz ? (
                      <p className="text-xs text-slate-500">Loading questions…</p>
                    ) : (
                      <select
                        value={questionId}
                        onChange={(e) => setQuestionId(e.target.value)}
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                      >
                        {quizQuestions.length === 0 ? (
                          <option value="">No questions found</option>
                        ) : (
                          quizQuestions.map((q) => (
                            <option key={q.id} value={q.id}>
                              {q.prompt || q.id}
                            </option>
                          ))
                        )}
                      </select>
                    )}
                  </label>
                )}
              </>
            )}

            <label className="block sm:col-span-2 sm:col-start-1 sm:max-w-md">
              <span className="mb-1 block text-xs font-medium text-slate-600 dark:text-neutral-400">
                Measurement role
              </span>
              <select
                value={measurementLevel}
                onChange={(e) => setMeasurementLevel(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
              >
                {OUTCOME_MEASUREMENT_LEVEL_IDS.map((id) => (
                  <option key={id} value={id}>
                    {MEASUREMENT_LABELS[id] ?? id}
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-xs text-slate-500 dark:text-neutral-500">
                {MEASUREMENT_HINTS[measurementLevel] ??
                  'Describes how this item functions for the outcome.'}
              </span>
            </label>
            <label className="block sm:col-span-2 sm:col-start-1 sm:max-w-md">
              <span className="mb-1 block text-xs font-medium text-slate-600 dark:text-neutral-400">
                Emphasis
              </span>
              <select
                value={intensityLevel}
                onChange={(e) => setIntensityLevel(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
              >
                {OUTCOME_INTENSITY_LEVEL_IDS.map((id) => (
                  <option key={id} value={id}>
                    {INTENSITY_LABELS[id] ?? id}
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-xs text-slate-500 dark:text-neutral-500">
                {INTENSITY_HINTS[intensityLevel] ?? 'How strongly this item signals the outcome.'}
              </span>
            </label>

            <div className="sm:col-span-2">
              <button
                type="submit"
                disabled={addingLink || !itemId}
                className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Link2 className="h-4 w-4" aria-hidden />
                {addingLink ? 'Adding…' : 'Add link'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </section>
  )
}
