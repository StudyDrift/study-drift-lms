import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Check, ChevronDown, Eye, Pencil, Plus, Sparkles, Trash2, X } from 'lucide-react'
import { SyllabusBlockEditor } from '../../components/syllabus/SyllabusBlockEditor'
import { MarkdownArticleView } from '../../components/syllabus/SyllabusMarkdownView'
import { markdownToSectionsForEditor, sectionsToMarkdown } from '../../components/syllabus/syllabusSectionMarkdown'
import { usePermissions } from '../../context/usePermissions'
import {
  defaultQuizAdvancedSettings,
  fetchCourse,
  fetchCourseStructure,
  fetchModuleQuiz,
  generateModuleQuizQuestions,
  patchModuleQuiz,
  quizAdvancedSettingsFromPayload,
  type CourseStructureItem,
  type QuizAdvancedSettings,
  type QuizQuestion,
  type SyllabusSection,
} from '../../lib/coursesApi'
import { type ResolvedMarkdownTheme, resolveMarkdownTheme } from '../../lib/markdownTheme'
import { permCourseItemCreate } from '../../lib/rbacApi'
import { CourseItemPromptEditor } from '../../components/CourseItemPromptEditor'
import { expandQuizPromptWithRefs } from '../../lib/courseItemRefTokens'
import { QuizPageSettingsPanel } from '../../components/quiz/QuizPageSettingsPanel'
import { QuizStudentPreviewModal } from '../../components/quiz/QuizStudentPreviewModal'
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

