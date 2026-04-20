import { useCallback, useEffect, useId, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { usePermissions } from '../../context/usePermissions'
import {
  createCourseQuestion,
  courseItemsCreatePermission,
  fetchCourse,
  fetchCourseQuestion,
  fetchCourseQuestions,
  updateCourseQuestion,
  type BankQuestionDetail,
  type BankQuestionRow,
  type CreateBankQuestionBody,
  type UpdateBankQuestionBody,
} from '../../lib/coursesApi'
import { LmsPage } from './LmsPage'

type QuestionDraft = {
  questionType: string
  stem: string
  status: 'draft' | 'active' | 'retired'
  points: string
  explanation: string
  optionsJson: string
  correctAnswerJson: string
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
  }
}

export function CourseQuestionBankPage() {
  const { courseCode = '' } = useParams<{ courseCode: string }>()
  const searchId = useId()
  const { allows, loading: permLoading } = usePermissions()
  const canEdit = !permLoading && allows(courseItemsCreatePermission(courseCode))

  const [rows, setRows] = useState<BankQuestionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [bankOn, setBankOn] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [draft, setDraft] = useState<QuestionDraft>(() => defaultDraft())
  const [busy, setBusy] = useState(false)
  const [modalError, setModalError] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewQuestion, setPreviewQuestion] = useState<BankQuestionDetail | null>(null)

  const load = useCallback(async () => {
    if (!courseCode) return
    setLoading(true)
    setError(null)
    try {
      const course = await fetchCourse(courseCode)
      setBankOn(course.questionBankEnabled === true)
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
          setEditId(questionId)
          setCreateOpen(false)
        } else {
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
    } catch (e) {
      setModalError(e instanceof Error ? e.message : 'Could not create question.')
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
      setEditId(null)
      await load()
    } catch (e) {
      setModalError(e instanceof Error ? e.message : 'Could not update question.')
    } finally {
      setBusy(false)
    }
  }, [courseCode, draft, editId, load])

  useEffect(() => {
    void load()
  }, [load])

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
    <LmsPage title="Question bank">
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
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-neutral-800">
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-slate-500 dark:text-neutral-400">
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
                      <td className="px-4 py-3 text-slate-600 dark:text-neutral-300">{r.status}</td>
                      <td className="px-4 py-3 tabular-nums text-slate-600 dark:text-neutral-300">{r.points}</td>
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
            }
          }}
        >
          <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-slate-200 bg-white p-4 shadow-xl dark:border-neutral-800 dark:bg-neutral-950">
            <h2 className="text-base font-semibold text-slate-900 dark:text-neutral-100">
              {editId ? 'Edit question' : 'New question'}
            </h2>
            <div className="mt-4 space-y-3">
              <label className="block text-xs font-medium text-slate-700 dark:text-neutral-200">
                Stem
                <textarea
                  value={draft.stem}
                  onChange={(e) => setDraft((prev) => ({ ...prev, stem: e.target.value }))}
                  rows={4}
                  className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950"
                />
              </label>
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
