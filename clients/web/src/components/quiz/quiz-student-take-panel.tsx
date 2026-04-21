import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { X } from 'lucide-react'
import { useOptionalQuizShellFocus } from '../layout/quiz-shell-focus-context'
import type { QuizShellFocusMode, QuizShellLockdownAccent } from '../layout/quiz-shell-focus-context'
import { MathPlainText } from '../math/math-plain-text'
import { BookLoader } from './book-loader'
import { MathKeyboard } from './math-keyboard'
import {
  fetchModuleQuiz,
  fetchQuizCurrentQuestion,
  fetchQuizResults,
  postAdaptiveQuizNext,
  postQuizAdvance,
  postQuizFocusLoss,
  postQuizQuestionRun,
  postQuizStart,
  postQuizSubmit,
  type AdaptiveQuizGeneratedQuestion,
  type AdaptiveQuizHistoryTurn,
  type ModuleQuizPayload,
  type QuizCodeRunResponse,
  type QuizAttemptStartResponse,
  type QuizAdvancedSettings,
  type QuizQuestion,
} from '../../lib/courses-api'
import {
  buildMatchingPairsPayload,
  matchingPairsForQuestion,
  orderingItemsForQuestion,
  prepareStaticQuestions,
  sortedRightOptionsForMatching,
  starterAnswersForCodeQuestions,
  visibleChoices,
} from './quiz-take-utils'

function formatRetakePolicyNotice(policy: string): string {
  switch (policy) {
    case 'highest':
      return 'Your highest score counts toward the course grade.'
    case 'latest':
      return 'Your most recent attempt counts toward the course grade.'
    case 'first':
      return 'Your first submitted attempt counts toward the course grade.'
    case 'average':
      return 'The average of your attempts counts toward the course grade.'
    default:
      return 'Your instructor chose how multiple attempts are scored.'
  }
}

export type QuizStudentTakePanelProps = {
  open: boolean
  onClose: () => void
  courseCode: string
  itemId: string
  quiz: ModuleQuizPayload
  advanced: QuizAdvancedSettings
  oneQuestionAtATime: boolean
  allowBackNavigation: boolean
}

type QuizAnswerState = {
  choice?: number
  text?: string
  numeric?: number
  ordering?: string[]
  /** leftId -> selected right-side label */
  matching?: Record<string, string>
  hotspot?: { x: number; y: number }
}

type UiPhase =
  | { kind: 'idle' }
  | { kind: 'starting' }
  | { kind: 'static' }
  | { kind: 'done'; summary: string }

