import { type QuizAdvancedSettings, type QuizQuestion } from '../../lib/courses-api'
import { shuffleArray, shuffledIndices } from '../../lib/shuffle'

export function visibleChoices(q: QuizQuestion): string[] {
  return q.choices.map((c) => c.trim()).filter((c) => c.length > 0)
}

export function orderingItemsForQuestion(q: QuizQuestion): string[] {
  const configured = q.typeConfig?.items
  if (Array.isArray(configured)) {
    const items = configured.map((x) => String(x).trim()).filter((x) => x.length > 0)
    if (items.length > 0) return items
  }
  return visibleChoices(q)
}

export type MatchingPairDraft = {
  leftId?: string
  rightId?: string
  left?: string
  right?: string
}

export function matchingPairsForQuestion(q: QuizQuestion): MatchingPairDraft[] {
  const configured = q.typeConfig?.pairs
  if (!Array.isArray(configured)) return []
  return configured
    .map((pair) => {
      const p = pair as Record<string, unknown>
      return {
        leftId: typeof p.leftId === 'string' ? p.leftId : typeof p.left_id === 'string' ? p.left_id : undefined,
        rightId:
          typeof p.rightId === 'string' ? p.rightId : typeof p.right_id === 'string' ? p.right_id : undefined,
        left: typeof p.left === 'string' ? p.left : undefined,
        right: typeof p.right === 'string' ? p.right : undefined,
      }
    })
    .filter((p) => (p.left ?? '').trim().length > 0 || (p.right ?? '').trim().length > 0)
}

export function sortedRightOptionsForMatching(pairs: MatchingPairDraft[]): string[] {
  const rights = pairs.map((p) => (p.right ?? '').trim()).filter((r) => r.length > 0)
  return [...new Set(rights)].sort((a, b) => a.localeCompare(b))
}

export function buildMatchingPairsPayload(
  q: QuizQuestion,
  answer: { matching?: Record<string, string> } | undefined,
): { leftId: string; rightId: string }[] {
  const pairs = matchingPairsForQuestion(q)
  const out: { leftId: string; rightId: string }[] = []
  for (let i = 0; i < pairs.length; i++) {
    const p = pairs[i]
    const key = p.leftId ?? `left-${i}`
    const selectedRight = (answer?.matching?.[key] ?? '').trim()
    if (!selectedRight) continue
    const match = pairs.find((x) => (x.right ?? '').trim() === selectedRight)
    const rightId = match?.rightId
    const leftId = p.leftId ?? `left-${i}`
    if (leftId && rightId) out.push({ leftId, rightId })
  }
  return out
}

function withShuffledChoices(q: QuizQuestion): QuizQuestion {
  if (q.questionType !== 'multiple_choice' && q.questionType !== 'true_false') {
    return q
  }
  const choices = visibleChoices(q)
  if (choices.length === 0) return q
  const order = shuffledIndices(choices.length)
  const newChoices = order.map((i) => choices[i])
  return {
    ...q,
    choices: newChoices,
    correctChoiceIndex: null,
  }
}

export function prepareStaticQuestions(
  questions: QuizQuestion[],
  advanced: QuizAdvancedSettings,
  skipClientRandomPool?: boolean,
): QuizQuestion[] {
  let qs = [...questions]
  if (advanced.shuffleQuestions) {
    qs = shuffleArray(qs)
  }
  const pool = advanced.randomQuestionPoolCount
  if (
    !skipClientRandomPool &&
    typeof pool === 'number' &&
    pool >= 1 &&
    pool < qs.length
  ) {
    qs = shuffleArray(qs).slice(0, pool)
  }
  if (advanced.shuffleChoices) {
    qs = qs.map((q) => withShuffledChoices({ ...q, choices: [...q.choices] }))
  }
  return qs
}

export function starterAnswersForCodeQuestions(
  questions: QuizQuestion[],
): Record<string, { text?: string }> {
  const out: Record<string, { text?: string }> = {}
  for (const q of questions) {
    if (q.questionType !== 'code') continue
    const starter = typeof q.typeConfig?.starterCode === 'string' ? q.typeConfig.starterCode : ''
    if (starter.trim().length > 0) out[q.id] = { text: starter }
  }
  return out
}
