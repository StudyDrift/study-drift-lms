import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Check, ChevronDown, GripVertical, Pencil, Plus, Trash2, X } from 'lucide-react'
import { SyllabusBlockEditor } from '../../components/syllabus/SyllabusBlockEditor'
import { MarkdownArticleView } from '../../components/syllabus/SyllabusMarkdownView'
import { markdownToSectionsForEditor, sectionsToMarkdown } from '../../components/syllabus/syllabusSectionMarkdown'
import { usePermissions } from '../../context/usePermissions'
import {
  fetchCourse,
  fetchModuleQuiz,
  patchModuleQuiz,
  type QuizQuestion,
  type SyllabusSection,
} from '../../lib/coursesApi'
import { type ResolvedMarkdownTheme, resolveMarkdownTheme } from '../../lib/markdownTheme'
import { permCourseItemCreate } from '../../lib/rbacApi'
import { LmsPage } from './LmsPage'

const QUESTION_TYPE_OPTIONS = [
  { value: 'multiple_choice', label: 'Multiple choice' },
  { value: 'fill_in_blank', label: 'Fill in the blank' },
  { value: 'essay', label: 'Essay' },
  { value: 'true_false', label: 'True / False' },
  { value: 'short_answer', label: 'Short answer' },
] as const
type QuestionType = (typeof QUESTION_TYPE_OPTIONS)[number]['value']