function formatQuizDateTime(iso: string | null): string {
  if (!iso) return 'Not set'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'Not set'
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function formatGradePolicyShort(p: string): string {
  if (p === 'highest') return 'Highest score'
  if (p === 'latest') return 'Latest attempt'
  if (p === 'first') return 'First attempt'
  if (p === 'average') return 'Average'
  return p
}

function newLocalId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `local-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function structureKindLabel(kind: CourseStructureItem['kind']): string {
  if (kind === 'content_page') return 'Content'
  if (kind === 'assignment') return 'Assignment'
  if (kind === 'quiz') return 'Quiz'
  return kind
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

function QuizEditorMoreMenu({
  disabled,
  onPreview,
  onEditIntro,
  onGenerate,
}: {
  disabled: boolean
  onPreview: () => void
  onEditIntro: () => void
  onGenerate: () => void
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const menuId = useId()

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
      >
        More
        <ChevronDown className={`h-4 w-4 shrink-0 transition ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="More quiz actions"
          className="absolute right-0 z-50 mt-1 min-w-[12rem] overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg shadow-slate-900/10 dark:border-neutral-600 dark:bg-neutral-900"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onEditIntro()
              setOpen(false)
            }}
            className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-medium text-slate-800 transition hover:bg-slate-50 dark:text-neutral-200 dark:hover:bg-neutral-800"
          >
            <Pencil className="h-4 w-4 shrink-0 text-slate-500 dark:text-neutral-400" aria-hidden />
            Edit
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onGenerate()
              setOpen(false)
            }}
            className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-medium text-slate-800 transition hover:bg-slate-50 dark:text-neutral-200 dark:hover:bg-neutral-800"
          >
            <Sparkles className="h-4 w-4 shrink-0 text-slate-500 dark:text-neutral-400" aria-hidden />
            Generate questions
          </button>
          <div
            role="separator"
            aria-orientation="horizontal"
            className="my-1 border-t border-slate-200 dark:border-neutral-600"
          />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onPreview()
              setOpen(false)
            }}
            className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-medium text-slate-800 transition hover:bg-slate-50 dark:text-neutral-200 dark:hover:bg-neutral-800"
          >
            <Eye className="h-4 w-4 shrink-0 text-slate-500 dark:text-neutral-400" aria-hidden />
            Preview
          </button>
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
  const [availableFromAt, setAvailableFromAt] = useState<string | null>(null)
  const [availableUntilAt, setAvailableUntilAt] = useState<string | null>(null)
  const [unlimitedAttempts, setUnlimitedAttempts] = useState(false)
  const [oneQuestionAtATime, setOneQuestionAtATime] = useState(false)
  const [updatedAt, setUpdatedAt] = useState<string | null>(null)
  const [questions, setQuestions] = useState<QuizQuestion[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [editingContent, setEditingContent] = useState(false)
  const [draft, setDraft] = useState<SyllabusSection[]>([])
  const [draftTitle, setDraftTitle] = useState('')
  const quizTitleFieldId = useId()
  const [draftDueLocal, setDraftDueLocal] = useState('')
  const [draftAvailableFromLocal, setDraftAvailableFromLocal] = useState('')
  const [draftAvailableUntilLocal, setDraftAvailableUntilLocal] = useState('')
  const [draftUnlimitedAttempts, setDraftUnlimitedAttempts] = useState(false)
  const [draftOneQuestionAtATime, setDraftOneQuestionAtATime] = useState(false)
  const [quizAdvanced, setQuizAdvanced] = useState<QuizAdvancedSettings>(() => defaultQuizAdvancedSettings())
  const [draftQuizAdvanced, setDraftQuizAdvanced] = useState<QuizAdvancedSettings>(() => defaultQuizAdvancedSettings())
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [questionsOpen, setQuestionsOpen] = useState(false)
  const [questionsDraft, setQuestionsDraft] = useState<QuizQuestion[]>([])
  const [questionsSaving, setQuestionsSaving] = useState(false)
  const [questionsError, setQuestionsError] = useState<string | null>(null)
  const [structureItems, setStructureItems] = useState<CourseStructureItem[]>([])
  const [qeAdaptiveOn, setQeAdaptiveOn] = useState(false)
  const [qeAdaptivePrompt, setQeAdaptivePrompt] = useState('')
  const [qeAdaptiveSources, setQeAdaptiveSources] = useState<string[]>([])
  const [qeAdaptiveQuestionCount, setQeAdaptiveQuestionCount] = useState(5)
  const [isAdaptive, setIsAdaptive] = useState(false)
  const [adaptiveSystemPrompt, setAdaptiveSystemPrompt] = useState('')
  const [adaptiveSourceItemIds, setAdaptiveSourceItemIds] = useState<string[]>([])
  const [adaptiveQuestionCount, setAdaptiveQuestionCount] = useState(5)
  const [generateModalOpen, setGenerateModalOpen] = useState(false)
  const [generatePrompt, setGeneratePrompt] = useState('')
  const [generateCount, setGenerateCount] = useState(5)
  const [generateBusy, setGenerateBusy] = useState(false)
  const [generateError, setGenerateError] = useState<string | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
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
      setAvailableFromAt(data.availableFrom ?? null)
      setAvailableUntilAt(data.availableUntil ?? null)
      setUnlimitedAttempts(Boolean(data.unlimitedAttempts))
      setOneQuestionAtATime(Boolean(data.oneQuestionAtATime))
      const adv = quizAdvancedSettingsFromPayload(data)
      setQuizAdvanced(adv)
      setDraftQuizAdvanced(adv)
      setUpdatedAt(data.updatedAt)
      setQuestions(data.questions)
      setIsAdaptive(Boolean(data.isAdaptive))
      setAdaptiveSystemPrompt(data.adaptiveSystemPrompt ?? '')
      setAdaptiveSourceItemIds(data.adaptiveSourceItemIds ?? [])
      setAdaptiveQuestionCount(
        typeof data.adaptiveQuestionCount === 'number' ? data.adaptiveQuestionCount : 5,
      )
      setMdTheme(resolveMarkdownTheme(courseRow.markdownThemePreset, courseRow.markdownThemeCustom))
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not load this quiz.')
      setTitle('')
      setMarkdown('')
      setDueAt(null)
      setAvailableFromAt(null)
      setAvailableUntilAt(null)
      setUnlimitedAttempts(false)
      setOneQuestionAtATime(false)
      const blankAdv = defaultQuizAdvancedSettings()
      setQuizAdvanced(blankAdv)
      setDraftQuizAdvanced(blankAdv)
      setUpdatedAt(null)
      setQuestions([])
      setIsAdaptive(false)
      setAdaptiveSystemPrompt('')
      setAdaptiveSourceItemIds([])
      setAdaptiveQuestionCount(5)
    } finally {
      setLoading(false)
    }
  }, [courseCode, itemId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!questionsOpen || !courseCode) return
    let cancelled = false
    void (async () => {
      try {
        const items = await fetchCourseStructure(courseCode)
        if (!cancelled) setStructureItems(items)
      } catch {
        if (!cancelled) setStructureItems([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [questionsOpen, courseCode])

  const quizActionsRef = useRef<HTMLDivElement>(null)
  const quizSummaryAsideRef = useRef<HTMLElement>(null)

  useLayoutEffect(() => {
    if (editingContent || loading || loadError) return

    const aside = quizSummaryAsideRef.current
    const actions = quizActionsRef.current
    const mq = window.matchMedia('(min-width: 1024px)')

    function alignSummaryAside() {
      if (!aside || !actions) {
        if (aside) aside.style.marginTop = ''
        return
      }
      if (!mq.matches) {
        aside.style.marginTop = ''
        return
      }
      const delta =
        actions.getBoundingClientRect().top - aside.getBoundingClientRect().top
      aside.style.marginTop = `${Math.round(delta)}px`
    }

    alignSummaryAside()
    const rafId = requestAnimationFrame(() => alignSummaryAside())

    mq.addEventListener('change', alignSummaryAside)
    window.addEventListener('resize', alignSummaryAside)
    return () => {
      cancelAnimationFrame(rafId)
      mq.removeEventListener('change', alignSummaryAside)
      window.removeEventListener('resize', alignSummaryAside)
      if (quizSummaryAsideRef.current) quizSummaryAsideRef.current.style.marginTop = ''
    }
  }, [
    editingContent,
    loading,
    loadError,
    title,
    markdown,
    questions.length,
    isAdaptive,
    dueAt,
    availableFromAt,
    availableUntilAt,
    unlimitedAttempts,
    oneQuestionAtATime,
    updatedAt,
  ])

  function beginEditContent() {
    setSaveError(null)
    setDraft(markdownToSectionsForEditor(markdown, newLocalId))
    setDraftTitle(title)
    setDraftDueLocal(isoToDatetimeLocalValue(dueAt))
    setDraftAvailableFromLocal(isoToDatetimeLocalValue(availableFromAt))
    setDraftAvailableUntilLocal(isoToDatetimeLocalValue(availableUntilAt))
    setDraftUnlimitedAttempts(unlimitedAttempts)
    setDraftOneQuestionAtATime(oneQuestionAtATime)
    setDraftQuizAdvanced(quizAdvanced)
    setEditingContent(true)
  }

  function cancelEditContent() {
    setSaveError(null)
    setEditingContent(false)
    setDraft([])
    setDraftTitle(title)
    setDraftDueLocal(isoToDatetimeLocalValue(dueAt))
    setDraftAvailableFromLocal(isoToDatetimeLocalValue(availableFromAt))
    setDraftAvailableUntilLocal(isoToDatetimeLocalValue(availableUntilAt))
    setDraftUnlimitedAttempts(unlimitedAttempts)
    setDraftOneQuestionAtATime(oneQuestionAtATime)
    setDraftQuizAdvanced(quizAdvanced)
  }

  async function saveContent() {
    if (!courseCode || !itemId) return
    const trimmedTitle = draftTitle.trim()
    if (!trimmedTitle) {
      setSaveError('Title is required.')
      return
    }
    const body = sectionsToMarkdown(draft)
    setSaveError(null)
    setSaving(true)
    try {
      const code = draftQuizAdvanced.quizAccessCode.trim()
      const data = await patchModuleQuiz(courseCode, itemId, {
        title: trimmedTitle,
        markdown: body,
        dueAt: datetimeLocalValueToIso(draftDueLocal),
        availableFrom: datetimeLocalValueToIso(draftAvailableFromLocal),
        availableUntil: datetimeLocalValueToIso(draftAvailableUntilLocal),
        unlimitedAttempts: draftUnlimitedAttempts,
        oneQuestionAtATime: draftOneQuestionAtATime,
        maxAttempts: draftQuizAdvanced.maxAttempts,
        gradeAttemptPolicy: draftQuizAdvanced.gradeAttemptPolicy,
        passingScorePercent: draftQuizAdvanced.passingScorePercent,
        lateSubmissionPolicy: draftQuizAdvanced.lateSubmissionPolicy,
        latePenaltyPercent: draftQuizAdvanced.latePenaltyPercent,
        timeLimitMinutes: draftQuizAdvanced.timeLimitMinutes,
        timerPauseWhenTabHidden: draftQuizAdvanced.timerPauseWhenTabHidden,
        perQuestionTimeLimitSeconds: draftQuizAdvanced.perQuestionTimeLimitSeconds,
        showScoreTiming: draftQuizAdvanced.showScoreTiming,
        reviewVisibility: draftQuizAdvanced.reviewVisibility,
        reviewWhen: draftQuizAdvanced.reviewWhen,
        shuffleQuestions: draftQuizAdvanced.shuffleQuestions,
        shuffleChoices: draftQuizAdvanced.shuffleChoices,
        allowBackNavigation: draftQuizAdvanced.allowBackNavigation,
        quizAccessCode: code.length > 0 ? code : null,
        adaptiveDifficulty: draftQuizAdvanced.adaptiveDifficulty,
        adaptiveTopicBalance: draftQuizAdvanced.adaptiveTopicBalance,
        adaptiveStopRule: draftQuizAdvanced.adaptiveStopRule,
        randomQuestionPoolCount: draftQuizAdvanced.randomQuestionPoolCount,
      })
      setTitle(data.title)
      setMarkdown(data.markdown)
      setDueAt(data.dueAt)
      setAvailableFromAt(data.availableFrom ?? null)
      setAvailableUntilAt(data.availableUntil ?? null)
      setUnlimitedAttempts(Boolean(data.unlimitedAttempts))
      setOneQuestionAtATime(Boolean(data.oneQuestionAtATime))
      const adv = quizAdvancedSettingsFromPayload(data)
      setQuizAdvanced(adv)
      setDraftQuizAdvanced(adv)
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
    setQeAdaptiveOn(isAdaptive)
    setQeAdaptivePrompt(adaptiveSystemPrompt)
    setQeAdaptiveSources([...adaptiveSourceItemIds])
    setQeAdaptiveQuestionCount(adaptiveQuestionCount)
    setQuestionsOpen(true)
  }

  async function saveQuestions() {
    if (!courseCode || !itemId) return
    if (qeAdaptiveOn && qeAdaptiveSources.length === 0) {
      setQuestionsError('Choose at least one course item to use as reference material.')
      return
    }
    const adaptiveCount = Math.min(30, Math.max(1, Math.floor(Number(qeAdaptiveQuestionCount)) || 1))
    setQuestionsError(null)
    setQuestionsSaving(true)
    try {
      if (qeAdaptiveOn) {
        const data = await patchModuleQuiz(courseCode, itemId, {
          questions: [],
          isAdaptive: true,
          adaptiveSystemPrompt: qeAdaptivePrompt.trim(),
          adaptiveSourceItemIds: qeAdaptiveSources,
          adaptiveQuestionCount: adaptiveCount,
        })
        setQuestions(data.questions)
        setIsAdaptive(Boolean(data.isAdaptive))
        setAdaptiveSystemPrompt(data.adaptiveSystemPrompt ?? '')
        setAdaptiveSourceItemIds(data.adaptiveSourceItemIds ?? [])
        setAdaptiveQuestionCount(
          typeof data.adaptiveQuestionCount === 'number' ? data.adaptiveQuestionCount : adaptiveCount,
        )
        setQuizAdvanced(quizAdvancedSettingsFromPayload(data))
        setUpdatedAt(data.updatedAt)
      } else {
        const payload = questionsDraft.map((q) => ({
          ...q,
          prompt: q.prompt.trim(),
          choices: q.choices.map((c) => c.trim()).filter((c) => c.length > 0),
        }))
        const data = await patchModuleQuiz(courseCode, itemId, {
          questions: payload,
          isAdaptive: false,
          adaptiveSystemPrompt: '',
          adaptiveSourceItemIds: [],
          adaptiveQuestionCount: 5,
        })
        setQuestions(data.questions)
        setIsAdaptive(Boolean(data.isAdaptive))
        setAdaptiveSystemPrompt(data.adaptiveSystemPrompt ?? '')
        setAdaptiveSourceItemIds(data.adaptiveSourceItemIds ?? [])
        setAdaptiveQuestionCount(5)
        setQuizAdvanced(quizAdvancedSettingsFromPayload(data))
        setUpdatedAt(data.updatedAt)
      }
      setQuestionsOpen(false)
      setQuestionsDraft([])
    } catch (e) {
      setQuestionsError(e instanceof Error ? e.message : 'Could not save questions.')
    } finally {
      setQuestionsSaving(false)
    }
  }

  function openGenerateModal() {
    setGenerateError(null)
    setGeneratePrompt('')
    setGenerateCount(5)
    setGenerateModalOpen(true)
  }

  async function runGenerateQuestions() {
    if (!courseCode || !itemId) return
    const prompt = generatePrompt.trim()
    if (!prompt) {
      setGenerateError('Describe what the quiz should cover.')
      return
    }
    const n = Math.min(30, Math.max(1, Math.floor(Number(generateCount)) || 1))
    setGenerateError(null)
    setGenerateBusy(true)
    try {
      const expandedPrompt = await expandQuizPromptWithRefs(courseCode, prompt)
      const { questions: generated } = await generateModuleQuizQuestions(courseCode, itemId, {
        prompt: expandedPrompt,
        questionCount: n,
      })
      setQuestionsDraft((prev) => {
        const base = questionsOpen
          ? prev
          : questions.map((q) => ({ ...q, choices: [...q.choices] }))
        return [...base, ...generated]
      })
      setQeAdaptiveOn(isAdaptive)
      setQeAdaptivePrompt(adaptiveSystemPrompt)
      setQeAdaptiveSources([...adaptiveSourceItemIds])
      setQeAdaptiveQuestionCount(adaptiveQuestionCount)
      setQuestionsOpen(true)
      setGenerateModalOpen(false)
    } catch (e) {
      setGenerateError(e instanceof Error ? e.message : 'Could not generate questions.')
    } finally {
      setGenerateBusy(false)
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
      ? ''
      : `Updated ${new Date(updatedAt).toLocaleString(undefined, {
          dateStyle: 'medium',
          timeStyle: 'short',
        })}`

  const backTo = `/courses/${encodeURIComponent(courseCode)}/modules`

  const displayTitle = loading ? 'Quiz' : title || 'Quiz'
  const titleTrimmed = draftTitle.trim()
  const canSaveContent = Boolean(titleTrimmed)

  return (
    <LmsPage
      actionsContainerRef={quizActionsRef}
      title={displayTitle}
      titleContent={
        editingContent && !loading ? (
          <h1 className="m-0 text-2xl font-semibold tracking-tight text-slate-900 dark:text-neutral-100">
            <label htmlFor={quizTitleFieldId} className="sr-only">
              Quiz title
            </label>
            <input
              id={quizTitleFieldId}
              type="text"
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              disabled={saving}
              autoComplete="off"
              className="w-full min-w-0 border-0 border-b border-transparent bg-transparent p-0 pb-0.5 text-2xl font-semibold tracking-tight text-slate-900 outline-none ring-0 transition placeholder:text-slate-400 focus:border-indigo-500 disabled:opacity-60 dark:border-transparent dark:text-neutral-100 dark:focus:border-indigo-400"
              placeholder="Quiz title"
            />
          </h1>
        ) : undefined
      }
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
              disabled={saving || !canSaveContent}
              className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-end gap-2">
            {canEdit ? (
              <>
                <QuizEditorMoreMenu
                  disabled={loading}
                  onPreview={() => setPreviewOpen(true)}
                  onEditIntro={beginEditContent}
                  onGenerate={openGenerateModal}
                />
                <button
                  type="button"
                  onClick={openQuestionsEditor}
                  disabled={loading}
                  className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Edit questions
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setPreviewOpen(true)}
                disabled={loading}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Eye className="h-4 w-4" aria-hidden />
                Preview
              </button>
            )}
          </div>
        )
      }
    >
      <p className="mt-2 text-left text-sm">
        <Link to={backTo} className="font-medium text-indigo-600 hover:text-indigo-500">
          ← Back to modules
        </Link>
      </p>

      <div className="mx-auto w-full max-w-5xl min-w-0">
        {loadError && (
          <p className="mt-6 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            {loadError}
          </p>
        )}
        {loading && <p className="mt-8 text-sm text-slate-500">Loading…</p>}

        {!loading && !loadError && !editingContent && (
          <div className="mt-8 flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-8">
            <div className="min-w-0 flex-1">
              <MarkdownArticleView
                markdown={markdown}
                emptyMessage={
                  canEdit
                    ? 'No quiz intro yet. Open More, then Edit, to add details.'
                    : 'No quiz intro yet.'
                }
                theme={mdTheme}
              />
            </div>
            <aside
              ref={quizSummaryAsideRef}
              className="shrink-0 lg:sticky lg:top-6 lg:w-72 lg:max-w-[min(100%,18rem)] xl:w-80 xl:max-w-[min(100%,20rem)]"
              aria-label="Quiz summary"
            >
              <div className="rounded-2xl border border-slate-200/90 bg-slate-50/70 p-4">
                <p className="text-sm font-semibold text-slate-900">
                  {isAdaptive
                    ? `Adaptive · up to ${adaptiveQuestionCount} generated questions`
                    : `${questions.length} ${questions.length === 1 ? 'question' : 'questions'}`}
                </p>
                <p className="mt-1 text-sm text-slate-600">
                  {canEdit ? (
                    isAdaptive ? (
                      <>
                        Use <span className="font-medium">Edit questions</span> to configure adaptive sources and
                        prompts. Questions are generated when learners take the quiz.
                      </>
                    ) : (
                      <>
                        Use <span className="font-medium">Edit questions</span> to build or update quiz questions.
                      </>
                    )
                  ) : isAdaptive ? (
                    'This quiz uses adaptive AI-generated questions.'
                  ) : (
                    'Quiz questions for this item.'
                  )}
                </p>
                <dl className="mt-4 space-y-2 border-t border-slate-200/80 pt-3 text-sm">
                  <div className="flex justify-between gap-4">
                    <dt className="shrink-0 text-slate-500">Due date</dt>
                    <dd className="min-w-0 text-right font-medium text-slate-900">{formatQuizDateTime(dueAt)}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="shrink-0 text-slate-500">Visibility start</dt>
                    <dd className="min-w-0 text-right font-medium text-slate-900">
                      {formatQuizDateTime(availableFromAt)}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="shrink-0 text-slate-500">Visibility end</dt>
                    <dd className="min-w-0 text-right font-medium text-slate-900">
                      {formatQuizDateTime(availableUntilAt)}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="shrink-0 text-slate-500">Unlimited attempts</dt>
                    <dd className="min-w-0 text-right font-medium text-slate-900">
                      {unlimitedAttempts ? 'Yes' : 'No'}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="shrink-0 text-slate-500">One question at a time</dt>
                    <dd className="min-w-0 text-right font-medium text-slate-900">
                      {oneQuestionAtATime ? 'Yes' : 'No'}
                    </dd>
                  </div>
                  {!unlimitedAttempts ? (
                    <div className="flex justify-between gap-4">
                      <dt className="shrink-0 text-slate-500">Max attempts</dt>
                      <dd className="min-w-0 text-right font-medium text-slate-900">{quizAdvanced.maxAttempts}</dd>
                    </div>
                  ) : null}
                  <div className="flex justify-between gap-4">
                    <dt className="shrink-0 text-slate-500">Grade uses</dt>
                    <dd className="min-w-0 text-right font-medium text-slate-900">
                      {formatGradePolicyShort(quizAdvanced.gradeAttemptPolicy)}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="shrink-0 text-slate-500">Passing score</dt>
                    <dd className="min-w-0 text-right font-medium text-slate-900">
                      {quizAdvanced.passingScorePercent != null ? `${quizAdvanced.passingScorePercent}%` : 'Not set'}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="shrink-0 text-slate-500">Time limit</dt>
                    <dd className="min-w-0 text-right font-medium text-slate-900">
                      {quizAdvanced.timeLimitMinutes != null
                        ? `${quizAdvanced.timeLimitMinutes} min`
                        : 'Not set'}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="shrink-0 text-slate-500">Shuffle questions</dt>
                    <dd className="min-w-0 text-right font-medium text-slate-900">
                      {quizAdvanced.shuffleQuestions ? 'Yes' : 'No'}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="shrink-0 text-slate-500">Access code</dt>
                    <dd className="min-w-0 text-right font-medium text-slate-900">
                      {quizAdvanced.requiresQuizAccessCode ? 'Required' : 'None'}
                    </dd>
                  </div>
                  {isAdaptive ? (
                    <div className="flex justify-between gap-4">
                      <dt className="shrink-0 text-slate-500">Adaptive difficulty</dt>
                      <dd className="min-w-0 text-right font-medium text-slate-900 capitalize">
                        {quizAdvanced.adaptiveDifficulty}
                      </dd>
                    </div>
                  ) : null}
                </dl>
              </div>
            </aside>
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
          <div className="px-4 md:px-8">
            <SyllabusBlockEditor
              courseCode={courseCode}
              sections={draft}
              onChange={setDraft}
              disabled={saving}
              documentVariant="page"
              pageDocumentPanel={
                canEdit ? (
                  <QuizPageSettingsPanel
                    disabled={saving}
                    dueLocal={draftDueLocal}
                    onDueLocalChange={setDraftDueLocal}
                    availableFromLocal={draftAvailableFromLocal}
                    onAvailableFromLocalChange={setDraftAvailableFromLocal}
                    availableUntilLocal={draftAvailableUntilLocal}
                    onAvailableUntilLocalChange={setDraftAvailableUntilLocal}
                    unlimitedAttempts={draftUnlimitedAttempts}
                    onUnlimitedAttemptsChange={setDraftUnlimitedAttempts}
                    oneQuestionAtATime={draftOneQuestionAtATime}
                    onOneQuestionAtATimeChange={setDraftOneQuestionAtATime}
                    advanced={draftQuizAdvanced}
                    onAdvancedChange={setDraftQuizAdvanced}
                    showAdaptiveSection={isAdaptive}
                  />
                ) : null
              }
            />
          </div>
        </div>
      )}

      {generateModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="quiz-generate-title"
          onClick={(e) => {
            if (e.target === e.currentTarget && !generateBusy) setGenerateModalOpen(false)
          }}
        >
          <div className="w-full max-w-lg overflow-visible rounded-2xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <h3 id="quiz-generate-title" className="text-sm font-semibold text-slate-900">
                Generate questions
              </h3>
              <button
                type="button"
                onClick={() => setGenerateModalOpen(false)}
                disabled={generateBusy}
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-50"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4 p-4">
              <p className="text-sm text-slate-600">
                Describe the topic or learning goals. The model will create the requested number of
                questions using the quiz question types (multiple choice, true/false, fill-in-the-blank,
                short answer, and essay). Type @ to tag a content page or assignment — it appears as a
                highlighted @name; the item’s body is pulled in when you click Generate.
              </p>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600" htmlFor="quiz-generate-prompt">
                  Prompt
                </label>
                <CourseItemPromptEditor
                  id="quiz-generate-prompt"
                  courseCode={courseCode}
                  value={generatePrompt}
                  onChange={setGeneratePrompt}
                  disabled={generateBusy}
                  autoFocus
                  placeholder="e.g. Five questions on cell division… Type @ to tag a content page or assignment (content is added when you generate)."
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600" htmlFor="quiz-generate-count">
                  Number of questions
                </label>
                <input
                  id="quiz-generate-count"
                  type="number"
                  min={1}
                  max={30}
                  value={generateCount}
                  onChange={(e) => setGenerateCount(Number(e.target.value))}
                  disabled={generateBusy}
                  className="w-full max-w-[8rem] rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-400/30 disabled:opacity-60"
                />
                <p className="mt-1 text-xs text-slate-500">Between 1 and 30.</p>
              </div>
              {generateError && (
                <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                  {generateError}
                </p>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50/80 px-4 py-3">
              <button
                type="button"
                onClick={() => setGenerateModalOpen(false)}
                disabled={generateBusy}
                className="rounded-xl px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void runGenerateQuestions()}
                disabled={generateBusy}
                className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:opacity-60"
              >
                {generateBusy ? 'Generating…' : 'Generate'}
              </button>
            </div>
          </div>
        </div>
      )}

      <QuizStudentPreviewModal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        quizTitle={title || 'Quiz'}
        markdown={markdown}
        dueAt={dueAt}
        questions={questions}
        theme={mdTheme}
        courseCode={courseCode}
        itemId={itemId}
        isAdaptive={isAdaptive}
        adaptiveQuestionCount={adaptiveQuestionCount}
        advanced={quizAdvanced}
        oneQuestionAtATime={oneQuestionAtATime}
      />

      {questionsOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget && !questionsSaving) setQuestionsOpen(false)
          }}
        >
          <div
            className={`w-full overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl ${
              qeAdaptiveOn
                ? 'max-h-[min(36rem,92vh)] max-w-xl'
                : 'h-[88vh] max-w-6xl'
            }`}
          >
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
            <div
              className={`overflow-y-auto bg-slate-50/60 p-4 ${
                qeAdaptiveOn ? 'max-h-[calc(min(36rem,92vh)-7.5rem)]' : 'h-[calc(88vh-7.5rem)]'
              }`}
            >
              <div className="space-y-3">
                <div className="rounded-xl border border-slate-200/90 bg-white p-4 shadow-sm shadow-slate-900/[0.03]">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900">Is adaptive</p>
                      <p className="mt-1 text-xs text-slate-600">
                        When on, the quiz does not use a fixed question list. The model reads your selected course
                        items and system prompt, then serves one question at a time and adapts from how the learner
                        answered (including per-option weights you do not show in the UI).
                      </p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={qeAdaptiveOn}
                      disabled={questionsSaving}
                      onClick={() => {
                        const next = !qeAdaptiveOn
                        setQeAdaptiveOn(next)
                        if (next) {
                          setQuestionsDraft([])
                        } else {
                          setQuestionsDraft(questions.map((q) => ({ ...q, choices: [...q.choices] })))
                        }
                      }}
                      className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition disabled:opacity-50 ${
                        qeAdaptiveOn ? 'bg-indigo-500' : 'bg-slate-300'
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${
                          qeAdaptiveOn ? 'left-5' : 'left-0.5'
                        }`}
                      />
                    </button>
                  </div>
                </div>

                {qeAdaptiveOn ? (
                  <div className="space-y-4">
                    <div>
                      <p className="mb-2 text-xs font-medium text-slate-600">Reference course items</p>
                      <p className="mb-2 text-xs text-slate-500">
                        Select pages, assignments, or other quizzes whose text the AI should use when generating
                        questions.
                      </p>
                      <div className="max-h-48 space-y-1 overflow-y-auto rounded-xl border border-slate-200 bg-white p-2">
                        {structureItems.filter(
                          (it) =>
                            (it.kind === 'content_page' || it.kind === 'assignment' || it.kind === 'quiz') &&
                            it.id !== itemId,
                        ).length === 0 ? (
                          <p className="px-2 py-3 text-xs text-slate-500">No linkable items found in this course.</p>
                        ) : (
                          structureItems
                            .filter(
                              (it) =>
                                (it.kind === 'content_page' || it.kind === 'assignment' || it.kind === 'quiz') &&
                                it.id !== itemId,
                            )
                            .map((it) => (
                              <label
                                key={it.id}
                                className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-2 text-sm text-slate-800 hover:bg-slate-50"
                              >
                                <input
                                  type="checkbox"
                                  checked={qeAdaptiveSources.includes(it.id)}
                                  onChange={() => {
                                    setQeAdaptiveSources((prev) =>
                                      prev.includes(it.id) ? prev.filter((x) => x !== it.id) : [...prev, it.id],
                                    )
                                  }}
                                  className="mt-0.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500/30"
                                />
                                <span className="min-w-0">
                                  <span className="font-medium">{it.title || 'Untitled'}</span>
                                  <span className="ml-2 text-xs text-slate-500">({structureKindLabel(it.kind)})</span>
                                </span>
                              </label>
                            ))
                        )}
                      </div>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-600" htmlFor="adaptive-system-prompt">
                        System prompt
                      </label>
                      <textarea
                        id="adaptive-system-prompt"
                        value={qeAdaptivePrompt}
                        onChange={(e) => setQeAdaptivePrompt(e.target.value)}
                        disabled={questionsSaving}
                        rows={5}
                        placeholder="Instructions for the AI (tone, difficulty, topics to emphasize or avoid)…"
                        className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-400/30 disabled:opacity-60"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-600" htmlFor="adaptive-q-count">
                        Number of questions
                      </label>
                      <input
                        id="adaptive-q-count"
                        type="number"
                        min={1}
                        max={30}
                        value={qeAdaptiveQuestionCount}
                        onChange={(e) => setQeAdaptiveQuestionCount(Number(e.target.value))}
                        disabled={questionsSaving}
                        className="w-full max-w-[8rem] rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-400/30 disabled:opacity-60"
                      />
                      <p className="mt-1 text-xs text-slate-500">Between 1 and 30 per attempt.</p>
                    </div>
                  </div>
                ) : null}

                {!qeAdaptiveOn
                  ? questionsDraft.map((q, index) => (
                  <div
                    key={q.id}
                    className="rounded-xl border border-slate-200/90 bg-white p-5 shadow-sm shadow-slate-900/[0.03]"
                  >
                    <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Question {index + 1}
                    </p>
                    <div className="space-y-3">
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
                      <div className="max-w-sm">
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
                    </div>
                    {(q.questionType === 'multiple_choice' || q.questionType === 'true_false') && (
                      <div className="mt-5 space-y-4">
                        <div className="space-y-1">
                          <p className="text-sm font-medium text-slate-800">Choices</p>
                          <p className="text-xs text-slate-500">
                            Use the circle to mark the correct answer (optional).
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg bg-slate-50/90 px-3 py-2.5 text-xs text-slate-600">
                          <label className="inline-flex cursor-pointer items-center gap-2">
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
                              className={`relative h-5 w-9 shrink-0 rounded-full transition ${
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
                          <label className="inline-flex cursor-pointer items-center gap-2">
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
                              className={`relative h-5 w-9 shrink-0 rounded-full transition ${
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
                              className="group flex items-center gap-2 rounded-lg border border-transparent py-0.5 pl-0.5 pr-1 transition-colors hover:border-slate-100 hover:bg-slate-50/60"
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
                                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition hover:border-slate-300"
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
                                className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-400/30"
                              />
                              <button
                                type="button"
                                disabled={q.choices.length <= 1}
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
                                title={
                                  q.choices.length <= 1 ? 'At least one choice is required' : 'Delete option'
                                }
                                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 opacity-0 transition hover:bg-rose-50 hover:text-rose-700 focus-visible:opacity-100 enabled:group-hover:opacity-100 enabled:group-focus-within:opacity-100 disabled:invisible disabled:pointer-events-none"
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
                          className="inline-flex items-center gap-1.5 text-sm font-medium text-indigo-600 transition hover:text-indigo-700"
                        >
                          <Plus className="h-4 w-4" aria-hidden />
                          Add option
                        </button>
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
                    <div className="mt-4 flex flex-wrap items-center gap-4 border-t border-slate-100 pt-4">
                      <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-slate-600">
                        <input
                          type="checkbox"
                          checked={q.required}
                          onChange={(e) =>
                            setQuestionsDraft((prev) =>
                              prev.map((it) => (it.id === q.id ? { ...it, required: e.target.checked } : it)),
                            )
                          }
                          className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500/30"
                        />
                        Required
                      </label>
                    </div>
                  </div>
                ))
                : null}

              {!qeAdaptiveOn ? (
                <button
                  type="button"
                  onClick={() => setQuestionsDraft((prev) => [...prev, makeQuestion()])}
                  className="mt-4 inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-slate-50"
                >
                  <Plus className="h-4 w-4" />
                  Add question
                </button>
              ) : null}
              {questionsError && (
                <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                  {questionsError}
                </p>
              )}
              </div>
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
