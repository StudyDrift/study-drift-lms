import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react'
import { Library } from 'lucide-react'
import { useParams, useSearchParams } from 'react-router-dom'
import { EmptyState } from '../../components/ui/empty-state'
import { usePermissions } from '../../context/use-permissions'
import {
  createCourseMisconception,
  createCourseQuestion,
  courseItemsCreatePermission,
  fetchCourse,
  fetchCourseMisconceptions,
  fetchCourseQuestion,
  fetchCourseQuestions,
  fetchCourseQuestionVersions,
  putQuestionOptionMisconception,
  restoreCourseQuestionVersion,
  updateCourseQuestion,
  type BankQuestionDetail,
  type BankQuestionRow,
  type BankQuestionVersionSummary,
  type CourseMisconceptionRow,
  type CreateBankQuestionBody,
  type UpdateBankQuestionBody,
} from '../../lib/courses-api'
import { QuestionBankStatusChip } from '../../components/ui/status-vocabulary'
import { toastMutationError, toastSaveOk } from '../../lib/lms-toast'
import { FeatureHelpTrigger } from '../../components/feature-help/feature-help-trigger'
import { LmsPage } from './lms-page'

type QuestionDraft = {
  questionType: string
  stem: string
  status: 'draft' | 'active' | 'retired'
  points: string
  explanation: string
  optionsJson: string
  correctAnswerJson: string
  changeNote: string
  /** When true, server keeps authored option order for this item (maps to shuffleChoicesOverride: false). */
  lockAnswerOrder: boolean
  /** Include in spaced-repetition review when the course enables SRS. */
  srsEligible: boolean
}

const QUESTION_TYPE_OPTIONS = [
  { value: 'mc_single', label: 'Multiple choice (single)' },
  { value: 'mc_multiple', label: 'Multiple choice (multiple)' },
  { value: 'true_false', label: 'True / false' },
  { value: 'short_answer', label: 'Short answer' },
  { value: 'numeric', label: 'Numeric' },
  { value: 'matching', label: 'Matching' },
  { value: 'ordering', label: 'Ordering' },
  { value: 'hotspot', label: 'Hotspot' },
  { value: 'formula', label: 'Formula' },
  { value: 'code', label: 'Code' },
  { value: 'file_upload', label: 'File upload' },
  { value: 'audio_response', label: 'Audio response' },
  { value: 'video_response', label: 'Video response' },
]

function defaultDraft(): QuestionDraft {
  return {
    questionType: 'mc_single',
    stem: '',
    status: 'draft',
    points: '1',
    explanation: '',
    optionsJson: '',
    correctAnswerJson: '',
    changeNote: '',
    lockAnswerOrder: false,
    srsEligible: false,
  }
}

function questionTypeSupportsChoiceShuffle(t: string): boolean {
  return t === 'mc_single' || t === 'mc_multiple' || t === 'true_false'
}

type ParsedMcChoice = { id: string | null; text: string }

function parseMcChoicesFromOptionsJson(
  questionType: string,
  optionsJson: string,
): ParsedMcChoice[] | null {
  if (!questionTypeSupportsChoiceShuffle(questionType)) return null
  const trimmed = optionsJson.trim()
  if (!trimmed) return []
  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (!Array.isArray(parsed)) return null
    const out: ParsedMcChoice[] = []
    for (const el of parsed) {
      if (typeof el === 'string') {
        out.push({ id: null, text: el })
        continue
      }
      if (el && typeof el === 'object') {
        const o = el as Record<string, unknown>
        const textRaw = o.text ?? o.label
        const text = typeof textRaw === 'string' ? textRaw : String(textRaw ?? '')
        const idRaw = o.id
        const id = typeof idRaw === 'string' && idRaw.length > 0 ? idRaw : null
        out.push({ id, text })
      }
    }
    return out
  } catch {
    return null
  }
}

function parseOptionalJson(raw: string, fieldLabel: string): unknown | undefined {
  const trimmed = raw.trim()
  if (!trimmed) return undefined
  try {
    return JSON.parse(trimmed) as unknown
  } catch {
    throw new Error(`${fieldLabel} must be valid JSON.`)
  }
}

