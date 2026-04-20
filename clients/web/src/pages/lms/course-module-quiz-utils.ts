import { type BankQuestionDetail, type CourseStructureItem, type LockdownMode, type QuizQuestion } from '../../lib/courses-api'

export const QUESTION_TYPE_OPTIONS = [
  { value: 'multiple_choice', label: 'Multiple choice' },
  { value: 'fill_in_blank', label: 'Fill in the blank' },
  { value: 'essay', label: 'Essay' },
  { value: 'true_false', label: 'True / False' },
  { value: 'short_answer', label: 'Short answer' },
  { value: 'matching', label: 'Matching' },
  { value: 'ordering', label: 'Ordering' },
  { value: 'hotspot', label: 'Hotspot' },
  { value: 'numeric', label: 'Numeric' },
  { value: 'formula', label: 'Formula (LaTeX)' },
  { value: 'code', label: 'Code' },
  { value: 'file_upload', label: 'File upload' },
  { value: 'audio_response', label: 'Audio response' },
  { value: 'video_response', label: 'Video response' },
] as const

export type QuestionType = (typeof QUESTION_TYPE_OPTIONS)[number]['value']

export function isoToDatetimeLocalValue(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function datetimeLocalValueToIso(value: string): string | null {
  const t = value.trim()
  if (!t) return null
  const d = new Date(t)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString()
}

export function quizDateTimeIsSet(iso: string | null): boolean {
  if (!iso) return false
  const d = new Date(iso)
  return !Number.isNaN(d.getTime())
}

export function formatQuizDateTime(iso: string | null): string {
  if (!iso) return 'Not set'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'Not set'
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

export function formatGradePolicyShort(p: string): string {
  if (p === 'highest') return 'Highest score'
  if (p === 'latest') return 'Latest attempt'
  if (p === 'first') return 'First attempt'
  if (p === 'average') return 'Average'
  return p
}

export function formatLockdownModeLabel(mode: LockdownMode): string {
  if (mode === 'one_at_a_time') return 'One at a time'
  if (mode === 'kiosk') return 'Kiosk'
  return 'Standard'
}

export function formatItemPointsWorth(p: number | null): string {
  if (p == null) return 'Not set'
  return String(p)
}

export function assignmentGroupDisplayName(
  groupId: string | null,
  groups: { id: string; name: string }[],
): string {
  if (!groupId) return 'Not set'
  const g = groups.find((x) => x.id === groupId)
  return g?.name ?? 'Unknown group'
}

export function newLocalId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `local-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export function structureKindLabel(kind: CourseStructureItem['kind']): string {
  if (kind === 'content_page') return 'Content'
  if (kind === 'assignment') return 'Assignment'
  if (kind === 'quiz') return 'Quiz'
  return kind
}

export function makeQuestion(): QuizQuestion {
  return {
    id: newLocalId(),
    prompt: '',
    questionType: 'multiple_choice',
    choices: ['', '', '', ''],
    typeConfig: {},
    correctChoiceIndex: null,
    multipleAnswer: false,
    answerWithImage: false,
    required: true,
    points: 1,
    estimatedMinutes: 2,
  }
}

function parseBankChoiceList(options: unknown): string[] {
  if (Array.isArray(options)) return options.map((entry) => String(entry ?? '').trim()).filter((entry) => entry.length > 0)
  if (!options || typeof options !== 'object') return []
  const record = options as Record<string, unknown>
  const candidate =
    (Array.isArray(record.choices) && record.choices) ||
    (Array.isArray(record.options) && record.options) ||
    (Array.isArray(record.items) && record.items)
  if (!candidate) return []
  return candidate.map((entry) => String(entry ?? '').trim()).filter((entry) => entry.length > 0)
}

function bankQuestionTypeToQuizType(bankType: string): QuestionType {
  if (bankType === 'mc_single' || bankType === 'mc_multiple') return 'multiple_choice'
  if (bankType === 'true_false') return 'true_false'
  if (bankType === 'short_answer') return 'short_answer'
  if (bankType === 'numeric') return 'numeric'
  if (bankType === 'matching') return 'matching'
  if (bankType === 'ordering') return 'ordering'
  if (bankType === 'hotspot') return 'hotspot'
  if (bankType === 'formula') return 'formula'
  if (bankType === 'code') return 'code'
  if (bankType === 'file_upload') return 'file_upload'
  if (bankType === 'audio_response') return 'audio_response'
  if (bankType === 'video_response') return 'video_response'
  return 'essay'
}

export function bankDetailToQuizQuestion(detail: BankQuestionDetail): QuizQuestion {
  const quizType = bankQuestionTypeToQuizType(detail.questionType)
  const choicesFromBank = parseBankChoiceList(detail.options)
  const optionObject =
    detail.options && typeof detail.options === 'object' && !Array.isArray(detail.options)
      ? (detail.options as Record<string, unknown>)
      : {}
  let correctChoiceIndex: number | null = null
  if (typeof detail.correctAnswer === 'number' && Number.isFinite(detail.correctAnswer)) {
    const idx = Math.floor(detail.correctAnswer)
    if (idx >= 0) correctChoiceIndex = idx
  } else if (typeof detail.correctAnswer === 'string' && detail.correctAnswer.trim()) {
    const maybeIndex = Number.parseInt(detail.correctAnswer, 10)
    if (Number.isFinite(maybeIndex) && maybeIndex >= 0) correctChoiceIndex = maybeIndex
  } else if (detail.correctAnswer && typeof detail.correctAnswer === 'object') {
    const answerObj = detail.correctAnswer as Record<string, unknown>
    const idxRaw = answerObj.index
    if (typeof idxRaw === 'number' && Number.isFinite(idxRaw) && idxRaw >= 0) {
      correctChoiceIndex = Math.floor(idxRaw)
    }
  }
  const fallback = makeQuestion()
  const typeConfig =
    Object.keys(optionObject).length > 0 ? optionObject : defaultTypeConfigFor(quizType)

  if (quizType === 'true_false') {
    const boolCorrect =
      typeof detail.correctAnswer === 'boolean'
        ? detail.correctAnswer
        : String(detail.correctAnswer ?? '').toLowerCase() === 'true'
    return {
      ...fallback,
      prompt: detail.stem ?? '',
      questionType: 'true_false',
      choices: ['True', 'False'],
      correctChoiceIndex: boolCorrect ? 0 : 1,
      points: Number.isFinite(detail.points) ? Number(detail.points) : 1,
      typeConfig: {},
    }
  }

  return {
    ...fallback,
    prompt: detail.stem ?? '',
    questionType: quizType,
    choices:
      quizType === 'multiple_choice'
        ? choicesFromBank.length > 0
          ? choicesFromBank
          : fallback.choices
        : [],
    correctChoiceIndex:
      quizType === 'multiple_choice' && correctChoiceIndex != null && correctChoiceIndex >= 0
        ? correctChoiceIndex
        : null,
    multipleAnswer: detail.questionType === 'mc_multiple',
    points: Number.isFinite(detail.points) ? Number(detail.points) : 1,
    typeConfig,
  }
}

export function defaultTypeConfigFor(questionType: QuestionType): Record<string, unknown> {
  if (questionType === 'matching') {
    return {
      pairs: [
        { leftId: 'left-1', rightId: 'right-1', left: 'Item A', right: 'Match A' },
        { leftId: 'left-2', rightId: 'right-2', left: 'Item B', right: 'Match B' },
      ],
    }
  }
  if (questionType === 'ordering') {
    return { items: ['First item', 'Second item', 'Third item'] }
  }
  if (questionType === 'hotspot') {
    return { imageUrl: '', regions: [] }
  }
  if (questionType === 'numeric') {
    return { toleranceAbs: 0 }
  }
  if (questionType === 'formula') {
    return { latexAnswer: '', equivalences: [] }
  }
  if (questionType === 'code') {
    return {
      language: 'javascript',
      starterCode: '',
      testCases: [{ input: '', expectedOutput: '', isHidden: false, timeLimitMs: 2000, memoryLimitKb: 262144 }],
    }
  }
  if (questionType === 'file_upload') {
    return { maxMb: 50, allowedMimeTypes: ['application/pdf'] }
  }
  if (questionType === 'audio_response') {
    return { maxDurationS: 300 }
  }
  if (questionType === 'video_response') {
    return { maxDurationS: 600, maxMb: 200 }
  }
  return {}
}

