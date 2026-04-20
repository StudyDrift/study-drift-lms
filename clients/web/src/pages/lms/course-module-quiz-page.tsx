import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Check, ChevronDown, Eye, Pencil, Plus, Sparkles, Trash2, X } from 'lucide-react'
import { ContentPageReader } from '../../components/content-page/content-page-reader'
import { SyllabusBlockEditor } from '../../components/syllabus/syllabus-block-editor'
import { markdownToSectionsForEditor, sectionsToMarkdown } from '../../components/syllabus/syllabus-section-markdown'
import { usePermissions } from '../../context/use-permissions'
import {
  fetchCourseQuestion,
  fetchCourseQuestions,
  defaultQuizAdvancedSettings,
  fetchCourse,
  fetchCourseGradingSettings,
  fetchCourseStructure,
  fetchModuleQuiz,
  fetchQuizFocusLossEvents,
  fetchReaderMarkups,
  generateModuleQuizQuestions,
  patchCourseStructureItemAssignmentGroup,
  patchModuleQuiz,
  quizAdvancedSettingsFromPayload,
  type ContentPageMarkup,
  type CourseStructureItem,
  type BankQuestionRow,
  type LockdownMode,
  type ModuleQuizPayload,
  type QuizAdvancedSettings,
  type QuizQuestion,
  type SyllabusSection,
} from '../../lib/courses-api'
import { type ResolvedMarkdownTheme, resolveMarkdownTheme } from '../../lib/markdown-theme'
import { permCourseItemCreate, permCourseItemsCreate } from '../../lib/rbac-api'
import { CourseItemPromptEditor } from '../../components/course-item-prompt-editor'
import { expandQuizPromptWithRefs } from '../../lib/course-item-ref-tokens'
import { QuizPageSettingsPanel } from '../../components/quiz/quiz-page-settings-panel'
import { QuizStudentPreviewModal } from '../../components/quiz/quiz-student-preview-modal'
import { QuizStudentTakePanel } from '../../components/quiz/quiz-student-take-panel'
import {
  assignmentGroupDisplayName,
  bankDetailToQuizQuestion,
  datetimeLocalValueToIso,
  defaultTypeConfigFor,
  formatGradePolicyShort,
  formatItemPointsWorth,
  formatLockdownModeLabel,
  formatQuizDateTime,
  isoToDatetimeLocalValue,
  makeQuestion,
  newLocalId,
  QUESTION_TYPE_OPTIONS,
  quizDateTimeIsSet,
  structureKindLabel,
  type QuestionType,
} from './course-module-quiz-utils'
import { LmsPage } from './lms-page'

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
  const canEditQuizItems = Boolean(
    courseCode && itemId && !permLoading && allows(permCourseItemsCreate(courseCode)),
  )

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
  const [markups, setMarkups] = useState<ContentPageMarkup[]>([])
  const [editingContent, setEditingContent] = useState(false)
  const [draft, setDraft] = useState<SyllabusSection[]>([])
  const [draftTitle, setDraftTitle] = useState('')
  const quizTitleFieldId = useId()
  const [draftDueLocal, setDraftDueLocal] = useState('')
  const [draftAvailableFromLocal, setDraftAvailableFromLocal] = useState('')
  const [draftAvailableUntilLocal, setDraftAvailableUntilLocal] = useState('')
  const [draftUnlimitedAttempts, setDraftUnlimitedAttempts] = useState(false)
  const [draftOneQuestionAtATime, setDraftOneQuestionAtATime] = useState(false)
  const [courseLockdownEnabled, setCourseLockdownEnabled] = useState(false)
  const [lockdownMode, setLockdownMode] = useState<LockdownMode>('standard')
  const [draftLockdownMode, setDraftLockdownMode] = useState<LockdownMode>('standard')
  const [focusLossThreshold, setFocusLossThreshold] = useState<number | null>(null)
  const [draftFocusLossThreshold, setDraftFocusLossThreshold] = useState<number | null>(null)
  const [focusInspectAttemptId, setFocusInspectAttemptId] = useState('')
  const [focusInspectLoading, setFocusInspectLoading] = useState(false)
  const [focusInspectError, setFocusInspectError] = useState<string | null>(null)
  const [focusInspectData, setFocusInspectData] = useState<{
    events: { id: string; eventType: string; createdAt: string; durationMs?: number | null }[]
    total: number
  } | null>(null)
  const [pointsWorth, setPointsWorth] = useState<number | null>(null)
  const [draftPointsWorth, setDraftPointsWorth] = useState<number | null>(null)
  const [gradingGroups, setGradingGroups] = useState<{ id: string; name: string }[]>([])
  const [assignmentGroupId, setAssignmentGroupId] = useState<string | null>(null)
  const [assignmentGroupPatching, setAssignmentGroupPatching] = useState(false)
  const [assignmentGroupPatchError, setAssignmentGroupPatchError] = useState<string | null>(null)
  const [quizAdvanced, setQuizAdvanced] = useState<QuizAdvancedSettings>(() => defaultQuizAdvancedSettings())
  const [draftQuizAdvanced, setDraftQuizAdvanced] = useState<QuizAdvancedSettings>(() => defaultQuizAdvancedSettings())
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [questionsOpen, setQuestionsOpen] = useState(false)
  const [questionsDraft, setQuestionsDraft] = useState<QuizQuestion[]>([])
  const [questionsSaving, setQuestionsSaving] = useState(false)
  const [questionsError, setQuestionsError] = useState<string | null>(null)
  const [importQuestionsOpen, setImportQuestionsOpen] = useState(false)
  const [importQuestionsLoading, setImportQuestionsLoading] = useState(false)
  const [importQuestionsError, setImportQuestionsError] = useState<string | null>(null)
  const [importQuestionsQuery, setImportQuestionsQuery] = useState('')
  const [importQuestionsType, setImportQuestionsType] = useState('all')
  const [importRows, setImportRows] = useState<BankQuestionRow[]>([])
  const [selectedImportQuestionId, setSelectedImportQuestionId] = useState<string | null>(null)
  const [importingQuestionId, setImportingQuestionId] = useState<string | null>(null)
  const [importPopoverPos, setImportPopoverPos] = useState<{ top: number; left: number; width: number } | null>(
    null,
  )
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
  const [studentQuizPayload, setStudentQuizPayload] = useState<ModuleQuizPayload | null>(null)
  const [studentTakeOpen, setStudentTakeOpen] = useState(false)
  const [studentQuizBanner, setStudentQuizBanner] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [mdTheme, setMdTheme] = useState<ResolvedMarkdownTheme>(() =>
    resolveMarkdownTheme('classic', null),
  )

  const quizMarkupTarget = useMemo(() => ({ variant: 'quiz' as const, itemId: itemId! }), [itemId])

  const loadMarkups = useCallback(async () => {
    if (!courseCode || !itemId) return
    try {
      const list = await fetchReaderMarkups(courseCode, quizMarkupTarget)
      setMarkups(list)
    } catch {
      setMarkups([])
    }
  }, [courseCode, itemId, quizMarkupTarget])

  const load = useCallback(async () => {
    if (!courseCode || !itemId) return
    setLoading(true)
    setLoadError(null)
    try {
      const [data, courseRow] = await Promise.all([fetchModuleQuiz(courseCode, itemId), fetchCourse(courseCode)])
      setAssignmentGroupId(data.assignmentGroupId ?? null)
      setAssignmentGroupPatchError(null)
      try {
        const grading = await fetchCourseGradingSettings(courseCode)
        setGradingGroups(
          grading.assignmentGroups.filter((g) => g.id.trim()).map((g) => ({ id: g.id, name: g.name })),
        )
      } catch {
        setGradingGroups([])
      }
      setTitle(data.title)
      setMarkdown(data.markdown)
      setDueAt(data.dueAt)
      setAvailableFromAt(data.availableFrom ?? null)
      setAvailableUntilAt(data.availableUntil ?? null)
      setUnlimitedAttempts(Boolean(data.unlimitedAttempts))
      setOneQuestionAtATime(Boolean(data.oneQuestionAtATime))
      setPointsWorth(data.pointsWorth ?? null)
      setDraftPointsWorth(data.pointsWorth ?? null)
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
      setStudentQuizPayload(data)
      setCourseLockdownEnabled(courseRow.lockdownModeEnabled === true)
      setLockdownMode(data.lockdownMode)
      setDraftLockdownMode(data.lockdownMode)
      const lossTh = data.focusLossThreshold
      setFocusLossThreshold(typeof lossTh === 'number' ? lossTh : null)
      setDraftFocusLossThreshold(typeof lossTh === 'number' ? lossTh : null)
      setMdTheme(resolveMarkdownTheme(courseRow.markdownThemePreset, courseRow.markdownThemeCustom))
      void loadMarkups()
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not load this quiz.')
      setTitle('')
      setMarkdown('')
      setDueAt(null)
      setAvailableFromAt(null)
      setAvailableUntilAt(null)
      setUnlimitedAttempts(false)
      setOneQuestionAtATime(false)
      setPointsWorth(null)
      setDraftPointsWorth(null)
      const blankAdv = defaultQuizAdvancedSettings()
      setQuizAdvanced(blankAdv)
      setDraftQuizAdvanced(blankAdv)
      setUpdatedAt(null)
      setQuestions([])
      setIsAdaptive(false)
      setAdaptiveSystemPrompt('')
      setAdaptiveSourceItemIds([])
      setAdaptiveQuestionCount(5)
      setGradingGroups([])
      setAssignmentGroupId(null)
      setMarkups([])
      setStudentQuizPayload(null)
      setCourseLockdownEnabled(false)
      setLockdownMode('standard')
      setDraftLockdownMode('standard')
      setFocusLossThreshold(null)
      setDraftFocusLossThreshold(null)
    } finally {
      setLoading(false)
    }
  }, [courseCode, itemId, loadMarkups])

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

  useEffect(() => {
    if (!generateModalOpen) return
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      if (generateBusy) return
      e.preventDefault()
      setGenerateModalOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [generateModalOpen, generateBusy])

  useEffect(() => {
    if (!questionsOpen) return
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      if (questionsSaving) return
      e.preventDefault()
      setQuestionsOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [questionsOpen, questionsSaving])

  useEffect(() => {
    if (!importQuestionsOpen) return
    function onDocMouseDown(e: MouseEvent) {
      const target = e.target as Node
      if (importDropdownRef.current?.contains(target)) return
      if (importButtonRef.current?.contains(target)) return
      setImportQuestionsOpen(false)
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [importQuestionsOpen])

  useEffect(() => {
    if (!importQuestionsOpen) return
    function positionImportPopover() {
      const anchor = importButtonRef.current
      if (!anchor) return
      const rect = anchor.getBoundingClientRect()
      const width = Math.min(704, Math.max(320, window.innerWidth - 24))
      const left = Math.min(Math.max(12, rect.right - width), Math.max(12, window.innerWidth - width - 12))
      const top = Math.max(12, rect.top - 8)
      setImportPopoverPos({ top, left, width })
    }
    positionImportPopover()
    window.addEventListener('resize', positionImportPopover)
    window.addEventListener('scroll', positionImportPopover, true)
    return () => {
      window.removeEventListener('resize', positionImportPopover)
      window.removeEventListener('scroll', positionImportPopover, true)
    }
  }, [importQuestionsOpen])

  const quizActionsRef = useRef<HTMLDivElement>(null)
  const quizSummaryAsideRef = useRef<HTMLElement>(null)
  const importDropdownRef = useRef<HTMLDivElement>(null)
  const importButtonRef = useRef<HTMLButtonElement>(null)

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
    lockdownMode,
    focusLossThreshold,
    courseLockdownEnabled,
    pointsWorth,
    assignmentGroupId,
    gradingGroups,
    updatedAt,
  ])

  function beginEditContent() {
    setSaveError(null)
    setAssignmentGroupPatchError(null)
    setDraft(markdownToSectionsForEditor(markdown, newLocalId))
    setDraftTitle(title)
    setDraftDueLocal(isoToDatetimeLocalValue(dueAt))
    setDraftAvailableFromLocal(isoToDatetimeLocalValue(availableFromAt))
    setDraftAvailableUntilLocal(isoToDatetimeLocalValue(availableUntilAt))
    setDraftUnlimitedAttempts(unlimitedAttempts)
    setDraftOneQuestionAtATime(oneQuestionAtATime)
    setDraftLockdownMode(lockdownMode)
    setDraftFocusLossThreshold(focusLossThreshold)
    setDraftPointsWorth(pointsWorth)
    setDraftQuizAdvanced(quizAdvanced)
    setEditingContent(true)
  }

  function cancelEditContent() {
    setSaveError(null)
    setAssignmentGroupPatchError(null)
    setEditingContent(false)
    setDraft([])
    setDraftTitle(title)
    setDraftDueLocal(isoToDatetimeLocalValue(dueAt))
    setDraftAvailableFromLocal(isoToDatetimeLocalValue(availableFromAt))
    setDraftAvailableUntilLocal(isoToDatetimeLocalValue(availableUntilAt))
    setDraftUnlimitedAttempts(unlimitedAttempts)
    setDraftOneQuestionAtATime(oneQuestionAtATime)
    setDraftLockdownMode(lockdownMode)
    setDraftFocusLossThreshold(focusLossThreshold)
    setDraftPointsWorth(pointsWorth)
    setDraftQuizAdvanced(quizAdvanced)
  }

  async function onQuizAssignmentGroupChange(next: string | null) {
    if (!courseCode || !itemId || !canEdit) return
    setAssignmentGroupPatchError(null)
    setAssignmentGroupPatching(true)
    try {
      const updated = await patchCourseStructureItemAssignmentGroup(courseCode, itemId, next)
      setAssignmentGroupId(updated.assignmentGroupId ?? null)
    } catch (e) {
      setAssignmentGroupPatchError(
        e instanceof Error ? e.message : 'Could not update assignment group.',
      )
    } finally {
      setAssignmentGroupPatching(false)
    }
  }

  async function loadFocusInspectEvents() {
    if (!courseCode || !itemId) return
    const id = focusInspectAttemptId.trim()
    if (!id) {
      setFocusInspectError('Enter an attempt id.')
      return
    }
    setFocusInspectLoading(true)
    setFocusInspectError(null)
    setFocusInspectData(null)
    try {
      const data = await fetchQuizFocusLossEvents(courseCode, itemId, id)
      setFocusInspectData(data)
    } catch (e) {
      setFocusInspectError(e instanceof Error ? e.message : 'Could not load events.')
    } finally {
      setFocusInspectLoading(false)
    }
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
        pointsWorth: draftPointsWorth,
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
        lockdownMode: draftLockdownMode,
        focusLossThreshold: draftFocusLossThreshold,
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
      setLockdownMode(data.lockdownMode)
      setDraftLockdownMode(data.lockdownMode)
      const thSaved = data.focusLossThreshold
      setFocusLossThreshold(typeof thSaved === 'number' ? thSaved : null)
      setDraftFocusLossThreshold(typeof thSaved === 'number' ? thSaved : null)
      setPointsWorth(data.pointsWorth ?? null)
      setDraftPointsWorth(data.pointsWorth ?? null)
      setAssignmentGroupId(data.assignmentGroupId ?? null)
      const adv = quizAdvancedSettingsFromPayload(data)
      setQuizAdvanced(adv)
      setDraftQuizAdvanced(adv)
      setUpdatedAt(data.updatedAt)
      setEditingContent(false)
      setDraft([])
      void loadMarkups()
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Could not save.')
    } finally {
      setSaving(false)
    }
  }

  function openQuestionsEditor() {
    if (!canEditQuizItems) return
    setQuestionsError(null)
    setQuestionsDraft(
      questions.map((q) => ({
        ...q,
        choices: [...q.choices],
        typeConfig: q.typeConfig ? { ...q.typeConfig } : {},
      })),
    )
    setQeAdaptiveOn(isAdaptive)
    setQeAdaptivePrompt(adaptiveSystemPrompt)
    setQeAdaptiveSources([...adaptiveSourceItemIds])
    setQeAdaptiveQuestionCount(adaptiveQuestionCount)
    setImportQuestionsOpen(false)
    setImportQuestionsError(null)
    setImportQuestionsQuery('')
    setImportQuestionsType('all')
    setSelectedImportQuestionId(null)
    setImportRows([])
    setQuestionsOpen(true)
  }

  async function loadBankQuestionsForImport(search: string) {
    if (!courseCode) return
    setImportQuestionsLoading(true)
    setImportQuestionsError(null)
    try {
      const rows = await fetchCourseQuestions(courseCode, {
        q: search.trim() || undefined,
        type: importQuestionsType !== 'all' ? importQuestionsType : undefined,
      })
      setImportRows(rows)
      if (!rows.some((row) => row.id === selectedImportQuestionId)) {
        setSelectedImportQuestionId(rows[0]?.id ?? null)
      }
    } catch (e) {
      setImportQuestionsError(e instanceof Error ? e.message : 'Could not load question bank items.')
      setImportRows([])
    } finally {
      setImportQuestionsLoading(false)
    }
  }

  function openImportQuestions() {
    if (!courseCode) return
    setImportQuestionsError(null)
    setImportQuestionsOpen((prev) => {
      const next = !prev
      if (next) void loadBankQuestionsForImport(importQuestionsQuery)
      return next
    })
  }

  async function importQuestionFromBank(questionId: string) {
    if (!courseCode) return
    setImportQuestionsError(null)
    setImportingQuestionId(questionId)
    try {
      const detail = await fetchCourseQuestion(courseCode, questionId)
      setQuestionsDraft((prev) => [...prev, bankDetailToQuizQuestion(detail)])
      setImportQuestionsOpen(false)
    } catch (e) {
      setImportQuestionsError(e instanceof Error ? e.message : 'Could not import this question.')
    } finally {
      setImportingQuestionId(null)
    }
  }

  async function saveQuestions() {
    if (!courseCode || !itemId || !canEditQuizItems) return
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
        setLockdownMode(data.lockdownMode)
        setDraftLockdownMode(data.lockdownMode)
        const thAdaptive = data.focusLossThreshold
        setFocusLossThreshold(typeof thAdaptive === 'number' ? thAdaptive : null)
        setDraftFocusLossThreshold(typeof thAdaptive === 'number' ? thAdaptive : null)
        setStudentQuizPayload(data)
        setPointsWorth(data.pointsWorth ?? null)
        setDraftPointsWorth(data.pointsWorth ?? null)
        setAssignmentGroupId(data.assignmentGroupId ?? null)
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
        setLockdownMode(data.lockdownMode)
        setDraftLockdownMode(data.lockdownMode)
        const thStatic = data.focusLossThreshold
        setFocusLossThreshold(typeof thStatic === 'number' ? thStatic : null)
        setDraftFocusLossThreshold(typeof thStatic === 'number' ? thStatic : null)
        setStudentQuizPayload(data)
        setPointsWorth(data.pointsWorth ?? null)
        setDraftPointsWorth(data.pointsWorth ?? null)
        setAssignmentGroupId(data.assignmentGroupId ?? null)
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
    if (!canEditQuizItems) return
    setGenerateError(null)
    setGeneratePrompt('')
    setGenerateCount(5)
    setGenerateModalOpen(true)
  }

  async function runGenerateQuestions() {
    if (!courseCode || !itemId || !canEditQuizItems) return
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

  function handleStudentStartQuiz() {
    if (!courseCode || !itemId) return
    setStudentQuizBanner(null)
    setStudentTakeOpen(true)
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
              canEditQuizItems ? (
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
              ) : null
            ) : (
              <button
                type="button"
                onClick={() => handleStudentStartQuiz()}
                disabled={loading}
                className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Start Quiz
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

      {!canEdit && studentQuizBanner ? (
        <p
          className={`mt-4 rounded-lg border px-4 py-3 text-sm ${
            studentQuizBanner.kind === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
              : 'border-rose-200 bg-rose-50 text-rose-800'
          }`}
          role="status"
        >
          {studentQuizBanner.text}
        </p>
      ) : null}

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
              <ContentPageReader
                markdown={markdown}
                theme={mdTheme}
                markups={markups}
                onMarkupsChange={loadMarkups}
                courseCode={courseCode}
                markupTarget={quizMarkupTarget}
                contentTitle={title || 'Quiz'}
                emptyMessage={
                  canEdit
                    ? 'No quiz intro yet. Open More, then Edit, to add details.'
                    : 'No quiz intro yet.'
                }
              />
            </div>
            <aside
              ref={quizSummaryAsideRef}
              className="shrink-0 lg:sticky lg:top-6 lg:w-72 lg:max-w-[min(100%,18rem)] xl:w-80 xl:max-w-[min(100%,20rem)]"
              aria-label="Quiz summary"
            >
              <div className="rounded-2xl border border-slate-200/90 bg-slate-50/70 p-4 dark:border-neutral-600 dark:bg-neutral-900/90">
                <p className="text-sm font-semibold text-slate-900 dark:text-neutral-100">
                  {isAdaptive
                    ? `Adaptive · up to ${adaptiveQuestionCount} generated questions`
                    : `${questions.length} ${questions.length === 1 ? 'question' : 'questions'}`}
                </p>
                <p className="mt-1 text-sm text-slate-600 dark:text-neutral-300">
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
                <dl className="mt-4 space-y-2 border-t border-slate-200/80 pt-3 text-sm dark:border-neutral-600">
                  {quizDateTimeIsSet(dueAt) ? (
                    <div className="flex justify-between gap-4">
                      <dt className="shrink-0 text-slate-500 dark:text-neutral-400">Due date</dt>
                      <dd className="min-w-0 text-right font-medium text-slate-900 dark:text-neutral-100">
                        {formatQuizDateTime(dueAt)}
                      </dd>
                    </div>
                  ) : null}
                  {quizDateTimeIsSet(availableFromAt) ? (
                    <div className="flex justify-between gap-4">
                      <dt className="shrink-0 text-slate-500 dark:text-neutral-400">Visibility start</dt>
                      <dd className="min-w-0 text-right font-medium text-slate-900 dark:text-neutral-100">
                        {formatQuizDateTime(availableFromAt)}
                      </dd>
                    </div>
                  ) : null}
                  {quizDateTimeIsSet(availableUntilAt) ? (
                    <div className="flex justify-between gap-4">
                      <dt className="shrink-0 text-slate-500 dark:text-neutral-400">Visibility end</dt>
                      <dd className="min-w-0 text-right font-medium text-slate-900 dark:text-neutral-100">
                        {formatQuizDateTime(availableUntilAt)}
                      </dd>
                    </div>
                  ) : null}
                  <div className="flex justify-between gap-4">
                    <dt className="shrink-0 text-slate-500 dark:text-neutral-400">Unlimited attempts</dt>
                    <dd className="min-w-0 text-right font-medium text-slate-900 dark:text-neutral-100">
                      {unlimitedAttempts ? 'Yes' : 'No'}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="shrink-0 text-slate-500 dark:text-neutral-400">One question at a time</dt>
                    <dd className="min-w-0 text-right font-medium text-slate-900 dark:text-neutral-100">
                      {oneQuestionAtATime ? 'Yes' : 'No'}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="shrink-0 text-slate-500 dark:text-neutral-400">Course lockdown feature</dt>
                    <dd className="min-w-0 text-right font-medium text-slate-900 dark:text-neutral-100">
                      {courseLockdownEnabled ? 'On' : 'Off'}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="shrink-0 text-slate-500 dark:text-neutral-400">Delivery mode</dt>
                    <dd className="min-w-0 text-right font-medium text-slate-900 dark:text-neutral-100">
                      {formatLockdownModeLabel(lockdownMode)}
                    </dd>
                  </div>
                  {lockdownMode === 'kiosk' ? (
                    <div className="flex justify-between gap-4">
                      <dt className="shrink-0 text-slate-500 dark:text-neutral-400">Focus-loss threshold</dt>
                      <dd className="min-w-0 text-right font-medium text-slate-900 dark:text-neutral-100">
                        {focusLossThreshold != null ? String(focusLossThreshold) : 'None'}
                      </dd>
                    </div>
                  ) : null}
                  {!courseLockdownEnabled && lockdownMode !== 'standard' ? (
                    <p className="text-xs leading-snug text-amber-800 dark:text-amber-200/90">
                      This quiz is set to {formatLockdownModeLabel(lockdownMode).toLowerCase()}, but the course
                      lockdown feature is off, so learners currently get standard delivery.
                    </p>
                  ) : null}
                  {!unlimitedAttempts ? (
                    <div className="flex justify-between gap-4">
                      <dt className="shrink-0 text-slate-500 dark:text-neutral-400">Max attempts</dt>
                      <dd className="min-w-0 text-right font-medium text-slate-900 dark:text-neutral-100">
                        {quizAdvanced.maxAttempts}
                      </dd>
                    </div>
                  ) : null}
                  <div className="flex justify-between gap-4">
                    <dt className="shrink-0 text-slate-500 dark:text-neutral-400">Grade uses</dt>
                    <dd className="min-w-0 text-right font-medium text-slate-900 dark:text-neutral-100">
                      {formatGradePolicyShort(quizAdvanced.gradeAttemptPolicy)}
                    </dd>
                  </div>
                  {pointsWorth != null ? (
                    <div className="flex justify-between gap-4">
                      <dt className="shrink-0 text-slate-500 dark:text-neutral-400">Points</dt>
                      <dd className="min-w-0 text-right font-medium text-slate-900 dark:text-neutral-100">
                        {formatItemPointsWorth(pointsWorth)}
                      </dd>
                    </div>
                  ) : null}
                  {assignmentGroupId ? (
                    <div className="flex justify-between gap-4">
                      <dt className="shrink-0 text-slate-500 dark:text-neutral-400">Assignment group</dt>
                      <dd className="min-w-0 text-right font-medium text-slate-900 dark:text-neutral-100">
                        {assignmentGroupDisplayName(assignmentGroupId, gradingGroups)}
                      </dd>
                    </div>
                  ) : null}
                  {quizAdvanced.passingScorePercent != null ? (
                    <div className="flex justify-between gap-4">
                      <dt className="shrink-0 text-slate-500 dark:text-neutral-400">Passing score</dt>
                      <dd className="min-w-0 text-right font-medium text-slate-900 dark:text-neutral-100">
                        {`${quizAdvanced.passingScorePercent}%`}
                      </dd>
                    </div>
                  ) : null}
                  {quizAdvanced.timeLimitMinutes != null ? (
                    <div className="flex justify-between gap-4">
                      <dt className="shrink-0 text-slate-500 dark:text-neutral-400">Time limit</dt>
                      <dd className="min-w-0 text-right font-medium text-slate-900 dark:text-neutral-100">
                        {`${quizAdvanced.timeLimitMinutes} min`}
                      </dd>
                    </div>
                  ) : null}
                  <div className="flex justify-between gap-4">
                    <dt className="shrink-0 text-slate-500 dark:text-neutral-400">Shuffle questions</dt>
                    <dd className="min-w-0 text-right font-medium text-slate-900 dark:text-neutral-100">
                      {quizAdvanced.shuffleQuestions ? 'Yes' : 'No'}
                    </dd>
                  </div>
                  {quizAdvanced.requiresQuizAccessCode ? (
                    <div className="flex justify-between gap-4">
                      <dt className="shrink-0 text-slate-500 dark:text-neutral-400">Access code</dt>
                      <dd className="min-w-0 text-right font-medium text-slate-900 dark:text-neutral-100">Required</dd>
                    </div>
                  ) : null}
                  {isAdaptive ? (
                    <div className="flex justify-between gap-4">
                      <dt className="shrink-0 text-slate-500 dark:text-neutral-400">Adaptive difficulty</dt>
                      <dd className="min-w-0 text-right font-medium capitalize text-slate-900 dark:text-neutral-100">
                        {quizAdvanced.adaptiveDifficulty}
                      </dd>
                    </div>
                  ) : null}
                </dl>
              </div>
              {canEdit && courseLockdownEnabled && lockdownMode === 'kiosk' && !isAdaptive ? (
                <div className="mt-4 rounded-2xl border border-slate-200/90 bg-white p-4 dark:border-neutral-600 dark:bg-neutral-950/80">
                  <p className="text-sm font-semibold text-slate-900 dark:text-neutral-100">
                    Kiosk focus-loss log
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-neutral-400">
                    Enter a learner attempt id to list recorded tab or window events (instructors only).
                  </p>
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                    <input
                      type="text"
                      value={focusInspectAttemptId}
                      onChange={(e) => setFocusInspectAttemptId(e.target.value)}
                      placeholder="Attempt UUID"
                      className="min-w-0 flex-1 rounded-lg border border-slate-200 px-2.5 py-2 font-mono text-xs text-slate-900 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100"
                      spellCheck={false}
                    />
                    <button
                      type="button"
                      onClick={() => void loadFocusInspectEvents()}
                      disabled={focusInspectLoading}
                      className="shrink-0 rounded-lg bg-slate-800 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-50 dark:bg-neutral-200 dark:text-neutral-900 dark:hover:bg-white"
                    >
                      {focusInspectLoading ? 'Loading…' : 'Load events'}
                    </button>
                  </div>
                  {focusInspectError ? (
                    <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">{focusInspectError}</p>
                  ) : null}
                  {focusInspectData ? (
                    <div className="mt-3">
                      <p className="text-xs font-medium text-slate-600 dark:text-neutral-300">
                        {focusInspectData.total} event{focusInspectData.total === 1 ? '' : 's'}
                      </p>
                      <ul className="mt-2 max-h-48 space-y-1.5 overflow-y-auto text-[11px] leading-snug text-slate-700 dark:text-neutral-300">
                        {focusInspectData.events.map((ev) => (
                          <li
                            key={ev.id}
                            className="rounded border border-slate-100 bg-slate-50/80 px-2 py-1.5 dark:border-neutral-800 dark:bg-neutral-900/60"
                          >
                            <span className="font-mono text-slate-500 dark:text-neutral-500">
                              {new Date(ev.createdAt).toLocaleString()}
                            </span>{' '}
                            <span className="font-medium">{ev.eventType}</span>
                            {ev.durationMs != null ? (
                              <span className="text-slate-500 dark:text-neutral-500">
                                {' '}
                                ({ev.durationMs} ms)
                              </span>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ) : null}
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
          {assignmentGroupPatchError && (
            <p className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-6 py-3 text-sm text-rose-800 md:px-8">
              {assignmentGroupPatchError}
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
                    pointsWorth={draftPointsWorth}
                    onPointsWorthChange={setDraftPointsWorth}
                    gradingGroups={gradingGroups}
                    assignmentGroupId={assignmentGroupId}
                    onAssignmentGroupChange={(gid) => void onQuizAssignmentGroupChange(gid)}
                    assignmentGroupSelectDisabled={assignmentGroupPatching}
                    advanced={draftQuizAdvanced}
                    onAdvancedChange={setDraftQuizAdvanced}
                    showAdaptiveSection={isAdaptive}
                    courseCode={courseCode}
                    quizItemId={itemId}
                    quizOutcomesQuestions={questions.map((q) => ({ id: q.id, prompt: q.prompt }))}
                    lockdownDeliveryEnabled={courseLockdownEnabled}
                    lockdownMode={draftLockdownMode}
                    onLockdownModeChange={(mode) => {
                      setDraftLockdownMode(mode)
                      if (mode === 'kiosk' || mode === 'one_at_a_time') {
                        setDraftOneQuestionAtATime(true)
                        setDraftQuizAdvanced((prev) => ({ ...prev, allowBackNavigation: false }))
                      }
                    }}
                    focusLossThreshold={draftFocusLossThreshold}
                    onFocusLossThresholdChange={setDraftFocusLossThreshold}
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

      {studentQuizPayload && courseCode && itemId ? (
        <QuizStudentTakePanel
          open={studentTakeOpen}
          onClose={() => setStudentTakeOpen(false)}
          courseCode={courseCode}
          itemId={itemId}
          quiz={studentQuizPayload}
          advanced={quizAdvanced}
          oneQuestionAtATime={oneQuestionAtATime}
          allowBackNavigation={quizAdvanced.allowBackNavigation}
        />
      ) : null}

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
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Question {index + 1}
                      </p>
                      <button
                        type="button"
                        onClick={() =>
                          setQuestionsDraft((prev) => prev.filter((it) => it.id !== q.id))
                        }
                        className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium text-rose-700 transition hover:bg-rose-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden />
                        Remove
                      </button>
                    </div>
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
                                      typeConfig:
                                        it.questionType === nextType
                                          ? (it.typeConfig ?? {})
                                          : defaultTypeConfigFor(nextType),
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
                    {q.questionType === 'ordering' && (
                      <div className="mt-4 space-y-2">
                        <p className="text-sm font-medium text-slate-800">Ordering items</p>
                        {(
                          Array.isArray(q.typeConfig?.items)
                            ? q.typeConfig.items.map((x) => String(x))
                            : []
                        ).map((item, itemIdx) => (
                          <div key={`${q.id}-ordering-${itemIdx}`} className="flex items-center gap-2">
                            <input
                              type="text"
                              value={item}
                              onChange={(e) =>
                                setQuestionsDraft((prev) =>
                                  prev.map((it) => {
                                    if (it.id !== q.id) return it
                                    const items = Array.isArray(it.typeConfig?.items)
                                      ? it.typeConfig.items.map((x) => String(x))
                                      : []
                                    const nextItems = items.map((x, i) => (i === itemIdx ? e.target.value : x))
                                    return { ...it, typeConfig: { ...(it.typeConfig ?? {}), items: nextItems } }
                                  }),
                                )
                              }
                              placeholder={`Ordering item ${itemIdx + 1}`}
                              className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-400/30"
                            />
                            <button
                              type="button"
                              onClick={() =>
                                setQuestionsDraft((prev) =>
                                  prev.map((it) => {
                                    if (it.id !== q.id) return it
                                    const items = Array.isArray(it.typeConfig?.items)
                                      ? it.typeConfig.items.map((x) => String(x))
                                      : []
                                    const nextItems = items.filter((_, i) => i !== itemIdx)
                                    return { ...it, typeConfig: { ...(it.typeConfig ?? {}), items: nextItems } }
                                  }),
                                )
                              }
                              className="rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
                            >
                              Remove
                            </button>
                          </div>
                        ))}
                        <button
                          type="button"
                          onClick={() =>
                            setQuestionsDraft((prev) =>
                              prev.map((it) => {
                                if (it.id !== q.id) return it
                                const items = Array.isArray(it.typeConfig?.items)
                                  ? it.typeConfig.items.map((x) => String(x))
                                  : []
                                return {
                                  ...it,
                                  typeConfig: { ...(it.typeConfig ?? {}), items: [...items, ''] },
                                }
                              }),
                            )
                          }
                          className="inline-flex items-center gap-1.5 text-sm font-medium text-indigo-600 transition hover:text-indigo-700"
                        >
                          <Plus className="h-4 w-4" aria-hidden />
                          Add ordering item
                        </button>
                      </div>
                    )}
                    {q.questionType === 'numeric' && (
                      <div className="mt-4 grid gap-3 md:grid-cols-3">
                        <label className="text-xs text-slate-600">
                          Correct value
                          <input
                            type="number"
                            step="any"
                            value={String((q.typeConfig?.correct as number | undefined) ?? '')}
                            onChange={(e) =>
                              setQuestionsDraft((prev) =>
                                prev.map((it) =>
                                  it.id === q.id
                                    ? {
                                        ...it,
                                        typeConfig: {
                                          ...(it.typeConfig ?? {}),
                                          correct:
                                            e.target.value.trim() === '' ? undefined : Number(e.target.value),
                                        },
                                      }
                                    : it,
                                ),
                              )
                            }
                            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                          />
                        </label>
                        <label className="text-xs text-slate-600">
                          Tolerance (+/-)
                          <input
                            type="number"
                            step="any"
                            value={String((q.typeConfig?.toleranceAbs as number | undefined) ?? '')}
                            onChange={(e) =>
                              setQuestionsDraft((prev) =>
                                prev.map((it) =>
                                  it.id === q.id
                                    ? {
                                        ...it,
                                        typeConfig: {
                                          ...(it.typeConfig ?? {}),
                                          toleranceAbs:
                                            e.target.value.trim() === '' ? undefined : Number(e.target.value),
                                        },
                                      }
                                    : it,
                                ),
                              )
                            }
                            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                          />
                        </label>
                        <label className="text-xs text-slate-600">
                          Unit (optional)
                          <input
                            type="text"
                            value={String((q.typeConfig?.unit as string | undefined) ?? '')}
                            onChange={(e) =>
                              setQuestionsDraft((prev) =>
                                prev.map((it) =>
                                  it.id === q.id
                                    ? {
                                        ...it,
                                        typeConfig: { ...(it.typeConfig ?? {}), unit: e.target.value },
                                      }
                                    : it,
                                ),
                              )
                            }
                            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                          />
                        </label>
                      </div>
                    )}
                    {q.questionType === 'code' && (
                      <div className="mt-4 space-y-3">
                        <label className="block text-xs text-slate-600">
                          Language
                          <input
                            type="text"
                            value={String((q.typeConfig?.language as string | undefined) ?? 'javascript')}
                            onChange={(e) =>
                              setQuestionsDraft((prev) =>
                                prev.map((it) =>
                                  it.id === q.id
                                    ? {
                                        ...it,
                                        typeConfig: { ...(it.typeConfig ?? {}), language: e.target.value },
                                      }
                                    : it,
                                ),
                              )
                            }
                            className="mt-1 w-full max-w-xs rounded-lg border border-slate-200 px-3 py-2 text-sm"
                          />
                        </label>
                        <label className="block text-xs text-slate-600">
                          Starter code (optional)
                          <textarea
                            rows={6}
                            value={String((q.typeConfig?.starterCode as string | undefined) ?? '')}
                            onChange={(e) =>
                              setQuestionsDraft((prev) =>
                                prev.map((it) =>
                                  it.id === q.id
                                    ? {
                                        ...it,
                                        typeConfig: { ...(it.typeConfig ?? {}), starterCode: e.target.value },
                                      }
                                    : it,
                                ),
                              )
                            }
                            className="mt-1 w-full resize-y rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm"
                          />
                        </label>
                        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Test cases</p>
                          <div className="mt-2 space-y-3">
                            {(Array.isArray(q.typeConfig?.testCases) ? q.typeConfig.testCases : []).map((tc, tcIdx) => {
                              const t = tc as {
                                input?: string
                                expectedOutput?: string
                                isHidden?: boolean
                                timeLimitMs?: number
                                memoryLimitKb?: number
                              }
                              return (
                                <div key={`${q.id}-code-tc-${tcIdx}`} className="rounded-md border border-slate-200 bg-white p-2">
                                  <div className="grid gap-2 md:grid-cols-2">
                                    <label className="text-xs text-slate-600">
                                      Input
                                      <textarea
                                        rows={3}
                                        value={t.input ?? ''}
                                        onChange={(e) =>
                                          setQuestionsDraft((prev) =>
                                            prev.map((it) => {
                                              if (it.id !== q.id) return it
                                              const testCases = (
                                                Array.isArray(it.typeConfig?.testCases) ? it.typeConfig.testCases : []
                                              ).map((x) => ({ ...(x as Record<string, unknown>) }))
                                              testCases[tcIdx] = { ...(testCases[tcIdx] ?? {}), input: e.target.value }
                                              return { ...it, typeConfig: { ...(it.typeConfig ?? {}), testCases } }
                                            }),
                                          )
                                        }
                                        className="mt-1 w-full resize-y rounded-lg border border-slate-200 px-2 py-1.5 font-mono text-xs"
                                      />
                                    </label>
                                    <label className="text-xs text-slate-600">
                                      Expected output
                                      <textarea
                                        rows={3}
                                        value={t.expectedOutput ?? ''}
                                        onChange={(e) =>
                                          setQuestionsDraft((prev) =>
                                            prev.map((it) => {
                                              if (it.id !== q.id) return it
                                              const testCases = (
                                                Array.isArray(it.typeConfig?.testCases) ? it.typeConfig.testCases : []
                                              ).map((x) => ({ ...(x as Record<string, unknown>) }))
                                              testCases[tcIdx] = { ...(testCases[tcIdx] ?? {}), expectedOutput: e.target.value }
                                              return { ...it, typeConfig: { ...(it.typeConfig ?? {}), testCases } }
                                            }),
                                          )
                                        }
                                        className="mt-1 w-full resize-y rounded-lg border border-slate-200 px-2 py-1.5 font-mono text-xs"
                                      />
                                    </label>
                                  </div>
                                  <div className="mt-2 grid gap-2 md:grid-cols-3">
                                    <label className="inline-flex items-center gap-2 text-xs text-slate-600">
                                      <input
                                        type="checkbox"
                                        checked={Boolean(t.isHidden)}
                                        onChange={(e) =>
                                          setQuestionsDraft((prev) =>
                                            prev.map((it) => {
                                              if (it.id !== q.id) return it
                                              const testCases = (
                                                Array.isArray(it.typeConfig?.testCases) ? it.typeConfig.testCases : []
                                              ).map((x) => ({ ...(x as Record<string, unknown>) }))
                                              testCases[tcIdx] = { ...(testCases[tcIdx] ?? {}), isHidden: e.target.checked }
                                              return { ...it, typeConfig: { ...(it.typeConfig ?? {}), testCases } }
                                            }),
                                          )
                                        }
                                      />
                                      Hidden
                                    </label>
                                    <label className="text-xs text-slate-600">
                                      Time limit (ms)
                                      <input
                                        type="number"
                                        min={100}
                                        value={String(t.timeLimitMs ?? 2000)}
                                        onChange={(e) =>
                                          setQuestionsDraft((prev) =>
                                            prev.map((it) => {
                                              if (it.id !== q.id) return it
                                              const testCases = (
                                                Array.isArray(it.typeConfig?.testCases) ? it.typeConfig.testCases : []
                                              ).map((x) => ({ ...(x as Record<string, unknown>) }))
                                              testCases[tcIdx] = {
                                                ...(testCases[tcIdx] ?? {}),
                                                timeLimitMs: Number(e.target.value) || 2000,
                                              }
                                              return { ...it, typeConfig: { ...(it.typeConfig ?? {}), testCases } }
                                            }),
                                          )
                                        }
                                        className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
                                      />
                                    </label>
                                    <label className="text-xs text-slate-600">
                                      Memory (KB)
                                      <input
                                        type="number"
                                        min={1024}
                                        value={String(t.memoryLimitKb ?? 262144)}
                                        onChange={(e) =>
                                          setQuestionsDraft((prev) =>
                                            prev.map((it) => {
                                              if (it.id !== q.id) return it
                                              const testCases = (
                                                Array.isArray(it.typeConfig?.testCases) ? it.typeConfig.testCases : []
                                              ).map((x) => ({ ...(x as Record<string, unknown>) }))
                                              testCases[tcIdx] = {
                                                ...(testCases[tcIdx] ?? {}),
                                                memoryLimitKb: Number(e.target.value) || 262144,
                                              }
                                              return { ...it, typeConfig: { ...(it.typeConfig ?? {}), testCases } }
                                            }),
                                          )
                                        }
                                        className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
                                      />
                                    </label>
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              setQuestionsDraft((prev) =>
                                prev.map((it) => {
                                  if (it.id !== q.id) return it
                                  const testCases = (Array.isArray(it.typeConfig?.testCases) ? it.typeConfig.testCases : []).map(
                                    (x) => ({ ...(x as Record<string, unknown>) }),
                                  )
                                  testCases.push({
                                    input: '',
                                    expectedOutput: '',
                                    isHidden: false,
                                    timeLimitMs: 2000,
                                    memoryLimitKb: 262144,
                                  })
                                  return { ...it, typeConfig: { ...(it.typeConfig ?? {}), testCases } }
                                }),
                              )
                            }
                            className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                          >
                            <Plus className="h-3.5 w-3.5" aria-hidden />
                            Add test case
                          </button>
                        </div>
                      </div>
                    )}
                    {q.questionType === 'matching' && (
                      <div className="mt-4 space-y-2">
                        <p className="text-sm font-medium text-slate-800">Matching pairs</p>
                        {(Array.isArray(q.typeConfig?.pairs) ? q.typeConfig.pairs : []).map((pair, pairIdx) => {
                          const p = pair as { left?: string; right?: string; leftId?: string; rightId?: string }
                          return (
                            <div key={`${q.id}-pair-${pairIdx}`} className="grid gap-2 md:grid-cols-2">
                              <input
                                type="text"
                                value={p.left ?? ''}
                                onChange={(e) =>
                                  setQuestionsDraft((prev) =>
                                    prev.map((it) => {
                                      if (it.id !== q.id) return it
                                      const pairs = (Array.isArray(it.typeConfig?.pairs) ? it.typeConfig.pairs : []).map(
                                        (x) => ({ ...(x as Record<string, unknown>) }),
                                      )
                                      const existing = pairs[pairIdx] ?? {}
                                      pairs[pairIdx] = { ...existing, left: e.target.value }
                                      return { ...it, typeConfig: { ...(it.typeConfig ?? {}), pairs } }
                                    }),
                                  )
                                }
                                placeholder={`Left item ${pairIdx + 1}`}
                                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                              />
                              <div className="flex gap-2">
                                <input
                                  type="text"
                                  value={p.right ?? ''}
                                  onChange={(e) =>
                                    setQuestionsDraft((prev) =>
                                      prev.map((it) => {
                                        if (it.id !== q.id) return it
                                        const pairs = (Array.isArray(it.typeConfig?.pairs) ? it.typeConfig.pairs : []).map(
                                          (x) => ({ ...(x as Record<string, unknown>) }),
                                        )
                                        const existing = pairs[pairIdx] ?? {}
                                        pairs[pairIdx] = { ...existing, right: e.target.value }
                                        return { ...it, typeConfig: { ...(it.typeConfig ?? {}), pairs } }
                                      }),
                                    )
                                  }
                                  placeholder={`Right item ${pairIdx + 1}`}
                                  className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                                />
                                <button
                                  type="button"
                                  onClick={() =>
                                    setQuestionsDraft((prev) =>
                                      prev.map((it) => {
                                        if (it.id !== q.id) return it
                                        const pairs = (Array.isArray(it.typeConfig?.pairs) ? it.typeConfig.pairs : []).filter(
                                          (_, i) => i !== pairIdx,
                                        )
                                        return { ...it, typeConfig: { ...(it.typeConfig ?? {}), pairs } }
                                      }),
                                    )
                                  }
                                  className="rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
                                >
                                  Remove
                                </button>
                              </div>
                            </div>
                          )
                        })}
                        <button
                          type="button"
                          onClick={() =>
                            setQuestionsDraft((prev) =>
                              prev.map((it) => {
                                if (it.id !== q.id) return it
                                const pairs = Array.isArray(it.typeConfig?.pairs) ? [...it.typeConfig.pairs] : []
                                const n = pairs.length + 1
                                pairs.push({
                                  leftId: `left-${n}`,
                                  rightId: `right-${n}`,
                                  left: '',
                                  right: '',
                                })
                                return { ...it, typeConfig: { ...(it.typeConfig ?? {}), pairs } }
                              }),
                            )
                          }
                          className="inline-flex items-center gap-1.5 text-sm font-medium text-indigo-600 transition hover:text-indigo-700"
                        >
                          <Plus className="h-4 w-4" aria-hidden />
                          Add pair
                        </button>
                      </div>
                    )}
                    {q.questionType === 'formula' && (
                      <div className="mt-4 grid gap-3 md:grid-cols-2">
                        <label className="text-xs text-slate-600">
                          Correct LaTeX answer
                          <input
                            type="text"
                            value={String((q.typeConfig?.latexAnswer as string | undefined) ?? '')}
                            onChange={(e) =>
                              setQuestionsDraft((prev) =>
                                prev.map((it) =>
                                  it.id === q.id
                                    ? {
                                        ...it,
                                        typeConfig: { ...(it.typeConfig ?? {}), latexAnswer: e.target.value },
                                      }
                                    : it,
                                ),
                              )
                            }
                            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                          />
                        </label>
                        <label className="text-xs text-slate-600">
                          Equivalent forms (comma-separated)
                          <input
                            type="text"
                            value={Array.isArray(q.typeConfig?.equivalences) ? q.typeConfig.equivalences.join(', ') : ''}
                            onChange={(e) =>
                              setQuestionsDraft((prev) =>
                                prev.map((it) =>
                                  it.id === q.id
                                    ? {
                                        ...it,
                                        typeConfig: {
                                          ...(it.typeConfig ?? {}),
                                          equivalences: e.target.value
                                            .split(',')
                                            .map((x) => x.trim())
                                            .filter((x) => x.length > 0),
                                        },
                                      }
                                    : it,
                                ),
                              )
                            }
                            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                          />
                        </label>
                      </div>
                    )}
                    {q.questionType === 'hotspot' && (
                      <div className="mt-4 space-y-3">
                        <label className="block text-xs text-slate-600">
                          Image URL
                          <input
                            type="url"
                            value={String((q.typeConfig?.imageUrl as string | undefined) ?? '')}
                            onChange={(e) =>
                              setQuestionsDraft((prev) =>
                                prev.map((it) =>
                                  it.id === q.id
                                    ? { ...it, typeConfig: { ...(it.typeConfig ?? {}), imageUrl: e.target.value } }
                                    : it,
                                ),
                              )
                            }
                            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                          />
                        </label>
                        <p className="text-xs text-slate-500">
                          Region editor is coordinate-based in this pass via JSON metadata.
                        </p>
                      </div>
                    )}
                    {q.questionType === 'file_upload' && (
                      <div className="mt-4 grid gap-3 md:grid-cols-2">
                        <label className="text-xs text-slate-600">
                          Max file size (MB)
                          <input
                            type="number"
                            min={1}
                            value={String((q.typeConfig?.maxMb as number | undefined) ?? 50)}
                            onChange={(e) =>
                              setQuestionsDraft((prev) =>
                                prev.map((it) =>
                                  it.id === q.id
                                    ? {
                                        ...it,
                                        typeConfig: { ...(it.typeConfig ?? {}), maxMb: Number(e.target.value) || 50 },
                                      }
                                    : it,
                                ),
                              )
                            }
                            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                          />
                        </label>
                        <label className="text-xs text-slate-600">
                          Allowed MIME types (comma-separated)
                          <input
                            type="text"
                            value={
                              Array.isArray(q.typeConfig?.allowedMimeTypes)
                                ? q.typeConfig.allowedMimeTypes.join(', ')
                                : ''
                            }
                            onChange={(e) =>
                              setQuestionsDraft((prev) =>
                                prev.map((it) =>
                                  it.id === q.id
                                    ? {
                                        ...it,
                                        typeConfig: {
                                          ...(it.typeConfig ?? {}),
                                          allowedMimeTypes: e.target.value
                                            .split(',')
                                            .map((x) => x.trim())
                                            .filter((x) => x.length > 0),
                                        },
                                      }
                                    : it,
                                ),
                              )
                            }
                            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                          />
                        </label>
                      </div>
                    )}
                    {q.questionType === 'audio_response' && (
                      <div className="mt-4">
                        <label className="text-xs text-slate-600">
                          Max duration (seconds)
                          <input
                            type="number"
                            min={10}
                            value={String((q.typeConfig?.maxDurationS as number | undefined) ?? 300)}
                            onChange={(e) =>
                              setQuestionsDraft((prev) =>
                                prev.map((it) =>
                                  it.id === q.id
                                    ? {
                                        ...it,
                                        typeConfig: {
                                          ...(it.typeConfig ?? {}),
                                          maxDurationS: Number(e.target.value) || 300,
                                        },
                                      }
                                    : it,
                                ),
                              )
                            }
                            className="mt-1 w-full max-w-xs rounded-lg border border-slate-200 px-3 py-2 text-sm"
                          />
                        </label>
                      </div>
                    )}
                    {q.questionType === 'video_response' && (
                      <div className="mt-4 grid gap-3 md:grid-cols-2">
                        <label className="text-xs text-slate-600">
                          Max duration (seconds)
                          <input
                            type="number"
                            min={10}
                            value={String((q.typeConfig?.maxDurationS as number | undefined) ?? 600)}
                            onChange={(e) =>
                              setQuestionsDraft((prev) =>
                                prev.map((it) =>
                                  it.id === q.id
                                    ? {
                                        ...it,
                                        typeConfig: {
                                          ...(it.typeConfig ?? {}),
                                          maxDurationS: Number(e.target.value) || 600,
                                        },
                                      }
                                    : it,
                                ),
                              )
                            }
                            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                          />
                        </label>
                        <label className="text-xs text-slate-600">
                          Max upload size (MB)
                          <input
                            type="number"
                            min={1}
                            value={String((q.typeConfig?.maxMb as number | undefined) ?? 200)}
                            onChange={(e) =>
                              setQuestionsDraft((prev) =>
                                prev.map((it) =>
                                  it.id === q.id
                                    ? {
                                        ...it,
                                        typeConfig: { ...(it.typeConfig ?? {}), maxMb: Number(e.target.value) || 200 },
                                      }
                                    : it,
                                ),
                              )
                            }
                            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                          />
                        </label>
                      </div>
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
                <>
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setQuestionsDraft((prev) => [...prev, makeQuestion()])}
                      className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-slate-50"
                    >
                      <Plus className="h-4 w-4" />
                      Add question
                    </button>
                    <button
                      ref={importButtonRef}
                      type="button"
                      onClick={openImportQuestions}
                      aria-expanded={importQuestionsOpen}
                      aria-haspopup="dialog"
                      className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-slate-50"
                    >
                      <Plus className="h-4 w-4" />
                      Import Questions
                    </button>
                  </div>
                </>
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
      {questionsOpen && !qeAdaptiveOn && importQuestionsOpen && importPopoverPos && (
        <div
          ref={importDropdownRef}
          className="fixed z-[70] space-y-3 rounded-xl border border-slate-200 bg-white p-3 shadow-xl shadow-slate-900/10"
          style={{
            top: importPopoverPos.top,
            left: importPopoverPos.left,
            width: importPopoverPos.width,
            transform: 'translateY(calc(-100% - 8px))',
          }}
        >
          <div className="grid gap-2 sm:grid-cols-[1fr_12rem_auto]">
            <input
              type="text"
              value={importQuestionsQuery}
              onChange={(e) => setImportQuestionsQuery(e.target.value)}
              placeholder="Search question bank..."
              className="min-w-[14rem] flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-400/30"
            />
            <select
              value={importQuestionsType}
              onChange={(e) => setImportQuestionsType(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-400/30"
            >
              <option value="all">All types</option>
              <option value="mc_single">Multiple choice (single)</option>
              <option value="mc_multiple">Multiple choice (multiple)</option>
              <option value="true_false">True / False</option>
              <option value="short_answer">Short answer</option>
              <option value="numeric">Numeric</option>
              <option value="matching">Matching</option>
              <option value="ordering">Ordering</option>
              <option value="hotspot">Hotspot</option>
              <option value="formula">Formula</option>
              <option value="code">Code</option>
              <option value="file_upload">File upload</option>
              <option value="audio_response">Audio response</option>
              <option value="video_response">Video response</option>
            </select>
            <button
              type="button"
              onClick={() => void loadBankQuestionsForImport(importQuestionsQuery)}
              disabled={importQuestionsLoading}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:opacity-60"
            >
              {importQuestionsLoading ? 'Searching…' : 'Search'}
            </button>
          </div>
          <div className="max-h-60 space-y-2 overflow-auto pr-1">
            {!importQuestionsLoading && importRows.length === 0 ? (
              <p className="text-sm text-slate-500">No question bank items found.</p>
            ) : null}
            {importRows.map((row) => (
              <div
                key={row.id}
                className={`flex items-start gap-3 rounded-lg border px-3 py-2 transition ${
                  selectedImportQuestionId === row.id
                    ? 'border-indigo-300 bg-indigo-50/40'
                    : 'border-slate-200 bg-white'
                }`}
              >
                <input
                  type="radio"
                  name="import-question-select"
                  checked={selectedImportQuestionId === row.id}
                  onChange={() => setSelectedImportQuestionId(row.id)}
                  className="mt-1 h-4 w-4 border-slate-300 text-indigo-600 focus:ring-indigo-500/30"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-900">{row.stem || 'Untitled question'}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {row.questionType} • {row.points} pts
                  </p>
                </div>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-2">
            <button
              type="button"
              onClick={() => setImportQuestionsOpen(false)}
              className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100"
            >
              Close
            </button>
            <button
              type="button"
              onClick={() =>
                selectedImportQuestionId
                  ? void importQuestionFromBank(selectedImportQuestionId)
                  : undefined
              }
              disabled={!selectedImportQuestionId || importingQuestionId != null}
              className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60"
            >
              {importingQuestionId ? 'Importing…' : 'Import selected'}
            </button>
          </div>
          {importQuestionsError && (
            <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {importQuestionsError}
            </p>
          )}
        </div>
      )}
    </LmsPage>
  )
}