function toCreatePayload(draft: QuestionDraft): CreateBankQuestionBody {
  const stem = draft.stem.trim()
  if (!stem) throw new Error('Stem is required.')
  const points = Number.parseFloat(draft.points)
  if (!Number.isFinite(points) || points < 0) {
    throw new Error('Points must be a number greater than or equal to 0.')
  }
  return {
    questionType: draft.questionType,
    stem,
    status: draft.status,
    points,
    explanation: draft.explanation.trim() || undefined,
    options: parseOptionalJson(draft.optionsJson, 'Options'),
    correctAnswer: parseOptionalJson(draft.correctAnswerJson, 'Correct answer'),
    shuffleChoicesOverride: draft.lockAnswerOrder ? false : undefined,
    srsEligible: draft.srsEligible || undefined,
  }
}

function toUpdatePayload(draft: QuestionDraft): UpdateBankQuestionBody {
  const base = toCreatePayload(draft)
  return {
    questionType: base.questionType,
    stem: base.stem,
    status: base.status,
    points: base.points,
    explanation: base.explanation ?? null,
    options: base.options ?? null,
    correctAnswer: base.correctAnswer ?? null,
    changeNote: draft.changeNote.trim() || undefined,
    shuffleChoicesOverride: draft.lockAnswerOrder ? false : null,
    srsEligible: draft.srsEligible,
  }
}

function draftFromDetail(detail: BankQuestionDetail): QuestionDraft {
  return {
    questionType: detail.questionType || 'mc_single',
    stem: detail.stem || '',
    status:
      detail.status === 'active' || detail.status === 'retired' || detail.status === 'draft'
        ? detail.status
        : 'draft',
    points: String(detail.points ?? 1),
    explanation: detail.explanation ?? '',
    optionsJson: detail.options == null ? '' : JSON.stringify(detail.options, null, 2),
    correctAnswerJson: detail.correctAnswer == null ? '' : JSON.stringify(detail.correctAnswer, null, 2),
    changeNote: '',
    lockAnswerOrder: detail.shuffleChoicesOverride === false,
    srsEligible: detail.srsEligible === true,
  }
}