function isoToDatetimeLocalValue(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function datetimeLocalValueToIso(value: string): string | null {
  const t = value.trim()
  if (!t) return null
  const d = new Date(t)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString()
}

function newLocalId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `local-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function makeQuestion(): QuizQuestion {
  return {
    id: newLocalId(),
    prompt: '',
    questionType: 'multiple_choice',
    choices: ['', '', '', ''],
    correctChoiceIndex: null,
    multipleAnswer: false,
    answerWithImage: false,
    required: true,
    points: 1,
    estimatedMinutes: 2,
  }
}

function QuestionTypeDropdown({
  value,
  onChange,
}: {
  value: QuestionType
  onChange: (next: QuestionType) => void
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const menuId = useId()
  const selectedLabel = QUESTION_TYPE_OPTIONS.find((o) => o.value === value)?.label ?? 'Multiple choice'

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  return (
    <div ref={rootRef} className="relative">
      <label className="mb-1 block text-xs font-medium text-slate-600">Question type</label>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex w-full items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 transition hover:border-slate-300 hover:bg-slate-50"
      >
        <span>{selectedLabel}</span>
        <ChevronDown className={`h-4 w-4 transition ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="Question type options"
          className="absolute z-50 mt-1 w-full overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg shadow-slate-900/10"
        >
          {QUESTION_TYPE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="menuitemradio"
              aria-checked={opt.value === value}
              onClick={() => {
                onChange(opt.value)
                setOpen(false)
              }}
              className="flex w-full items-center justify-between px-3 py-2 text-left text-sm text-slate-800 transition hover:bg-slate-50"
            >
              <span>{opt.label}</span>
              {opt.value === value ? <Check className="h-4 w-4 text-indigo-600" aria-hidden /> : null}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function CourseModuleQuizPage() {
  const { courseCode, itemId } = useParams<{ courseCode: string; itemId: string }>()
  const { allows, loading: permLoading } = usePermissions()
  const canEdit = Boolean(courseCode && itemId && !permLoading && allows(permCourseItemCreate(courseCode)))

  const [title, setTitle] = useState('')
  const [markdown, setMarkdown] = useState('')
  const [dueAt, setDueAt] = useState<string | null>(null)
  const [updatedAt, setUpdatedAt] = useState<string | null>(null)
  const [questions, setQuestions] = useState<QuizQuestion[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [editingContent, setEditingContent] = useState(false)
  const [draft, setDraft] = useState<SyllabusSection[]>([])
  const [draftDueLocal, setDraftDueLocal] = useState('')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [questionsOpen, setQuestionsOpen] = useState(false)
  const [questionsDraft, setQuestionsDraft] = useState<QuizQuestion[]>([])
  const [questionsSaving, setQuestionsSaving] = useState(false)
  const [questionsError, setQuestionsError] = useState<string | null>(null)
  const [mdTheme, setMdTheme] = useState<ResolvedMarkdownTheme>(() =>
    resolveMarkdownTheme('classic', null),
  )

  const load = useCallback(async () => {
    if (!courseCode || !itemId) return
    setLoading(true)
    setLoadError(null)
    try {
      const [data, courseRow] = await Promise.all([fetchModuleQuiz(courseCode, itemId), fetchCourse(courseCode)])
      setTitle(data.title)
      setMarkdown(data.markdown)
      setDueAt(data.dueAt)
      setUpdatedAt(data.updatedAt)
      setQuestions(data.questions)
      setMdTheme(resolveMarkdownTheme(courseRow.markdownThemePreset, courseRow.markdownThemeCustom))
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not load this quiz.')
      setTitle('')
      setMarkdown('')
      setDueAt(null)
      setUpdatedAt(null)
      setQuestions([])
    } finally {
      setLoading(false)
    }
  }, [courseCode, itemId])

  useEffect(() => {
    void load()
  }, [load])

  function beginEditContent() {
    setSaveError(null)
    setDraft(markdownToSectionsForEditor(markdown, newLocalId))
    setDraftDueLocal(isoToDatetimeLocalValue(dueAt))
    setEditingContent(true)
  }

  function cancelEditContent() {
    setSaveError(null)
    setEditingContent(false)
    setDraft([])
    setDraftDueLocal('')
  }

  async function saveContent() {
    if (!courseCode || !itemId) return
    const body = sectionsToMarkdown(draft)
    setSaveError(null)
    setSaving(true)
    try {
      const data = await patchModuleQuiz(courseCode, itemId, {
        markdown: body,
        dueAt: datetimeLocalValueToIso(draftDueLocal),
      })
      setMarkdown(data.markdown)
      setDueAt(data.dueAt)
      setUpdatedAt(data.updatedAt)
      setEditingContent(false)
      setDraft([])
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Could not save.')
    } finally {
      setSaving(false)
    }
  }

  function openQuestionsEditor() {
    setQuestionsError(null)
    setQuestionsDraft(questions.map((q) => ({ ...q, choices: [...q.choices] })))
    setQuestionsOpen(true)
  }

  async function saveQuestions() {
    if (!courseCode || !itemId) return
    setQuestionsError(null)
    setQuestionsSaving(true)
    try {
      const payload = questionsDraft.map((q) => ({
        ...q,
        prompt: q.prompt.trim(),
        choices: q.choices.map((c) => c.trim()).filter((c) => c.length > 0),
      }))
      const data = await patchModuleQuiz(courseCode, itemId, { questions: payload })
      setQuestions(data.questions)
      setUpdatedAt(data.updatedAt)
      setQuestionsOpen(false)
      setQuestionsDraft([])
    } catch (e) {
      setQuestionsError(e instanceof Error ? e.message : 'Could not save questions.')
    } finally {
      setQuestionsSaving(false)
    }
  }

  if (!courseCode || !itemId) {
    return (
      <LmsPage title="Quiz" description="">
        <p className="mt-6 text-sm text-slate-500">Invalid link.</p>
      </LmsPage>
    )
  }

  const description =
    updatedAt == null
      ? `Course ${courseCode}`
      : `Course ${courseCode} · Updated ${new Date(updatedAt).toLocaleString(undefined, {
          dateStyle: 'medium',
          timeStyle: 'short',
        })}`

  const backTo = `/courses/${encodeURIComponent(courseCode)}/modules`

  return (
    <LmsPage
      title={loading ? 'Quiz' : title || 'Quiz'}
      description={description}
      actions={
        editingContent ? (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={cancelEditContent}
              disabled={saving}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void saveContent()}
              disabled={saving}
              className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        ) : canEdit ? (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={beginEditContent}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Pencil className="h-4 w-4" aria-hidden />
              Edit content
            </button>
            <button
              type="button"
              onClick={openQuestionsEditor}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Edit questions
            </button>
          </div>
        ) : null
      }
    >
      <p className="mt-2 text-left text-sm">
        <Link to={backTo} className="font-medium text-indigo-600 hover:text-indigo-500">
          ← Back to modules
        </Link>
      </p>

      <div className="mx-auto w-full max-w-4xl min-w-0">
        {loadError && (
          <p className="mt-6 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            {loadError}
          </p>
        )}
        {loading && <p className="mt-8 text-sm text-slate-500">Loading…</p>}

        {!loading && !loadError && !editingContent && (
          <div className="mt-8 space-y-6">
            {dueAt && (
              <p className="text-sm text-slate-600">
                <span className="font-medium text-slate-800">Due:</span>{' '}
                {new Date(dueAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
              </p>
            )}
            <MarkdownArticleView
              markdown={markdown}
              emptyMessage="No quiz intro yet. Select Edit content to add details."
              theme={mdTheme}
            />
            <div className="rounded-2xl border border-slate-200/90 bg-slate-50/70 p-4">
              <p className="text-sm font-semibold text-slate-900">
                {questions.length} {questions.length === 1 ? 'question' : 'questions'}
              </p>
              <p className="mt-1 text-sm text-slate-600">
                Use <span className="font-medium">Edit questions</span> to build or update quiz questions.
              </p>
            </div>
          </div>
        )}
      </div>

      {!loading && !loadError && editingContent && (
        <div className="mt-6 -mx-6 md:-mx-8">
          {saveError && (
            <p className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-6 py-3 text-sm text-rose-800 md:px-8">
              {saveError}
            </p>
          )}
          {canEdit && (
            <div className="mb-4 px-4 md:px-8">
              <label className="block text-sm font-medium text-slate-800" htmlFor="quiz-due-at">
                Due date (optional)
              </label>
              <input
                id="quiz-due-at"
                type="datetime-local"
                value={draftDueLocal}
                onChange={(e) => setDraftDueLocal(e.target.value)}
                disabled={saving}
                className="mt-2 w-full max-w-md rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 disabled:opacity-60"
              />
            </div>
          )}
          <div className="px-4 md:px-8">
            <SyllabusBlockEditor
              sections={draft}
              onChange={setDraft}
              disabled={saving}
              documentVariant="page"
            />
          </div>
        </div>
      )}

      {questionsOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget && !questionsSaving) setQuestionsOpen(false)
          }}
        >
          <div className="h-[88vh] w-full max-w-6xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <h3 className="text-sm font-semibold text-slate-900">Edit questions</h3>
              <button
                type="button"
                onClick={() => setQuestionsOpen(false)}
                disabled={questionsSaving}
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-50"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="h-[calc(88vh-7.5rem)] overflow-y-auto bg-slate-50/60 p-4">
              <div className="space-y-3">
                {questionsDraft.map((q, index) => (
                  <div key={q.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Question {index + 1}
                    </p>
                    <div className="mb-2 grid gap-2 md:grid-cols-[1fr_16rem]">
                      <textarea
                        value={q.prompt}
                        onChange={(e) =>
                          setQuestionsDraft((prev) =>
                            prev.map((it) => (it.id === q.id ? { ...it, prompt: e.target.value } : it)),
                          )
                        }
                        rows={2}
                        placeholder="Enter question prompt"
                        className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-400/30"
                      />
                      <QuestionTypeDropdown
                        value={q.questionType}
                        onChange={(nextType) => {
                          setQuestionsDraft((prev) =>
                            prev.map((it) =>
                              it.id === q.id
                                ? {
                                    ...it,
                                    questionType: nextType,
                                    choices:
                                      nextType === 'multiple_choice'
                                        ? it.choices.length > 0
                                          ? it.choices
                                          : ['', '', '', '']
                                        : nextType === 'true_false'
                                          ? ['True', 'False']
                                          : [],
                                    correctChoiceIndex:
                                      nextType === 'multiple_choice' || nextType === 'true_false'
                                        ? it.correctChoiceIndex
                                        : null,
                                  }
                                : it,
                            ),
                          )
                        }}
                      />
                    </div>
                    {(q.questionType === 'multiple_choice' || q.questionType === 'true_false') && (
                      <div className="mt-3">
                        <div className="mb-2 flex flex-wrap items-center gap-4 text-sm">
                          <span className="font-semibold text-slate-700">Choices*</span>
                          <label className="inline-flex items-center gap-2 text-slate-600">
                            <button
                              type="button"
                              role="switch"
                              aria-checked={q.multipleAnswer}
                              onClick={() =>
                                setQuestionsDraft((prev) =>
                                  prev.map((it) =>
                                    it.id === q.id ? { ...it, multipleAnswer: !it.multipleAnswer } : it,
                                  ),
                                )
                              }
                              className={`relative h-5 w-9 rounded-full transition ${
                                q.multipleAnswer ? 'bg-indigo-500' : 'bg-slate-300'
                              }`}
                            >
                              <span
                                className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition ${
                                  q.multipleAnswer ? 'left-4.5' : 'left-0.5'
                                }`}
                              />
                            </button>
                            Multiple answer
                          </label>
                          <label className="inline-flex items-center gap-2 text-slate-600">
                            <button
                              type="button"
                              role="switch"
                              aria-checked={q.answerWithImage}
                              onClick={() =>
                                setQuestionsDraft((prev) =>
                                  prev.map((it) =>
                                    it.id === q.id ? { ...it, answerWithImage: !it.answerWithImage } : it,
                                  ),
                                )
                              }
                              className={`relative h-5 w-9 rounded-full transition ${
                                q.answerWithImage ? 'bg-indigo-500' : 'bg-slate-300'
                              }`}
                            >
                              <span
                                className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition ${
                                  q.answerWithImage ? 'left-4.5' : 'left-0.5'
                                }`}
                              />
                            </button>
                            Answer with image
                          </label>
                        </div>
                        <div className="space-y-2">
                        {q.choices.map((choice, choiceIdx) => (
                          <div
                            key={`${q.id}-choice-${choiceIdx}`}
                            className="flex items-center gap-2 rounded-lg bg-white"
                          >
                            <button
                              type="button"
                              aria-label={`Mark option ${choiceIdx + 1} as correct`}
                              aria-pressed={q.correctChoiceIndex === choiceIdx}
                              onClick={() =>
                                setQuestionsDraft((prev) =>
                                  prev.map((it) =>
                                    it.id === q.id
                                      ? {
                                          ...it,
                                          correctChoiceIndex:
                                            it.correctChoiceIndex === choiceIdx ? null : choiceIdx,
                                        }
                                      : it,
                                  ),
                                )
                              }
                              className="ml-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-slate-300"
                            >
                              <span
                                className={`h-3 w-3 rounded-full ${
                                  q.correctChoiceIndex === choiceIdx ? 'bg-indigo-600' : 'bg-transparent'
                                }`}
                              />
                            </button>
                            <input
                              type="text"
                              value={choice}
                              onChange={(e) =>
                                setQuestionsDraft((prev) =>
                                  prev.map((it) =>
                                    it.id === q.id
                                      ? {
                                          ...it,
                                          choices: it.choices.map((c, i) =>
                                            i === choiceIdx ? e.target.value : c,
                                          ),
                                        }
                                      : it,
                                  ),
                                )
                              }
                              placeholder={`Choice ${choiceIdx + 1}`}
                              className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-900 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-400/30"
                            />
                            <button
                              type="button"
                              aria-label="Reorder option"
                              title="Reorder option"
                              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:text-slate-600"
                            >
                              <GripVertical className="h-4 w-4" aria-hidden />
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setQuestionsDraft((prev) =>
                                  prev.map((it) => {
                                    if (it.id !== q.id) return it
                                    if (it.choices.length <= 1) return it
                                    const nextChoices = it.choices.filter((_, i) => i !== choiceIdx)
                                    let nextCorrect = it.correctChoiceIndex
                                    if (nextCorrect === choiceIdx) nextCorrect = null
                                    else if (
                                      nextCorrect != null &&
                                      typeof nextCorrect === 'number' &&
                                      nextCorrect > choiceIdx
                                    ) {
                                      nextCorrect = nextCorrect - 1
                                    }
                                    return {
                                      ...it,
                                      choices: nextChoices,
                                      correctChoiceIndex: nextCorrect,
                                    }
                                  }),
                                )
                              }
                              aria-label={`Delete choice ${choiceIdx + 1}`}
                              title="Delete option"
                              className="mr-1 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:text-rose-700"
                            >
                              <Trash2 className="h-4 w-4" aria-hidden />
                            </button>
                          </div>
                        ))}
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setQuestionsDraft((prev) =>
                              prev.map((it) =>
                                it.id === q.id ? { ...it, choices: [...it.choices, ''] } : it,
                              ),
                            )
                          }
                          className="mt-2 inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          Add option
                        </button>
                        <p className="text-xs text-slate-500">
                          Check a box to mark the correct choice (optional).
                        </p>
                      </div>
                    )}
                    {q.questionType === 'fill_in_blank' && (
                      <p className="mt-3 text-xs text-slate-500">
                        Learners provide text for blanks. Add guidance in the question prompt.
                      </p>
                    )}
                    {(q.questionType === 'essay' || q.questionType === 'short_answer') && (
                      <p className="mt-3 text-xs text-slate-500">
                        Open-response question type. No answer choices are shown to learners.
                      </p>
                    )}
                    <div className="mt-3 flex flex-wrap items-center gap-4 border-t border-slate-100 pt-3">
                      <label className="inline-flex items-center gap-2 text-sm text-slate-600">
                        <input
                          type="checkbox"
                          checked={q.required}
                          onChange={(e) =>
                            setQuestionsDraft((prev) =>
                              prev.map((it) => (it.id === q.id ? { ...it, required: e.target.checked } : it)),
                            )
                          }
                        />
                        Required
                      </label>
                    </div>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setQuestionsDraft((prev) => [...prev, makeQuestion()])}
                className="mt-4 inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-slate-50"
              >
                <Plus className="h-4 w-4" />
                Add question
              </button>
              {questionsError && (
                <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                  {questionsError}
                </p>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-white px-4 py-3">
              <button
                type="button"
                onClick={() => setQuestionsOpen(false)}
                disabled={questionsSaving}
                className="rounded-xl px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void saveQuestions()}
                disabled={questionsSaving}
                className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:opacity-60"
              >
                {questionsSaving ? 'Saving…' : 'Save questions'}
              </button>
            </div>
          </div>
        </div>
      )}
    </LmsPage>
  )
}