export function QuizStudentTakePanel({
  open,
  onClose,
  courseCode,
  itemId,
  quiz,
  advanced,
  oneQuestionAtATime,
  allowBackNavigation,
}: QuizStudentTakePanelProps) {
  const [accessCode, setAccessCode] = useState('')
  const [uiPhase, setUiPhase] = useState<UiPhase>({ kind: 'idle' })
  const [error, setError] = useState<string | null>(null)
  const [lockdownModalOpen, setLockdownModalOpen] = useState(false)
  const [startMeta, setStartMeta] = useState<QuizAttemptStartResponse | null>(null)
  const [serverLockdown, setServerLockdown] = useState(false)
  const [fullscreenWarning, setFullscreenWarning] = useState<string | null>(null)
  const [focusLossBanner, setFocusLossBanner] = useState<string | null>(null)
  const [srvQuestion, setSrvQuestion] = useState<QuizQuestion | null>(null)
  const [srvIdx, setSrvIdx] = useState(0)
  const [srvTotal, setSrvTotal] = useState(0)
  const [srvCompleted, setSrvCompleted] = useState(false)
  const [timeLeftSec, setTimeLeftSec] = useState<number | null>(null)
  const [timerNotice, setTimerNotice] = useState<string | null>(null)
  const [timerNoticeAssertive, setTimerNoticeAssertive] = useState(false)
  const [highContrastQuiz, setHighContrastQuiz] = useState(false)
  const [advanceBusy, setAdvanceBusy] = useState(false)
  const [staticTakeProgress, setStaticTakeProgress] = useState<{
    stepIndex: number
    totalSteps: number
    currentQuestionId: string
  } | null>(null)
  const [flaggedQuestionIds, setFlaggedQuestionIds] = useState(() => new Set<string>())
  const panelRef = useRef<HTMLDivElement | null>(null)

  const [staticQuestions, setStaticQuestions] = useState<QuizQuestion[]>([])
  const [attemptId, setAttemptId] = useState<string | null>(null)
  const [answers, setAnswers] = useState<Record<string, QuizAnswerState>>({})
  const [codeRunByQuestion, setCodeRunByQuestion] = useState<Record<string, QuizCodeRunResponse>>({})
  const [runningCodeQuestionId, setRunningCodeQuestionId] = useState<string | null>(null)

  const [adHistory, setAdHistory] = useState<AdaptiveQuizHistoryTurn[]>([])
  const [adPending, setAdPending] = useState<AdaptiveQuizGeneratedQuestion[]>([])
  const [adSelected, setAdSelected] = useState<number | null>(null)
  const [adPhase, setAdPhase] = useState<'idle' | 'loading' | 'question' | 'submitting' | 'done'>('idle')

  const adaptiveSessionRef = useRef(0)
  const historySeqRef = useRef(0)
  const fetchInFlightRef = useRef(false)
  const adaptiveSubmitStartedRef = useRef(false)
  const timeoutSubmitStartedRef = useRef(false)
  const tenMinuteWarningRef = useRef(false)
  const oneMinuteWarningRef = useRef(false)
  const kioskVisSkipRef = useRef(true)
  const submitStaticRef = useRef<() => Promise<void>>(async () => {})

  const maxAdaptive = useMemo(
    () => Math.min(30, Math.max(1, quiz.adaptiveQuestionCount || 1)),
    [quiz.adaptiveQuestionCount],
  )

  const needsLockdownWarning = useMemo(() => {
    if (quiz.isAdaptive) return false
    return quiz.lockdownMode === 'one_at_a_time' || quiz.lockdownMode === 'kiosk'
  }, [quiz.isAdaptive, quiz.lockdownMode])

  const reset = useCallback(() => {
    adaptiveSessionRef.current += 1
    historySeqRef.current += 1
    fetchInFlightRef.current = false
    adaptiveSubmitStartedRef.current = false
    setUiPhase({ kind: 'idle' })
    setError(null)
    setAccessCode('')
    setStaticQuestions([])
    setAttemptId(null)
    setAnswers({})
    setCodeRunByQuestion({})
    setRunningCodeQuestionId(null)
    setAdHistory([])
    setAdPending([])
    setAdSelected(null)
    setAdPhase('idle')
    setLockdownModalOpen(false)
    setStartMeta(null)
    setServerLockdown(false)
    setFullscreenWarning(null)
    setFocusLossBanner(null)
    setSrvQuestion(null)
    setSrvIdx(0)
    setSrvTotal(0)
    setSrvCompleted(false)
    setTimeLeftSec(null)
    setTimerNotice(null)
    setTimerNoticeAssertive(false)
    setHighContrastQuiz(false)
    setAdvanceBusy(false)
    setStaticTakeProgress(null)
    setFlaggedQuestionIds(new Set())
    timeoutSubmitStartedRef.current = false
    tenMinuteWarningRef.current = false
    oneMinuteWarningRef.current = false
  }, [])

  useEffect(() => {
    if (!open) reset()
  }, [open, reset])

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

  useEffect(() => {
    if (!open || !startMeta?.deadlineAt || uiPhase.kind !== 'static') {
      setTimeLeftSec(null)
      return
    }
    const deadlineMs = new Date(startMeta.deadlineAt).getTime()
    if (!Number.isFinite(deadlineMs)) {
      setTimeLeftSec(null)
      return
    }
    function tick() {
      setTimeLeftSec(Math.max(0, Math.floor((deadlineMs - Date.now()) / 1000)))
    }
    tick()
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [open, startMeta?.deadlineAt, uiPhase.kind])

  useEffect(() => {
    if (!open || !serverLockdown || startMeta?.lockdownMode !== 'kiosk' || !attemptId) return
    const aid = attemptId
    kioskVisSkipRef.current = true
    function onVis() {
      if (document.visibilityState === 'hidden') {
        void postQuizFocusLoss(courseCode, itemId, aid, {
          eventType: 'visibility_hidden',
        }).catch(() => {
          /* non-blocking */
        })
      } else {
        if (kioskVisSkipRef.current) {
          kioskVisSkipRef.current = false
          return
        }
        setFocusLossBanner(`A focus-loss event was recorded at ${new Date().toLocaleTimeString()}.`)
      }
    }
    function onBlur() {
      void postQuizFocusLoss(courseCode, itemId, aid, { eventType: 'blur' }).catch(() => {})
    }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('blur', onBlur)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('blur', onBlur)
    }
  }, [open, serverLockdown, startMeta?.lockdownMode, attemptId, courseCode, itemId])

  async function beginAttempt() {
    setError(null)
    setUiPhase({ kind: 'starting' })
    try {
      const start = await postQuizStart(courseCode, itemId, {
        quizAccessCode: advanced.requiresQuizAccessCode ? accessCode : undefined,
      })
      setAttemptId(start.attemptId)
      setStartMeta(start)
      if (!quiz.isAdaptive) {
        const sdl = start.lockdownMode === 'one_at_a_time' || start.lockdownMode === 'kiosk'
        if (sdl) {
          setServerLockdown(true)
          if (start.lockdownMode === 'kiosk') {
            const el = panelRef.current
            if (el && typeof el.requestFullscreen === 'function') {
              try {
                await el.requestFullscreen()
              } catch {
                setFullscreenWarning(
                  'Full-screen could not be enabled. The exam continues without kiosk full-screen.',
                )
              }
            } else {
              setFullscreenWarning(
                'Full-screen could not be enabled. The exam continues without kiosk full-screen.',
              )
            }
          }
          const cur = await fetchQuizCurrentQuestion(courseCode, itemId, start.attemptId)
          setSrvCompleted(cur.completed)
          setSrvIdx(cur.questionIndex)
          setSrvTotal(cur.totalQuestions)
          setSrvQuestion(cur.completed ? null : cur.question)
          if (cur.question && cur.question.questionType === 'code') {
            const starter =
              typeof cur.question.typeConfig?.starterCode === 'string'
                ? cur.question.typeConfig.starterCode
                : ''
            if (starter.trim().length > 0) {
              setAnswers((prev) => ({ ...prev, [cur.question!.id]: prev[cur.question!.id] ?? { text: starter } }))
            }
          }
          if (!cur.completed && !cur.question) {
            throw new Error('No question was returned for this attempt.')
          }
          setUiPhase({ kind: 'static' })
          return
        }
        const refreshed = await fetchModuleQuiz(courseCode, itemId, { attemptId: start.attemptId })
        const prepared = prepareStaticQuestions(
          refreshed.questions,
          advanced,
          refreshed.usesServerQuestionSampling === true,
        )
        if (prepared.length === 0) {
          throw new Error('This quiz has no questions yet.')
        }
        setStaticQuestions(prepared)
        setAnswers((prev) => ({ ...starterAnswersForCodeQuestions(prepared), ...prev }))
        setUiPhase({ kind: 'static' })
        return
      }
      adaptiveSessionRef.current += 1
      adaptiveSubmitStartedRef.current = false
      setAdHistory([])
      setAdPending([])
      setAdSelected(null)
      setAdPhase('loading')
      setUiPhase({ kind: 'static' })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start the quiz.')
      setUiPhase({ kind: 'idle' })
    }
  }

  const finishWithSummary = useCallback(
    async (sub: { attemptId: string }) => {
      let extra = ''
      try {
        const res = await fetchQuizResults(courseCode, itemId, { attemptId: sub.attemptId })
        if (res.score) {
          extra = ` Score: ${res.score.pointsEarned.toFixed(2)} / ${res.score.pointsPossible.toFixed(2)} (${res.score.scorePercent.toFixed(0)}%).`
        }
        if (res.academicIntegrityFlag) {
          extra +=
            ' This attempt was flagged for review (focus-loss count exceeded the course threshold).'
        }
      } catch {
        /* review policy may hide results */
      }
      setUiPhase({ kind: 'done', summary: `Submitted successfully.${extra}` })
      setAdPhase('done')
    },
    [courseCode, itemId],
  )

  async function submitStatic() {
    if (!attemptId) return
    setError(null)
    try {
      if (serverLockdown) {
        const sub = await postQuizSubmit(courseCode, itemId, { attemptId })
        await finishWithSummary(sub)
        return
      }
      const responses = staticQuestions.map((q) => {
        const a = answers[q.id]
        if (q.questionType === 'multiple_choice' || q.questionType === 'true_false') {
          return { questionId: q.id, selectedChoiceIndex: a?.choice ?? undefined }
        }
        if (q.questionType === 'numeric') {
          return {
            questionId: q.id,
            numericValue: typeof a?.numeric === 'number' ? a.numeric : undefined,
            textAnswer: a?.text ?? '',
          }
        }
        if (q.questionType === 'formula') {
          return { questionId: q.id, formulaLatex: a?.text ?? '' }
        }
        if (q.questionType === 'code') {
          return {
            questionId: q.id,
            codeSubmission: {
              language: String((q.typeConfig?.language as string | undefined) ?? 'text'),
              code: a?.text ?? '',
            },
          }
        }
        if (q.questionType === 'ordering') {
          return { questionId: q.id, orderingSequence: a?.ordering ?? orderingItemsForQuestion(q) }
        }
        if (q.questionType === 'matching') {
          return { questionId: q.id, matchingPairs: buildMatchingPairsPayload(q, a) }
        }
        if (q.questionType === 'hotspot') {
          return { questionId: q.id, hotspotClick: a?.hotspot }
        }
        if (q.questionType === 'file_upload' || q.questionType === 'audio_response' || q.questionType === 'video_response') {
          return { questionId: q.id, textAnswer: a?.text ?? '' }
        }
        return { questionId: q.id, textAnswer: a?.text ?? '' }
      })
      const sub = await postQuizSubmit(courseCode, itemId, { attemptId, responses })
      await finishWithSummary(sub)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Submit failed.')
    }
  }

  submitStaticRef.current = submitStatic

  useEffect(() => {
    if (uiPhase.kind !== 'static' || timeLeftSec == null) return
    if (!tenMinuteWarningRef.current && timeLeftSec <= 600 && timeLeftSec > 60) {
      tenMinuteWarningRef.current = true
      setTimerNotice('10 minutes remaining.')
      setTimerNoticeAssertive(false)
    }
    if (!oneMinuteWarningRef.current && timeLeftSec <= 60 && timeLeftSec > 0) {
      oneMinuteWarningRef.current = true
      setTimerNotice('1 minute remaining.')
      setTimerNoticeAssertive(true)
    }
    if (timeLeftSec === 0 && !timeoutSubmitStartedRef.current) {
      timeoutSubmitStartedRef.current = true
      setTimerNotice('Time is up. Submitting your attempt now.')
      setTimerNoticeAssertive(true)
      if (quiz.isAdaptive) {
        if (!attemptId) return
        setAdPhase('submitting')
        void (async () => {
          try {
            const sub = await postQuizSubmit(courseCode, itemId, {
              attemptId,
              adaptiveHistory: adHistory,
            })
            setUiPhase({ kind: 'done', summary: `Submitted successfully (attempt ${sub.attemptId.slice(0, 8)}…).` })
            setAdPhase('done')
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Time expired and auto-submit failed.')
          }
        })()
      } else {
        void submitStaticRef.current()
      }
    }
  }, [uiPhase.kind, timeLeftSec, quiz.isAdaptive, attemptId, adHistory, courseCode, itemId])

  async function advanceServerQuestion() {
    if (!attemptId || !srvQuestion) return
    setError(null)
    setAdvanceBusy(true)
    const q = srvQuestion
    const a = answers[q.id]
    let body:
      | { questionId: string; selectedChoiceIndex?: number }
      | { questionId: string; textAnswer?: string | null; numericValue?: number; formulaLatex?: string }
      | { questionId: string; orderingSequence?: string[] }
      | { questionId: string; codeSubmission?: { language: string; code: string } }
      | { questionId: string; matchingPairs?: { leftId: string; rightId: string }[] }
      | { questionId: string; hotspotClick?: { x: number; y: number } }
    if (q.questionType === 'multiple_choice' || q.questionType === 'true_false') {
      body = { questionId: q.id, selectedChoiceIndex: a?.choice ?? undefined }
    } else if (q.questionType === 'numeric') {
      body = {
        questionId: q.id,
        numericValue: typeof a?.numeric === 'number' ? a.numeric : undefined,
        textAnswer: a?.text ?? '',
      }
    } else if (q.questionType === 'formula') {
      body = { questionId: q.id, formulaLatex: a?.text ?? '' }
    } else if (q.questionType === 'code') {
      body = {
        questionId: q.id,
        codeSubmission: {
          language: String((q.typeConfig?.language as string | undefined) ?? 'text'),
          code: a?.text ?? '',
        },
      }
    } else if (q.questionType === 'ordering') {
      body = { questionId: q.id, orderingSequence: a?.ordering ?? orderingItemsForQuestion(q) }
    } else if (q.questionType === 'matching') {
      body = { questionId: q.id, matchingPairs: buildMatchingPairsPayload(q, a) }
    } else if (q.questionType === 'hotspot') {
      body = { questionId: q.id, hotspotClick: a?.hotspot }
    } else if (
      q.questionType === 'file_upload' ||
      q.questionType === 'audio_response' ||
      q.questionType === 'video_response'
    ) {
      body = { questionId: q.id, textAnswer: a?.text ?? '' }
    } else {
      body = { questionId: q.id, textAnswer: a?.text ?? '' }
    }
    try {
      const res = await postQuizAdvance(courseCode, itemId, attemptId, body)
      if (res.completed) {
        setSrvCompleted(true)
        setSrvQuestion(null)
        return
      }
      const cur = await fetchQuizCurrentQuestion(courseCode, itemId, attemptId)
      setSrvCompleted(cur.completed)
      setSrvIdx(cur.questionIndex)
      setSrvTotal(cur.totalQuestions)
      setSrvQuestion(cur.completed ? null : cur.question)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save your answer.')
    } finally {
      setAdvanceBusy(false)
    }
  }

  // Adaptive: prefetch next questions (mirrors QuizStudentPreviewModal)
  useEffect(() => {
    if (!open || !quiz.isAdaptive || !attemptId) return
    if (adPhase === 'idle' || adPhase === 'done' || adPhase === 'submitting') return

    const answered = adHistory.length
    if (answered >= maxAdaptive) {
      if (adaptiveSubmitStartedRef.current) return
      adaptiveSubmitStartedRef.current = true
      setAdPhase('submitting')
      void (async () => {
        try {
          const sub = await postQuizSubmit(courseCode, itemId, {
            attemptId,
            adaptiveHistory: adHistory,
          })
          await finishWithSummary(sub)
        } catch (e) {
          adaptiveSubmitStartedRef.current = false
          setError(e instanceof Error ? e.message : 'Submit failed.')
          setAdPhase('idle')
        }
      })()
      return
    }

    const remainingSlots = maxAdaptive - answered
    const need = Math.min(2, remainingSlots)
    if (adPending.length >= need) {
      if (adPending.length > 0) {
        setAdPhase((p) => (p === 'submitting' ? p : 'question'))
      }
      return
    }

    if (fetchInFlightRef.current) return
    fetchInFlightRef.current = true
    if (adPending.length === 0) {
      setAdPhase((p) => (p === 'submitting' ? p : 'loading'))
    }

    const sessionAtStart = adaptiveSessionRef.current
    const historySeqAtStart = historySeqRef.current
    const historyForRequest = adHistory

    void (async () => {
      try {
        const res = await postAdaptiveQuizNext(courseCode, itemId, {
          history: historyForRequest,
          attemptId,
        })
        if (sessionAtStart !== adaptiveSessionRef.current) return
        if (historySeqAtStart !== historySeqRef.current) return
        if (res.finished) {
          const sub = await postQuizSubmit(courseCode, itemId, {
            attemptId,
            adaptiveHistory: historyForRequest,
          })
          await finishWithSummary(sub)
          return
        }
        const batch = res.questions
        if (!batch.length) {
          setError('The server returned no questions.')
          setAdPhase('idle')
          return
        }
        setAdPending((prev) => [...prev, ...batch])
        setAdPhase('question')
      } catch (e) {
        if (sessionAtStart !== adaptiveSessionRef.current) return
        setError(e instanceof Error ? e.message : 'Could not load the next question.')
        setAdPhase('idle')
      } finally {
        fetchInFlightRef.current = false
      }
    })()
  }, [
    open,
    quiz.isAdaptive,
    attemptId,
    adHistory,
    adPending.length,
    maxAdaptive,
    adPhase,
    courseCode,
    itemId,
    finishWithSummary,
  ])

  async function submitAdaptiveAnswer() {
    const current = adPending[0]
    if (!current || !attemptId) return
    if (current.questionType === 'multiple_choice' || current.questionType === 'true_false') {
      if (adSelected == null) {
        setError('Select an answer to continue.')
        return
      }
    }
    setError(null)
    const turn: AdaptiveQuizHistoryTurn = {
      ...(current.questionId ? { questionId: current.questionId } : {}),
      prompt: current.prompt,
      questionType: current.questionType,
      choices: current.choices,
      choiceWeights: current.choiceWeights,
      selectedChoiceIndex: adSelected,
      points: current.points,
    }
    const nextHist = [...adHistory, turn]
    historySeqRef.current += 1
    setAdHistory(nextHist)
    setAdPending((q) => q.slice(1))
    setAdSelected(null)
  }

  const optionalShell = useOptionalQuizShellFocus()
  const timedConfigured = (advanced.timeLimitMinutes ?? 0) > 0
  const shellFocusSession =
    open && (timedConfigured || needsLockdownWarning) && uiPhase.kind !== 'done'

  const currentAdaptiveHeadless = open ? (adPending[0] ?? null) : null

  const timeLabelForShell = useMemo(() => {
    if (!open || uiPhase.kind !== 'static' || timeLeftSec == null) return null
    return `${String(Math.floor(timeLeftSec / 3600)).padStart(2, '0')}:${String(
      Math.floor((timeLeftSec % 3600) / 60),
    ).padStart(2, '0')}:${String(timeLeftSec % 60).padStart(2, '0')}`
  }, [open, uiPhase.kind, timeLeftSec])

  const timeUrgentForShell = timeLeftSec != null && timeLeftSec <= 300

  const questionProgressForShell = useMemo(() => {
    if (!open || uiPhase.kind !== 'static') return null
    if (quiz.isAdaptive) return `Question ${Math.min(adHistory.length + 1, maxAdaptive)} of ${maxAdaptive}`
    if (serverLockdown) {
      if (srvTotal <= 0) return null
      return srvCompleted ? `All ${srvTotal} questions answered` : `Question ${srvIdx + 1} of ${srvTotal}`
    }
    if (!oneQuestionAtATime) return null
    if (!staticTakeProgress || staticTakeProgress.totalSteps <= 0) return null
    return `Question ${staticTakeProgress.stepIndex + 1} of ${staticTakeProgress.totalSteps}`
  }, [
    open,
    uiPhase.kind,
    quiz.isAdaptive,
    adHistory.length,
    maxAdaptive,
    serverLockdown,
    srvTotal,
    srvCompleted,
    srvIdx,
    oneQuestionAtATime,
    staticTakeProgress,
  ])

  const lockdownAccentForShell = useMemo((): QuizShellLockdownAccent => {
    const mode = startMeta?.lockdownMode ?? quiz.lockdownMode
    if (mode === 'kiosk') return 'kiosk'
    if (mode === 'one_at_a_time') return 'one_at_a_time'
    return 'none'
  }, [startMeta?.lockdownMode, quiz.lockdownMode])

  const currentFlagQuestionId = useMemo(() => {
    if (!shellFocusSession || uiPhase.kind !== 'static') return null
    if (quiz.isAdaptive) {
      if (adPhase !== 'question' || !currentAdaptiveHeadless) return null
      return `adaptive:${adHistory.length}`
    }
    if (serverLockdown) return srvQuestion?.id ?? null
    if (!oneQuestionAtATime) return null
    return staticTakeProgress?.currentQuestionId ?? null
  }, [
    shellFocusSession,
    uiPhase.kind,
    quiz.isAdaptive,
    adPhase,
    currentAdaptiveHeadless,
    adHistory.length,
    serverLockdown,
    srvQuestion?.id,
    oneQuestionAtATime,
    staticTakeProgress?.currentQuestionId,
  ])

  const flaggedForCurrent = Boolean(currentFlagQuestionId && flaggedQuestionIds.has(currentFlagQuestionId))

  const toggleFlagForReview = useCallback(() => {
    const id = currentFlagQuestionId
    if (!id) return
    setFlaggedQuestionIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [currentFlagQuestionId])

  const saveStatusTextForShell = useMemo(() => {
    if (lockdownModalOpen) return 'Read the instructions, then confirm to begin.'
    if (uiPhase.kind === 'idle') return 'Press Begin when you are ready to start.'
    if (uiPhase.kind === 'starting') return 'Starting your attempt…'
    if (uiPhase.kind !== 'static') return ''
    if (quiz.isAdaptive) return 'Submit each answer to continue. The attempt is saved when you finish.'
    if (serverLockdown) {
      if (advanceBusy) return 'Saving your answer…'
      if (srvCompleted) return 'All answers recorded — submit to finish.'
      return 'Your answer is saved when you go to the next question.'
    }
    return 'Submit the quiz when you are finished — answers stay in this window until then.'
  }, [lockdownModalOpen, uiPhase.kind, quiz.isAdaptive, serverLockdown, advanceBusy, srvCompleted])

  useEffect(() => {
    if (!optionalShell) return
    if (!shellFocusSession) {
      optionalShell.setQuizShellFocus(null)
      return
    }
    const model: QuizShellFocusMode = {
      quizTitle: quiz.title || 'Quiz',
      timeRemainingLabel: timeLabelForShell,
      timeUrgent: timeUrgentForShell,
      questionProgress: questionProgressForShell,
      saveStatusText: saveStatusTextForShell,
      lockdownAccent: lockdownAccentForShell,
      flaggedForCurrent,
      onToggleFlagForReview: currentFlagQuestionId ? toggleFlagForReview : null,
    }
    optionalShell.setQuizShellFocus(model)
    return () => {
      optionalShell.setQuizShellFocus(null)
    }
  }, [
    optionalShell,
    shellFocusSession,
    quiz.title,
    timeLabelForShell,
    timeUrgentForShell,
    questionProgressForShell,
    saveStatusTextForShell,
    lockdownAccentForShell,
    flaggedForCurrent,
    currentFlagQuestionId,
    toggleFlagForReview,
  ])

  if (!open) return null

  const currentAdaptive = adPending[0] ?? null
  const reducedTake = Boolean(startMeta?.reducedDistractionMode)
  const immersiveChrome = shellFocusSession

  const timeLabel =
    timeLeftSec != null
      ? `${String(Math.floor(timeLeftSec / 3600)).padStart(2, '0')}:${String(
          Math.floor((timeLeftSec % 3600) / 60),
        ).padStart(2, '0')}:${String(timeLeftSec % 60).padStart(2, '0')}`
      : null

  return (
    <div
      ref={panelRef}
      className={`fixed inset-0 z-[70] flex justify-center bg-slate-900/40 p-4 sm:items-center ${
        immersiveChrome ? 'items-stretch bg-slate-950 p-0 sm:items-stretch' : 'items-end'
      }`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="quiz-take-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className={`flex w-full flex-col overflow-hidden border border-slate-200 bg-white shadow-xl dark:border-neutral-600 dark:bg-neutral-900 ${
          immersiveChrome
            ? `h-dvh max-h-dvh max-w-none rounded-none border-0 shadow-none sm:max-h-dvh ${
                reducedTake ? 'lex-quiz-reduced-distract' : ''
              }`
            : `h-[90vh] rounded-2xl ${reducedTake ? 'lex-quiz-reduced-distract max-w-2xl' : 'max-w-3xl'}`
        } ${highContrastQuiz && reducedTake ? 'ring-2 ring-slate-900 dark:ring-neutral-100' : ''}`}
      >
        <div
          className={`flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-neutral-600 ${
            immersiveChrome ? 'py-2' : ''
          }`}
        >
          <div className="min-w-0">
            {immersiveChrome ? (
              <h2 id="quiz-take-title" className="sr-only">
                {reducedTake ? 'Quiz' : 'Take quiz'} — {quiz.title || 'Quiz'}
              </h2>
            ) : (
              <>
                <h2 id="quiz-take-title" className="text-sm font-semibold text-slate-900 dark:text-neutral-100">
                  {reducedTake ? 'Quiz' : 'Take quiz'}
                </h2>
                {!reducedTake ? (
                  <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-neutral-400" title={quiz.title}>
                    {quiz.title || 'Quiz'}
                  </p>
                ) : null}
              </>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {reducedTake ? (
              <button
                type="button"
                onClick={() => setHighContrastQuiz((v) => !v)}
                className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-neutral-600 dark:text-neutral-200 dark:hover:bg-neutral-800"
              >
                {highContrastQuiz ? 'Contrast: on' : 'Contrast: off'}
              </button>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:hover:bg-neutral-800"
              aria-label="Close"
            >
              <X className="h-5 w-5" aria-hidden />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50/60 p-4 dark:bg-neutral-950/80">
          {lockdownModalOpen && (
            <div
              className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-100"
              role="dialog"
              aria-labelledby="lockdown-warn-title"
            >
              <p id="lockdown-warn-title" className="font-semibold">
                {quiz.lockdownMode === 'kiosk' ? 'This exam uses kiosk mode.' : 'This exam is delivered one question at a time.'}
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>You cannot go back to change previous answers after you continue.</li>
                <li>Hints follow the exam settings and any accommodations on your account.</li>
                {quiz.lockdownMode === 'kiosk' ? (
                  <li>Leaving this browser tab may be logged for instructor review.</li>
                ) : null}
              </ul>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
                  onClick={() => {
                    setLockdownModalOpen(false)
                    void beginAttempt()
                  }}
                >
                  I understand — begin exam
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 dark:border-neutral-600 dark:text-neutral-200"
                  onClick={() => setLockdownModalOpen(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
          {fullscreenWarning && (
            <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-100">
              {fullscreenWarning}
            </p>
          )}
          {focusLossBanner && (
            <div
              className="mb-4 flex items-start justify-between gap-2 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-900 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-100"
              role="status"
            >
              <span>{focusLossBanner}</span>
              <button
                type="button"
                className="shrink-0 text-rose-700 underline dark:text-rose-200"
                onClick={() => setFocusLossBanner(null)}
              >
                Dismiss
              </button>
            </div>
          )}
          {error && (
            <p className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-200">
              {error}
            </p>
          )}

          {startMeta && uiPhase.kind === 'static' ? (
            <div
              className="mb-4 space-y-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 dark:border-neutral-600 dark:bg-neutral-900/60 dark:text-neutral-100"
              aria-live="polite"
              aria-label={[
                startMeta.maxAttempts != null
                  ? `Attempt ${startMeta.attemptNumber} of ${startMeta.maxAttempts}`
                  : `Attempt ${startMeta.attemptNumber}, unlimited attempts`,
                typeof startMeta.remainingAttempts === 'number'
                  ? `${startMeta.remainingAttempts} attempts remaining after this one`
                  : null,
                formatRetakePolicyNotice(startMeta.retakePolicy),
              ]
                .filter(Boolean)
                .join('. ')}
            >
              <p className="font-medium text-slate-900 dark:text-neutral-50">
                {startMeta.maxAttempts != null
                  ? `Attempt ${startMeta.attemptNumber} of ${startMeta.maxAttempts}`
                  : `Attempt ${startMeta.attemptNumber} (unlimited attempts)`}
              </p>
              {startMeta.maxAttempts != null && typeof startMeta.remainingAttempts === 'number' ? (
                <p className="text-slate-600 dark:text-neutral-300">
                  {startMeta.remainingAttempts === 0
                    ? 'This is your last allowed attempt for this quiz.'
                    : `${startMeta.remainingAttempts} more attempt${startMeta.remainingAttempts === 1 ? '' : 's'} allowed after this one.`}
                </p>
              ) : null}
              <p className="text-slate-600 dark:text-neutral-300">{formatRetakePolicyNotice(startMeta.retakePolicy)}</p>
            </div>
          ) : null}

          {timeLabel != null && uiPhase.kind === 'static' && !immersiveChrome && (
            <div
              className={`mb-4 rounded-lg border px-3 py-2 text-sm font-medium tabular-nums ${
                timeLeftSec !== null && timeLeftSec <= 300
                  ? 'border-rose-300 bg-rose-50 text-rose-900 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-100'
                  : timeLeftSec !== null && timeLeftSec <= 900
                    ? 'border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-50'
                  : 'border-slate-200 bg-white text-slate-800 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100'
              }`}
              role="status"
              aria-live={(timeLeftSec ?? 0) <= 60 ? 'assertive' : 'polite'}
            >
              Time remaining: {timeLabel}
              {timeLeftSec === 0 ? ' — submit your answers now.' : null}
            </div>
          )}
          {timerNotice ? (
            <p
              className="mb-4 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm text-indigo-900 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-100"
              role="status"
              aria-live={timerNoticeAssertive ? 'assertive' : 'polite'}
            >
              {timerNotice}
            </p>
          ) : null}

          {uiPhase.kind === 'idle' && (
            <div className="space-y-4">
              <p className="text-sm text-slate-600 dark:text-neutral-300">
                {quiz.isAdaptive
                  ? 'You will answer up to the configured number of AI-generated questions. Your attempt is saved when you finish.'
                  : 'Answer each question, then submit. Your score is recorded for this course.'}
              </p>
              {advanced.requiresQuizAccessCode ? (
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-neutral-400">
                    Access code
                  </label>
                  <input
                    type="password"
                    value={accessCode}
                    onChange={(e) => setAccessCode(e.target.value)}
                    className="w-full max-w-sm rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-neutral-600 dark:bg-neutral-900"
                    placeholder="Enter code"
                  />
                </div>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  if (needsLockdownWarning) setLockdownModalOpen(true)
                  else void beginAttempt()
                }}
                className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500"
              >
                Begin
              </button>
            </div>
          )}

          {uiPhase.kind === 'starting' && (
            <div className="flex items-center gap-3 text-sm text-slate-600 dark:text-neutral-300">
              <span className="inline-flex shrink-0 origin-left scale-[0.32]">
                <BookLoader />
              </span>
              Starting…
            </div>
          )}

          {uiPhase.kind === 'static' && !quiz.isAdaptive && serverLockdown && (
            <div className="space-y-4">
              {!immersiveChrome ? (
                <p
                  className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-neutral-400"
                  aria-live="polite"
                  aria-label={
                    srvCompleted
                      ? 'All questions answered'
                      : `Question ${srvIdx + 1} of ${srvTotal || '…'}`
                  }
                >
                  {srvCompleted ? 'All questions answered' : `Question ${srvIdx + 1} of ${srvTotal || '…'}`}
                </p>
              ) : null}
              {srvQuestion ? (
                <StaticTakeBody
                  questions={[srvQuestion]}
                  oneQuestionAtATime
                  allowBackNavigation={false}
                  answers={answers}
                  setAnswers={setAnswers}
                  attemptId={attemptId}
                  courseCode={courseCode}
                  itemId={itemId}
                  codeRunByQuestion={codeRunByQuestion}
                  setCodeRunByQuestion={setCodeRunByQuestion}
                  runningCodeQuestionId={runningCodeQuestionId}
                  setRunningCodeQuestionId={setRunningCodeQuestionId}
                  onSubmit={() => void advanceServerQuestion()}
                  advanceOnly
                />
              ) : null}
              {srvCompleted ? (
                <p className="text-sm text-slate-600 dark:text-neutral-300">
                  Your answers are locked. Submit the quiz to finish.
                </p>
              ) : null}
              {srvCompleted ? (
                <button
                  type="button"
                  onClick={() => void submitStatic()}
                  className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500"
                >
                  Submit quiz
                </button>
              ) : null}
            </div>
          )}

          {uiPhase.kind === 'static' && !quiz.isAdaptive && !serverLockdown && staticQuestions.length > 0 && (
            <StaticTakeBody
              questions={staticQuestions}
              oneQuestionAtATime={oneQuestionAtATime}
              allowBackNavigation={allowBackNavigation}
              answers={answers}
              setAnswers={setAnswers}
              attemptId={attemptId}
              courseCode={courseCode}
              itemId={itemId}
              codeRunByQuestion={codeRunByQuestion}
              setCodeRunByQuestion={setCodeRunByQuestion}
              runningCodeQuestionId={runningCodeQuestionId}
              setRunningCodeQuestionId={setRunningCodeQuestionId}
              onSubmit={() => void submitStatic()}
              onTakeProgress={shellFocusSession ? setStaticTakeProgress : undefined}
              suppressInlineQuestionProgress={immersiveChrome}
            />
          )}

          {uiPhase.kind === 'static' && quiz.isAdaptive && (
            <div className="space-y-4">
              {adPhase === 'loading' && (
                <div className="flex items-center gap-3 text-sm text-slate-600 dark:text-neutral-300">
                  <span className="inline-flex shrink-0 origin-left scale-[0.32]">
                    <BookLoader />
                  </span>
                  {adHistory.length === 0 ? 'Setting up the quiz…' : 'Preparing the next question…'}
                </div>
              )}
              {adPhase === 'question' && currentAdaptive && (
                <div className="space-y-4">
                  {!immersiveChrome ? (
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-neutral-400">
                      Question {Math.min(adHistory.length + 1, maxAdaptive)} of {maxAdaptive}
                    </p>
                  ) : null}
                  <p className="text-sm font-medium text-slate-900 dark:text-neutral-100">
                    <MathPlainText text={currentAdaptive.prompt} />
                  </p>
                  <div className="space-y-2">
                    {currentAdaptive.choices.map((label, i) => (
                      <label
                        key={`ad-${i}`}
                        className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100"
                      >
                        <input
                          type="radio"
                          name="adaptive-take-choice"
                          checked={adSelected === i}
                          onChange={() => {
                            setAdSelected(i)
                            setError(null)
                          }}
                          className="mt-0.5 border-slate-300 text-indigo-600"
                        />
                        <span className="min-w-0 flex-1">
                          <MathPlainText text={label} />
                        </span>
                      </label>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => void submitAdaptiveAnswer()}
                    className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500"
                  >
                    Submit answer
                  </button>
                </div>
              )}
              {adPhase === 'submitting' && (
                <p className="text-sm text-slate-600 dark:text-neutral-300">Submitting your quiz…</p>
              )}
            </div>
          )}

          {uiPhase.kind === 'done' && (
            <div className="space-y-3">
              <p className="text-sm text-slate-800 dark:text-neutral-200">{uiPhase.summary}</p>
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-800 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-200"
              >
                Close
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function StaticTakeBody({
  questions,
  oneQuestionAtATime,
  allowBackNavigation,
  answers,
  setAnswers,
  attemptId,
  courseCode,
  itemId,
  codeRunByQuestion,
  setCodeRunByQuestion,
  runningCodeQuestionId,
  setRunningCodeQuestionId,
  onSubmit,
  advanceOnly,
  nextLabel,
  onTakeProgress,
  suppressInlineQuestionProgress,
}: {
  questions: QuizQuestion[]
  oneQuestionAtATime: boolean
  allowBackNavigation: boolean
  answers: Record<string, QuizAnswerState>
  setAnswers: Dispatch<SetStateAction<Record<string, QuizAnswerState>>>
  attemptId: string | null
  courseCode: string
  itemId: string
  codeRunByQuestion: Record<string, QuizCodeRunResponse>
  setCodeRunByQuestion: Dispatch<SetStateAction<Record<string, QuizCodeRunResponse>>>
  runningCodeQuestionId: string | null
  setRunningCodeQuestionId: Dispatch<SetStateAction<string | null>>
  onSubmit: () => void
  /** When true, one-question view always uses `nextLabel` and `onSubmit` advances (lockdown server flow). */
  advanceOnly?: boolean
  nextLabel?: string
  onTakeProgress?: (
    info: { stepIndex: number; totalSteps: number; currentQuestionId: string } | null,
  ) => void
  suppressInlineQuestionProgress?: boolean
}) {
  const [step, setStep] = useState(0)
  const textInputRefs = useRef<Record<string, HTMLInputElement | HTMLTextAreaElement | null>>({})

  useEffect(() => {
    setStep(0)
  }, [questions])

  useEffect(() => {
    if (!onTakeProgress) return
    if (!oneQuestionAtATime) {
      onTakeProgress(null)
      return
    }
    const cur = questions[step]
    onTakeProgress({
      stepIndex: step,
      totalSteps: questions.length,
      currentQuestionId: cur?.id ?? '',
    })
  }, [onTakeProgress, oneQuestionAtATime, questions, step])

  async function runCodeQuestion(q: QuizQuestion) {
    if (!attemptId) return
    const code = answers[q.id]?.text ?? ''
    const languageId = typeof q.typeConfig?.languageId === 'number' ? q.typeConfig.languageId : undefined
    setRunningCodeQuestionId(q.id)
    try {
      const result = await postQuizQuestionRun(courseCode, itemId, attemptId, q.id, { code, languageId })
      setCodeRunByQuestion((prev) => ({ ...prev, [q.id]: result }))
    } finally {
      setRunningCodeQuestionId(null)
    }
  }

  function renderQuestion(q: QuizQuestion, index: number) {
    const choices = visibleChoices(q)
    const showChoices = q.questionType === 'multiple_choice' || q.questionType === 'true_false'
    const a = answers[q.id] ?? {}
    const configuredUnit = typeof q.typeConfig?.unit === 'string' ? q.typeConfig.unit : null
    const orderingItems = a.ordering ?? orderingItemsForQuestion(q)
    const baseOrderingItems = orderingItemsForQuestion(q)

    return (
      <section
        key={q.id}
        className="rounded-xl border border-slate-200/90 bg-white p-5 shadow-sm dark:border-neutral-600 dark:bg-neutral-900"
      >
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-neutral-400">
          Question {index + 1}
        </p>
        <p className="mt-2 text-sm font-medium text-slate-900 dark:text-neutral-100">
          <MathPlainText text={q.prompt || '—'} />
        </p>
        {showChoices && (
          <div className="mt-4 space-y-2">
            {choices.map((label, i) => (
              <label
                key={`${q.id}-c-${i}`}
                className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 bg-slate-50/50 px-3 py-2.5 text-sm dark:border-neutral-600 dark:bg-neutral-800/50"
              >
                <input
                  type="radio"
                  name={`take-${q.id}`}
                  checked={a.choice === i}
                  onChange={() =>
                    setAnswers((prev) => ({
                      ...prev,
                      [q.id]: { ...prev[q.id], choice: i },
                    }))
                  }
                  className="mt-0.5 border-slate-300 text-indigo-600"
                />
                <span className="min-w-0 flex-1">
                  <MathPlainText text={label} />
                </span>
              </label>
            ))}
          </div>
        )}
        {q.questionType === 'fill_in_blank' && (
          <>
            <input
              ref={(el) => {
                textInputRefs.current[q.id] = el
              }}
              type="text"
              className="mt-4 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-neutral-600 dark:bg-neutral-900"
              value={a.text ?? ''}
              onChange={(e) =>
                setAnswers((prev) => ({
                  ...prev,
                  [q.id]: { ...prev[q.id], text: e.target.value },
                }))
              }
              placeholder="Your answer"
            />
            <MathKeyboard
              className="mt-2"
              onInsert={(snippet, caret) => {
                const el = textInputRefs.current[q.id]
                setAnswers((prevState) => {
                  const cur = prevState[q.id]?.text ?? ''
                  if (!el) {
                    return {
                      ...prevState,
                      [q.id]: { ...prevState[q.id], text: cur + snippet },
                    }
                  }
                  const start = el.selectionStart ?? cur.length
                  const end = el.selectionEnd ?? cur.length
                  const next = cur.slice(0, start) + snippet + cur.slice(end)
                  const pos = start + (caret ?? snippet.length)
                  requestAnimationFrame(() => {
                    el.focus()
                    el.setSelectionRange(pos, pos)
                  })
                  return { ...prevState, [q.id]: { ...prevState[q.id], text: next } }
                })
              }}
            />
          </>
        )}
        {(q.questionType === 'short_answer' || q.questionType === 'essay') && (
          <>
            <textarea
              ref={(el) => {
                textInputRefs.current[q.id] = el
              }}
              rows={q.questionType === 'essay' ? 8 : 3}
              className="mt-4 w-full resize-y rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-neutral-600 dark:bg-neutral-900"
              value={a.text ?? ''}
              onChange={(e) =>
                setAnswers((prev) => ({
                  ...prev,
                  [q.id]: { ...prev[q.id], text: e.target.value },
                }))
              }
              placeholder="Your answer"
            />
            <MathKeyboard
              className="mt-2"
              onInsert={(snippet, caret) => {
                const el = textInputRefs.current[q.id]
                setAnswers((prevState) => {
                  const cur = prevState[q.id]?.text ?? ''
                  if (!el) {
                    return {
                      ...prevState,
                      [q.id]: { ...prevState[q.id], text: cur + snippet },
                    }
                  }
                  const start = el.selectionStart ?? cur.length
                  const end = el.selectionEnd ?? cur.length
                  const next = cur.slice(0, start) + snippet + cur.slice(end)
                  const pos = start + (caret ?? snippet.length)
                  requestAnimationFrame(() => {
                    el.focus()
                    el.setSelectionRange(pos, pos)
                  })
                  return { ...prevState, [q.id]: { ...prevState[q.id], text: next } }
                })
              }}
            />
          </>
        )}
        {q.questionType === 'numeric' && (
          <div className="mt-4 space-y-2">
            <input
              type="number"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-neutral-600 dark:bg-neutral-900"
              value={a.numeric ?? ''}
              onChange={(e) => {
                const raw = e.target.value
                setAnswers((prev) => ({
                  ...prev,
                  [q.id]: { ...prev[q.id], numeric: raw.trim() === '' ? undefined : Number(raw), text: raw },
                }))
              }}
              placeholder="Enter a numeric value"
            />
            {configuredUnit && configuredUnit.trim().length > 0 ? (
              <p className="text-xs text-slate-500 dark:text-neutral-400">Expected unit: {configuredUnit}</p>
            ) : null}
          </div>
        )}
        {q.questionType === 'formula' && (
          <>
            <input
              ref={(el) => {
                textInputRefs.current[q.id] = el
              }}
              type="text"
              className="mt-4 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-neutral-600 dark:bg-neutral-900"
              value={a.text ?? ''}
              onChange={(e) =>
                setAnswers((prev) => ({
                  ...prev,
                  [q.id]: { ...prev[q.id], text: e.target.value },
                }))
              }
              placeholder="Enter LaTeX, e.g. x^2+1"
            />
            <MathKeyboard
              className="mt-2"
              onInsert={(snippet, caret) => {
                const el = textInputRefs.current[q.id]
                setAnswers((prevState) => {
                  const cur = prevState[q.id]?.text ?? ''
                  if (!el) return { ...prevState, [q.id]: { ...prevState[q.id], text: cur + snippet } }
                  const start = el.selectionStart ?? cur.length
                  const end = el.selectionEnd ?? cur.length
                  const next = cur.slice(0, start) + snippet + cur.slice(end)
                  const pos = start + (caret ?? snippet.length)
                  requestAnimationFrame(() => {
                    el.focus()
                    el.setSelectionRange(pos, pos)
                  })
                  return { ...prevState, [q.id]: { ...prevState[q.id], text: next } }
                })
              }}
            />
          </>
        )}
        {q.questionType === 'code' && (
          <div className="mt-4 space-y-3">
            <textarea
              rows={8}
              className="w-full resize-y rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm dark:border-neutral-600 dark:bg-neutral-900"
              value={a.text ?? ''}
              onChange={(e) =>
                setAnswers((prev) => ({
                  ...prev,
                  [q.id]: { ...prev[q.id], text: e.target.value },
                }))
              }
              placeholder="Write your code submission"
            />
            <button
              type="button"
              onClick={() => void runCodeQuestion(q)}
              disabled={!attemptId || runningCodeQuestionId === q.id}
              className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 disabled:cursor-not-allowed disabled:opacity-60 dark:border-indigo-800 dark:bg-indigo-950/30 dark:text-indigo-200"
            >
              {runningCodeQuestionId === q.id ? 'Running…' : 'Run public tests'}
            </button>
            {codeRunByQuestion[q.id] ? (
              <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-neutral-700" role="table">
                <table className="min-w-full text-left text-xs">
                  <thead className="bg-slate-50 dark:bg-neutral-800">
                    <tr>
                      <th className="px-2 py-1.5 font-semibold">Test</th>
                      <th className="px-2 py-1.5 font-semibold">Status</th>
                      <th className="px-2 py-1.5 font-semibold">Expected</th>
                      <th className="px-2 py-1.5 font-semibold">Actual</th>
                    </tr>
                  </thead>
                  <tbody>
                    {codeRunByQuestion[q.id].results.map((r, idx) => (
                      <tr key={`${q.id}-run-${idx}`} className="border-t border-slate-100 dark:border-neutral-800">
                        <td className="px-2 py-1.5">#{idx + 1}</td>
                        <td className="px-2 py-1.5">{r.passed ? 'Pass' : r.status.toUpperCase()}</td>
                        <td className="px-2 py-1.5 font-mono">{r.expectedOutput || '(empty)'}</td>
                        <td className="px-2 py-1.5 font-mono">{r.actualOutput || r.stderr || '(empty)'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        )}
        {q.questionType === 'ordering' && (
          <div className="mt-4 space-y-2">
            {orderingItems.length === 0 ? (
              <p className="text-sm italic text-slate-500 dark:text-neutral-400">
                No ordering items are configured.
              </p>
            ) : (
              orderingItems.map((item, i) => (
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
                    setAnswers((prev) => {
                      const cur = prev[q.id]?.ordering ?? orderingItemsForQuestion(q)
                      const next = [...cur]
                      const [moved] = next.splice(from, 1)
                      next.splice(i, 0, moved)
                      return { ...prev, [q.id]: { ...prev[q.id], ordering: next } }
                    })
                  }}
                  className="flex cursor-grab items-center justify-between rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2 text-sm text-slate-800 dark:border-neutral-600 dark:bg-neutral-800/50 dark:text-neutral-100"
                >
                  <span>
                    {(baseOrderingItems.findIndex((x) => x === item) + 1 || i + 1)}. {item}
                  </span>
                  <span className="text-xs text-slate-400 dark:text-neutral-500">Drag</span>
                </div>
              ))
            )}
          </div>
        )}
        {q.questionType === 'matching' && (
          <div className="mt-4 space-y-2">
            {matchingPairsForQuestion(q).length === 0 ? (
              <p className="text-sm italic text-slate-500 dark:text-neutral-400">
                No matching pairs are configured.
              </p>
            ) : (
              matchingPairsForQuestion(q).map((pair, i) => {
                const leftLabel = pair.left ?? ''
                const key = pair.leftId ?? `left-${i}`
                const rightOptions = sortedRightOptionsForMatching(matchingPairsForQuestion(q))
                return (
                  <div key={`${q.id}-match-${i}`} className="grid gap-2 md:grid-cols-2">
                    <p className="rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2 text-sm text-slate-800 dark:border-neutral-600 dark:bg-neutral-800/50 dark:text-neutral-100">
                      <MathPlainText text={leftLabel} />
                    </p>
                    <select
                      value={a.matching?.[key] ?? ''}
                      onChange={(e) =>
                        setAnswers((prev) => ({
                          ...prev,
                          [q.id]: {
                            ...prev[q.id],
                            matching: { ...(prev[q.id]?.matching ?? {}), [key]: e.target.value },
                          },
                        }))
                      }
                      className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100"
                    >
                      <option value="">Select match…</option>
                      {rightOptions.map((opt) => (
                        <option key={`${q.id}-ro-${i}-${opt}`} value={opt}>
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
        {q.questionType === 'hotspot' && (
          <div className="mt-4 space-y-2">
            {typeof q.typeConfig?.imageUrl === 'string' && q.typeConfig.imageUrl.trim().length > 0 ? (
              <div
                className="relative cursor-crosshair overflow-hidden rounded-lg border border-slate-200 bg-slate-50 dark:border-neutral-600 dark:bg-neutral-900"
                onClick={(e) => {
                  const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
                  const x = Math.round(e.clientX - rect.left)
                  const y = Math.round(e.clientY - rect.top)
                  setAnswers((prev) => ({
                    ...prev,
                    [q.id]: { ...prev[q.id], hotspot: { x, y } },
                  }))
                }}
              >
                <img
                  src={q.typeConfig.imageUrl}
                  alt=""
                  className="max-h-72 w-full object-contain"
                />
                {a.hotspot ? (
                  <span
                    className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-indigo-600 ring-2 ring-white"
                    style={{ left: a.hotspot.x, top: a.hotspot.y }}
                  />
                ) : null}
              </div>
            ) : (
              <p className="text-sm italic text-slate-500 dark:text-neutral-400">
                No image URL is configured for this hotspot.
              </p>
            )}
            {a.hotspot ? (
              <p className="text-xs text-slate-500 dark:text-neutral-400">
                Selected point: ({a.hotspot.x}, {a.hotspot.y})
              </p>
            ) : (
              <p className="text-xs text-slate-500 dark:text-neutral-400">Click the image to place your answer.</p>
            )}
          </div>
        )}
        {q.questionType === 'file_upload' && (
          <div className="mt-4 space-y-2">
            <label className="block text-sm font-medium text-slate-700 dark:text-neutral-200">
              Upload a file
              {typeof q.typeConfig?.maxMb === 'number' ? (
                <span className="ml-1 font-normal text-slate-500 dark:text-neutral-400">
                  (max {q.typeConfig.maxMb} MB)
                </span>
              ) : null}
            </label>
            <input
              type="file"
              className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-indigo-700 hover:file:bg-indigo-100 dark:border-neutral-600 dark:text-neutral-300 dark:file:bg-indigo-950/40 dark:file:text-indigo-200"
              onChange={(e) => {
                const f = e.target.files?.[0]
                setAnswers((prev) => ({
                  ...prev,
                  [q.id]: { ...prev[q.id], text: f ? f.name : '' },
                }))
              }}
            />
            {a.text ? (
              <p className="text-xs text-slate-600 dark:text-neutral-400">Selected: {a.text}</p>
            ) : null}
          </div>
        )}
        {q.questionType === 'audio_response' && (
          <div className="mt-4 space-y-2">
            <label className="block text-sm font-medium text-slate-700 dark:text-neutral-200">
              Upload audio
              {typeof q.typeConfig?.maxDurationS === 'number' ? (
                <span className="ml-1 font-normal text-slate-500 dark:text-neutral-400">
                  (max {q.typeConfig.maxDurationS}s)
                </span>
              ) : null}
            </label>
            <input
              type="file"
              accept="audio/*"
              className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-indigo-700 hover:file:bg-indigo-100 dark:border-neutral-600 dark:text-neutral-300 dark:file:bg-indigo-950/40 dark:file:text-indigo-200"
              onChange={(e) => {
                const f = e.target.files?.[0]
                setAnswers((prev) => ({
                  ...prev,
                  [q.id]: { ...prev[q.id], text: f ? f.name : '' },
                }))
              }}
            />
            {a.text ? (
              <p className="text-xs text-slate-600 dark:text-neutral-400">Selected: {a.text}</p>
            ) : null}
          </div>
        )}
        {q.questionType === 'video_response' && (
          <div className="mt-4 space-y-2">
            <label className="block text-sm font-medium text-slate-700 dark:text-neutral-200">
              Upload video
              {typeof q.typeConfig?.maxMb === 'number' ? (
                <span className="ml-1 font-normal text-slate-500 dark:text-neutral-400">
                  (max {q.typeConfig.maxMb} MB)
                </span>
              ) : null}
            </label>
            <input
              type="file"
              accept="video/*"
              className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-indigo-700 hover:file:bg-indigo-100 dark:border-neutral-600 dark:text-neutral-300 dark:file:bg-indigo-950/40 dark:file:text-indigo-200"
              onChange={(e) => {
                const f = e.target.files?.[0]
                setAnswers((prev) => ({
                  ...prev,
                  [q.id]: { ...prev[q.id], text: f ? f.name : '' },
                }))
              }}
            />
            {a.text ? (
              <p className="text-xs text-slate-600 dark:text-neutral-400">Selected: {a.text}</p>
            ) : null}
          </div>
        )}
      </section>
    )
  }

  if (!oneQuestionAtATime) {
    return (
      <div className="space-y-6">
        {questions.map((q, i) => renderQuestion(q, i))}
        <button
          type="button"
          onClick={onSubmit}
          className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500"
        >
          Submit quiz
        </button>
      </div>
    )
  }

  const current = questions[step]
  if (!current) return null
  const isLast = step + 1 >= questions.length
  const primaryLabel = advanceOnly ? (nextLabel ?? 'Next') : isLast ? 'Submit' : 'Next'

  return (
    <div className="space-y-4">
      {!advanceOnly && !suppressInlineQuestionProgress ? (
        <p className="text-xs font-semibold text-slate-500 dark:text-neutral-400">
          Question {step + 1} of {questions.length}
        </p>
      ) : null}
      {renderQuestion(current, step)}
      <div className="flex flex-wrap justify-end gap-2">
        {allowBackNavigation && step > 0 ? (
          <button
            type="button"
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm dark:border-neutral-600 dark:bg-neutral-900"
          >
            Back
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => {
            if (advanceOnly) {
              onSubmit()
              return
            }
            if (isLast) {
              onSubmit()
            } else {
              setStep((s) => s + 1)
            }
          }}
          className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500"
        >
          {primaryLabel}
        </button>
      </div>
    </div>
  )
}