export function CourseQuestionBankPage() {
  const { courseCode = '' } = useParams<{ courseCode: string }>()
  const [searchParams] = useSearchParams()
  const questionFromUrl = searchParams.get('question')?.trim() || null
  const openedQuestionFromUrl = useRef<string | null>(null)
  const searchId = useId()
  const stemFieldId = `${searchId}-stem`
  const { allows, loading: permLoading } = usePermissions()
  const canEdit = !permLoading && allows(courseItemsCreatePermission(courseCode))

  const [rows, setRows] = useState<BankQuestionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [bankOn, setBankOn] = useState(false)
  const [misconceptionCourseFlag, setMisconceptionCourseFlag] = useState(false)
  const [editDetail, setEditDetail] = useState<BankQuestionDetail | null>(null)
  const [mcList, setMcList] = useState<CourseMisconceptionRow[]>([])
  const [mcListLoading, setMcListLoading] = useState(false)
  const [mcTagBusyOptionId, setMcTagBusyOptionId] = useState<string | null>(null)
  const [newMcName, setNewMcName] = useState('')
  const [newMcBody, setNewMcBody] = useState('')
  const [newMcBusy, setNewMcBusy] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [draft, setDraft] = useState<QuestionDraft>(() => defaultDraft())
  const [busy, setBusy] = useState(false)
  const [modalError, setModalError] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewQuestion, setPreviewQuestion] = useState<BankQuestionDetail | null>(null)
  const [historyId, setHistoryId] = useState<string | null>(null)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyRows, setHistoryRows] = useState<BankQuestionVersionSummary[]>([])

  const load = useCallback(async () => {
    if (!courseCode) return
    setLoading(true)
    setError(null)
    try {
      const course = await fetchCourse(courseCode)
      setBankOn(course.questionBankEnabled === true)
      setMisconceptionCourseFlag(course.misconceptionDetectionEnabled === true)
      if (course.questionBankEnabled !== true) {
        setRows([])
        return
      }
      const data = await fetchCourseQuestions(courseCode, { q: q.trim() || undefined })
      setRows(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load questions.')
    } finally {
      setLoading(false)
    }
  }, [courseCode, q])

  const loadQuestionForEdit = useCallback(
    async (questionId: string, mode: 'edit' | 'preview') => {
      if (!courseCode) return
      setModalError(null)
      setPreviewLoading(true)
      try {
        const detail = await fetchCourseQuestion(courseCode, questionId)
        setPreviewQuestion(detail)
        if (mode === 'edit') {
          setDraft(draftFromDetail(detail))
          setEditDetail(detail)
          setEditId(questionId)
          setCreateOpen(false)
        } else {
          setEditDetail(null)
          setPreviewId(questionId)
        }
      } catch (e) {
        setModalError(e instanceof Error ? e.message : 'Could not load question details.')
      } finally {
        setPreviewLoading(false)
      }
    },
    [courseCode],
  )

  const submitCreate = useCallback(async () => {
    if (!courseCode) return
    setModalError(null)
    setBusy(true)
    try {
      await createCourseQuestion(courseCode, toCreatePayload(draft))
      setCreateOpen(false)
      setDraft(defaultDraft())
      await load()
      toastSaveOk('Question created')
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not create question.'
      setModalError(msg)
      toastMutationError(msg)
    } finally {
      setBusy(false)
    }
  }, [courseCode, draft, load])

  const submitEdit = useCallback(async () => {
    if (!courseCode || !editId) return
    setModalError(null)
    setBusy(true)
    try {
      const updated = await updateCourseQuestion(courseCode, editId, toUpdatePayload(draft))
      setPreviewQuestion(updated)
      setEditDetail(updated)
      setDraft(draftFromDetail(updated))
      await load()
      toastSaveOk('Question updated')
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not update question.'
      setModalError(msg)
      toastMutationError(msg)
    } finally {
      setBusy(false)
    }
  }, [courseCode, draft, editId, load])

  const openHistory = useCallback(
    async (questionId: string) => {
      if (!courseCode) return
      setHistoryId(questionId)
      setHistoryLoading(true)
      setModalError(null)
      try {
        const versions = await fetchCourseQuestionVersions(courseCode, questionId)
        setHistoryRows(versions)
      } catch (e) {
        setModalError(e instanceof Error ? e.message : 'Could not load version history.')
      } finally {
        setHistoryLoading(false)
      }
    },
    [courseCode],
  )

  const restoreVersion = useCallback(
    async (versionNumber: number) => {
      if (!courseCode || !historyId) return
      setBusy(true)
      setModalError(null)
      try {
        await restoreCourseQuestionVersion(courseCode, historyId, versionNumber)
        await openHistory(historyId)
        await load()
        toastSaveOk('Version restored')
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Could not restore version.'
        setModalError(msg)
        toastMutationError(msg)
      } finally {
        setBusy(false)
      }
    },
    [courseCode, historyId, load, openHistory],
  )

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!questionFromUrl || !bankOn || !canEdit) return
    if (openedQuestionFromUrl.current === questionFromUrl) return
    openedQuestionFromUrl.current = questionFromUrl
    void loadQuestionForEdit(questionFromUrl, 'edit')
  }, [questionFromUrl, bankOn, canEdit, loadQuestionForEdit])

  const previewJson = useMemo(() => {
    if (!previewQuestion) return null
    return JSON.stringify(
      {
        options: previewQuestion.options ?? null,
        correctAnswer: previewQuestion.correctAnswer ?? null,
        metadata: previewQuestion.metadata ?? null,
      },
      null,
      2,
    )
  }, [previewQuestion])

  const parsedMcChoices = useMemo(
    () => parseMcChoicesFromOptionsJson(draft.questionType, draft.optionsJson),
    [draft.questionType, draft.optionsJson],
  )

  const tagByOptionId = useMemo(() => {
    const m = new Map<string, string>()
    for (const t of editDetail?.optionMisconceptionTags ?? []) {
      m.set(t.optionId, t.misconceptionId)
    }
    return m
  }, [editDetail?.optionMisconceptionTags])

  useEffect(() => {
    if (!editId || !misconceptionCourseFlag || !courseCode) {
      setMcList([])
      return
    }
    let cancelled = false
    setMcListLoading(true)
    void (async () => {
      try {
        const rows = await fetchCourseMisconceptions(courseCode, { limit: 400 })
        if (!cancelled) setMcList(rows)
      } catch {
        if (!cancelled) setMcList([])
      } finally {
        if (!cancelled) setMcListLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [editId, misconceptionCourseFlag, courseCode])

  const setOptionMcTag = useCallback(
    async (optionId: string, misconceptionId: string | null) => {
      if (!courseCode || !editId) return
      setMcTagBusyOptionId(optionId)
      setModalError(null)
      try {
        await putQuestionOptionMisconception(courseCode, editId, optionId, { misconceptionId })
        setEditDetail((d) => {
          if (!d) return d
          const rest = (d.optionMisconceptionTags ?? []).filter((t) => t.optionId !== optionId)
          const nextTags =
            misconceptionId != null && misconceptionId !== ''
              ? [...rest, { optionId, misconceptionId }]
              : rest
          return { ...d, optionMisconceptionTags: nextTags }
        })
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Could not update misconception tag.'
        setModalError(msg)
        toastMutationError(msg)
      } finally {
        setMcTagBusyOptionId(null)
      }
    },
    [courseCode, editId],
  )

  const submitNewMisconception = useCallback(
    async (ev: FormEvent) => {
      ev.preventDefault()
      if (!courseCode) return
      const name = newMcName.trim()
      if (!name) return
      setNewMcBusy(true)
      setModalError(null)
      try {
        const row = await createCourseMisconception(courseCode, {
          name,
          remediationBody: newMcBody.trim() || undefined,
        })
        setMcList((prev) => [...prev, row].sort((a, b) => a.name.localeCompare(b.name)))
        setNewMcName('')
        setNewMcBody('')
        toastSaveOk('Misconception created')
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Could not create misconception.'
        setModalError(msg)
        toastMutationError(msg)
      } finally {
        setNewMcBusy(false)
      }
    },
    [courseCode, newMcBody, newMcName],
  )

  if (!canEdit) {
    return (
      <LmsPage title="Question bank">
        <p className="text-sm text-slate-600 dark:text-neutral-300">
          You do not have access to manage this course&apos;s question bank.
        </p>
      </LmsPage>
    )
  }

  return (
    <LmsPage
      title="Question bank"
      actions={
        <div className="flex items-center gap-2">
          <FeatureHelpTrigger topic="question-bank" />
        </div>
      }
    >
      <div className="max-w-5xl space-y-4">
        <p className="text-sm text-slate-600 dark:text-neutral-300">
          Browse normalized questions for this course. Enable the tool under{' '}
          <strong>Course settings → Course tools</strong> if it is off.
        </p>
        {!bankOn && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-100">
            The question bank feature is disabled for this course. Turn on &quot;Question bank&quot; in course
            features to sync quiz edits and use pools.
          </p>
        )}
        <div className="flex flex-wrap items-end gap-3">
          <button
            type="button"
            onClick={() => {
              setModalError(null)
              setCreateOpen(true)
              setEditId(null)
              setEditDetail(null)
              setDraft(defaultDraft())
            }}
            disabled={!bankOn}
            className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            New question
          </button>
          <div className="min-w-[12rem] flex-1">
            <label htmlFor={searchId} className="text-xs font-medium text-slate-700 dark:text-neutral-200">
              Search stem
            </label>
            <input
              id={searchId}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950"
              placeholder="Keywords…"
            />
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500"
          >
            Search
          </button>
        </div>
        {error && (
          <p className="text-sm text-rose-700 dark:text-rose-400" role="alert">
            {error}
          </p>
        )}
        {loading ? (
          <p className="text-sm text-slate-500 dark:text-neutral-400">Loading…</p>
        ) : bankOn && rows.length === 0 ? (
          <EmptyState
            icon={Library}
            title="No questions in the bank yet"
            body="Create a question here, or save a module quiz while the bank is enabled to sync items from the editor."
            primaryAction={{
              label: 'New question',
              onClick: () => {
                setModalError(null)
                setCreateOpen(true)
                setEditId(null)
                setEditDetail(null)
                setDraft(defaultDraft())
              },
            }}
          />
        ) : (
          <div
            className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm dark:border-neutral-800 dark:bg-neutral-950"
            role="grid"
            aria-label="Question bank"
          >
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-600 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300">
                <tr>
                  <th scope="col" className="px-4 py-3">
                    Stem
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Type
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Status
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Points
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Version
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-neutral-800">
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-slate-500 dark:text-neutral-400">
                      No questions found. Save a module quiz while the bank is enabled to sync items from the
                      editor.
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-50/80 dark:hover:bg-neutral-900/60">
                      <td className="max-w-md truncate px-4 py-3 text-slate-900 dark:text-neutral-100">
                        {r.stem}
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-neutral-300">{r.questionType}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-neutral-300">
                        <QuestionBankStatusChip status={r.status} />
                      </td>
                      <td className="px-4 py-3 tabular-nums text-slate-600 dark:text-neutral-300">{r.points}</td>
                      <td className="px-4 py-3 tabular-nums text-slate-600 dark:text-neutral-300">
                        {r.versionNumber}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => void loadQuestionForEdit(r.id, 'preview')}
                            className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-neutral-700 dark:text-neutral-100 dark:hover:bg-neutral-900"
                          >
                            Preview
                          </button>
                          <button
                            type="button"
                            onClick={() => void loadQuestionForEdit(r.id, 'edit')}
                            className="rounded-md border border-indigo-300 px-2 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-50 dark:border-indigo-500/60 dark:text-indigo-300 dark:hover:bg-indigo-950/40"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => void openHistory(r.id)}
                            className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-neutral-700 dark:text-neutral-100 dark:hover:bg-neutral-900"
                          >
                            History
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {(createOpen || editId) && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget && !busy) {
              setCreateOpen(false)
              setEditId(null)
              setEditDetail(null)
            }
          }}
        >
          <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-slate-200 bg-white p-4 shadow-xl dark:border-neutral-800 dark:bg-neutral-950">
            <h2 className="text-base font-semibold text-slate-900 dark:text-neutral-100">
              {editId ? 'Edit question' : 'New question'}
            </h2>
            <div className="mt-4 space-y-3">
              <label htmlFor={stemFieldId} className="block text-xs font-medium text-slate-700 dark:text-neutral-200">
                Stem
              </label>
              <textarea
                id={stemFieldId}
                value={draft.stem}
                onChange={(e) => setDraft((prev) => ({ ...prev, stem: e.target.value }))}
                rows={4}
                className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950"
              />
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="block text-xs font-medium text-slate-700 dark:text-neutral-200">
                  Type
                  <select
                    value={draft.questionType}
                    onChange={(e) => setDraft((prev) => ({ ...prev, questionType: e.target.value }))}
                    className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950"
                  >
                    {QUESTION_TYPE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-xs font-medium text-slate-700 dark:text-neutral-200">
                  Status
                  <select
                    value={draft.status}
                    onChange={(e) =>
                      setDraft((prev) => ({
                        ...prev,
                        status: e.target.value as QuestionDraft['status'],
                      }))
                    }
                    className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950"
                  >
                    <option value="draft">Draft</option>
                    <option value="active">Active</option>
                    <option value="retired">Retired</option>
                  </select>
                </label>
                <label className="block text-xs font-medium text-slate-700 dark:text-neutral-200">
                  Points
                  <input
                    type="number"
                    min={0}
                    step="0.25"
                    value={draft.points}
                    onChange={(e) => setDraft((prev) => ({ ...prev, points: e.target.value }))}
                    className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950"
                  />
                </label>
              </div>
              {questionTypeSupportsChoiceShuffle(draft.questionType) && (
                <label className="flex cursor-pointer items-start gap-2 text-sm text-slate-800 dark:text-neutral-100">
                  <input
                    type="checkbox"
                    checked={draft.lockAnswerOrder}
                    onChange={(e) => setDraft((prev) => ({ ...prev, lockAnswerOrder: e.target.checked }))}
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 dark:border-neutral-600"
                  />
                  <span>
                    <span className="font-medium">Lock answer order</span>
                    <span className="block text-xs font-normal text-slate-600 dark:text-neutral-400">
                      When the quiz shuffles options, keep this question&apos;s choices in authored order (e.g.
                      &quot;All of the above&quot; last).
                    </span>
                  </span>
                </label>
              )}
              <label className="flex cursor-pointer items-start gap-2 text-sm text-slate-800 dark:text-neutral-100">
                <input
                  type="checkbox"
                  checked={draft.srsEligible}
                  onChange={(e) => setDraft((prev) => ({ ...prev, srsEligible: e.target.checked }))}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 dark:border-neutral-600"
                />
                <span>
                  <span className="font-medium">Spaced repetition eligible</span>
                  <span className="block text-xs font-normal text-slate-600 dark:text-neutral-400">
                    When the course turns on review practice and the server flag is enabled, quiz exposure can queue
                    this item for learner review.
                  </span>
                </span>
              </label>
              <label className="block text-xs font-medium text-slate-700 dark:text-neutral-200">
                Explanation (optional)
                <textarea
                  value={draft.explanation}
                  onChange={(e) => setDraft((prev) => ({ ...prev, explanation: e.target.value }))}
                  rows={2}
                  className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950"
                />
              </label>
              <label className="block text-xs font-medium text-slate-700 dark:text-neutral-200">
                Options JSON (optional)
                <textarea
                  value={draft.optionsJson}
                  onChange={(e) => setDraft((prev) => ({ ...prev, optionsJson: e.target.value }))}
                  rows={4}
                  placeholder='["Option A", "Option B"]'
                  className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 font-mono text-sm dark:border-neutral-700 dark:bg-neutral-950"
                />
              </label>
              <label className="block text-xs font-medium text-slate-700 dark:text-neutral-200">
                Correct answer JSON (optional)
                <textarea
                  value={draft.correctAnswerJson}
                  onChange={(e) => setDraft((prev) => ({ ...prev, correctAnswerJson: e.target.value }))}
                  rows={3}
                  placeholder='{"correctChoiceIndex":0}'
                  className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 font-mono text-sm dark:border-neutral-700 dark:bg-neutral-950"
                />
              </label>
              <label className="block text-xs font-medium text-slate-700 dark:text-neutral-200">
                Change note (optional)
                <input
                  value={draft.changeNote}
                  onChange={(e) => setDraft((prev) => ({ ...prev, changeNote: e.target.value }))}
                  className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950"
                  placeholder="Describe why this revision was made"
                />
              </label>
              {editId && misconceptionCourseFlag && questionTypeSupportsChoiceShuffle(draft.questionType) ? (
                <div className="rounded-lg border border-slate-200 p-3 dark:border-neutral-700">
                  <p className="text-xs font-medium text-slate-800 dark:text-neutral-100">
                    Misconception tags (distractors)
                  </p>
                  <p className="mt-1 text-xs text-slate-600 dark:text-neutral-400">
                    Tag wrong choices for remediation when the course enables misconception detection. Stable option
                    UUIDs are required — save the question once if tags are unavailable.
                  </p>
                  {parsedMcChoices === null ? (
                    <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">
                      Options JSON must be a JSON array for tagging.
                    </p>
                  ) : (
                    <ul className="mt-2 space-y-2">
                      {parsedMcChoices.map((c, idx) => (
                        <li
                          key={c.id ?? `choice-${idx}`}
                          className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <span
                            className="min-w-0 truncate text-xs text-slate-700 dark:text-neutral-300"
                            title={c.text}
                          >
                            {c.text || `(Choice ${idx + 1})`}
                          </span>
                          {c.id ? (
                            <select
                              className="max-w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-xs dark:border-neutral-600 dark:bg-neutral-950"
                              disabled={mcListLoading || mcTagBusyOptionId === c.id}
                              value={tagByOptionId.get(c.id) ?? ''}
                              onChange={(e) => {
                                const v = e.target.value
                                void setOptionMcTag(c.id as string, v === '' ? null : v)
                              }}
                            >
                              <option value="">— None —</option>
                              {mcList.map((m) => (
                                <option key={m.id} value={m.id}>
                                  {m.name}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span className="text-xs text-amber-800 dark:text-amber-200">Save for option IDs</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                  <form
                    onSubmit={(e) => void submitNewMisconception(e)}
                    className="mt-3 space-y-2 border-t border-slate-200 pt-3 dark:border-neutral-700"
                  >
                    <p className="text-xs font-medium text-slate-700 dark:text-neutral-200">New misconception</p>
                    <input
                      placeholder="Name"
                      value={newMcName}
                      onChange={(e) => setNewMcName(e.target.value)}
                      className="w-full rounded-md border border-slate-200 px-2 py-1 text-xs dark:border-neutral-600 dark:bg-neutral-950"
                    />
                    <textarea
                      placeholder="Remediation text (optional)"
                      value={newMcBody}
                      onChange={(e) => setNewMcBody(e.target.value)}
                      rows={2}
                      className="w-full rounded-md border border-slate-200 px-2 py-1 text-xs dark:border-neutral-600 dark:bg-neutral-950"
                    />
                    <button
                      type="submit"
                      disabled={newMcBusy || !newMcName.trim()}
                      className="rounded-md border border-indigo-300 px-2 py-1 text-xs font-medium text-indigo-700 disabled:opacity-50 dark:border-indigo-500/60 dark:text-indigo-300"
                    >
                      {newMcBusy ? 'Creating…' : 'Create misconception'}
                    </button>
                  </form>
                </div>
              ) : null}
            </div>
            {modalError && (
              <p className="mt-3 text-sm text-rose-700 dark:text-rose-400" role="alert">
                {modalError}
              </p>
            )}
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setCreateOpen(false)
                  setEditId(null)
                  setEditDetail(null)
                }}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-100 dark:hover:bg-neutral-900"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void (editId ? submitEdit() : submitCreate())}
                className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
              >
                {busy ? 'Saving…' : editId ? 'Save changes' : 'Create question'}
              </button>
            </div>
          </div>
        </div>
      )}
      {historyId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget && !busy) setHistoryId(null)
          }}
        >
          <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-slate-200 bg-white p-4 shadow-xl dark:border-neutral-800 dark:bg-neutral-950">
            <h2 className="text-base font-semibold text-slate-900 dark:text-neutral-100">Version history</h2>
            {historyLoading ? (
              <p className="mt-3 text-sm text-slate-500 dark:text-neutral-400">Loading…</p>
            ) : historyRows.length === 0 ? (
              <p className="mt-3 text-sm text-slate-500 dark:text-neutral-400">No versions yet.</p>
            ) : (
              <div className="mt-3 space-y-2">
                {historyRows.map((v) => (
                  <div
                    key={v.versionNumber}
                    className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2 text-sm dark:border-neutral-800"
                  >
                    <div>
                      <p className="font-medium text-slate-900 dark:text-neutral-100">Version {v.versionNumber}</p>
                      <p className="text-xs text-slate-600 dark:text-neutral-300">
                        {new Date(v.createdAt).toLocaleString()} {v.changeNote ? `- ${v.changeNote}` : ''}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void restoreVersion(v.versionNumber)}
                      className="rounded-md border border-indigo-300 px-2 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-50 dark:border-indigo-500/60 dark:text-indigo-300 dark:hover:bg-indigo-950/40"
                    >
                      Restore
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => setHistoryId(null)}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-neutral-700 dark:text-neutral-100 dark:hover:bg-neutral-900"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
      {previewId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget) setPreviewId(null)
          }}
        >
          <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-slate-200 bg-white p-4 shadow-xl dark:border-neutral-800 dark:bg-neutral-950">
            <h2 className="text-base font-semibold text-slate-900 dark:text-neutral-100">Question preview</h2>
            {previewLoading ? (
              <p className="mt-3 text-sm text-slate-500 dark:text-neutral-400">Loading…</p>
            ) : previewQuestion ? (
              <div className="mt-3 space-y-3 text-sm">
                <p className="whitespace-pre-wrap rounded-md bg-slate-50 px-3 py-2 text-slate-900 dark:bg-neutral-900 dark:text-neutral-100">
                  {previewQuestion.stem}
                </p>
                <div className="grid grid-cols-2 gap-2 text-slate-600 dark:text-neutral-300">
                  <p>
                    <strong>Type:</strong> {previewQuestion.questionType}
                  </p>
                  <p>
                    <strong>Status:</strong> {previewQuestion.status}
                  </p>
                  <p>
                    <strong>Points:</strong> {previewQuestion.points}
                  </p>
                  <p>
                    <strong>Source:</strong> {previewQuestion.source}
                  </p>
                </div>
                {previewQuestion.explanation ? (
                  <p className="whitespace-pre-wrap text-slate-700 dark:text-neutral-200">
                    <strong>Explanation:</strong> {previewQuestion.explanation}
                  </p>
                ) : null}
                {previewJson ? (
                  <pre className="overflow-x-auto rounded-md bg-slate-900 px-3 py-2 text-xs text-slate-100">
                    {previewJson}
                  </pre>
                ) : null}
              </div>
            ) : (
              <p className="mt-3 text-sm text-slate-500 dark:text-neutral-400">Question not found.</p>
            )}
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => setPreviewId(null)}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-neutral-700 dark:text-neutral-100 dark:hover:bg-neutral-900"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </LmsPage>
  )
}
