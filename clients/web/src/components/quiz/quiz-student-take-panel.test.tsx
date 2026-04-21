import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import {
  defaultQuizAdvancedSettings,
  type ModuleQuizPayload,
} from '../../lib/courses-api'
import { server } from '../../test/mocks/server'
import { setAccessToken } from '../../lib/auth'
import { QuizStudentTakePanel } from './quiz-student-take-panel'

function minimalQuiz(overrides: Partial<ModuleQuizPayload> = {}): ModuleQuizPayload {
  const base: ModuleQuizPayload = {
    itemId: 'item-1',
    title: 'Unit test quiz',
    markdown: '',
    dueAt: null,
    availableFrom: null,
    availableUntil: null,
    unlimitedAttempts: true,
    maxAttempts: 1,
    gradeAttemptPolicy: 'latest',
    passingScorePercent: null,
    pointsWorth: 10,
    lateSubmissionPolicy: 'allow',
    latePenaltyPercent: null,
    timeLimitMinutes: null,
    timerPauseWhenTabHidden: false,
    perQuestionTimeLimitSeconds: null,
    showScoreTiming: 'immediate',
    reviewVisibility: 'full',
    reviewWhen: 'always',
    oneQuestionAtATime: false,
    lockdownMode: 'standard',
    shuffleQuestions: false,
    shuffleChoices: false,
    allowBackNavigation: true,
    requiresQuizAccessCode: false,
    adaptiveDifficulty: 'standard',
    adaptiveTopicBalance: true,
    adaptiveStopRule: 'fixed_count',
    randomQuestionPoolCount: null,
    questions: [
      {
        id: 'q1',
        prompt: 'Pick Alpha',
        questionType: 'multiple_choice',
        choices: ['Alpha', 'Beta'],
        typeConfig: {},
        correctChoiceIndex: 0,
        multipleAnswer: false,
        answerWithImage: false,
        required: true,
        points: 1,
        estimatedMinutes: 2,
      },
    ],
    usesServerQuestionSampling: false,
    updatedAt: new Date().toISOString(),
    isAdaptive: false,
    adaptiveSystemPrompt: null,
    adaptiveSourceItemIds: null,
    adaptiveQuestionCount: 5,
    adaptiveDeliveryMode: 'ai',
    assignmentGroupId: null,
  }
  return { ...base, ...overrides }
}

describe('QuizStudentTakePanel', () => {
  it('renders nothing when closed', () => {
    const onClose = () => {}
    const { container } = render(
      <QuizStudentTakePanel
        open={false}
        onClose={onClose}
        courseCode="C-TEST"
        itemId="item-1"
        quiz={minimalQuiz()}
        advanced={defaultQuizAdvancedSettings()}
        oneQuestionAtATime={false}
        allowBackNavigation
      />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('starts a standard attempt and shows the first question', async () => {
    const user = userEvent.setup()
    setAccessToken('test-token')

    server.use(
      http.post('http://localhost:8080/api/v1/courses/:courseCode/quizzes/:itemId/start', () =>
        HttpResponse.json({
          attemptId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
          attemptNumber: 1,
          startedAt: new Date().toISOString(),
          lockdownMode: 'standard',
          hintsDisabled: false,
          backNavigationAllowed: true,
          currentQuestionIndex: 0,
          deadlineAt: null,
          reducedDistractionMode: false,
          retakePolicy: 'latest',
          maxAttempts: null,
          remainingAttempts: null,
        }),
      ),
      http.get('http://localhost:8080/api/v1/courses/:courseCode/quizzes/:itemId', ({ request }) => {
        const url = new URL(request.url)
        if (!url.searchParams.get('attemptId')) {
          return HttpResponse.json({ error: 'missing attempt' }, { status: 400 })
        }
        return HttpResponse.json({
          itemId: 'item-1',
          title: 'Unit test quiz',
          markdown: '',
          dueAt: null,
          availableFrom: null,
          availableUntil: null,
          unlimitedAttempts: true,
          maxAttempts: 1,
          gradeAttemptPolicy: 'latest',
          passingScorePercent: null,
          pointsWorth: 10,
          lateSubmissionPolicy: 'allow',
          latePenaltyPercent: null,
          timeLimitMinutes: null,
          timerPauseWhenTabHidden: false,
          perQuestionTimeLimitSeconds: null,
          showScoreTiming: 'immediate',
          reviewVisibility: 'full',
          reviewWhen: 'always',
          oneQuestionAtATime: false,
          lockdownMode: 'standard',
          shuffleQuestions: false,
          shuffleChoices: false,
          allowBackNavigation: true,
          requiresQuizAccessCode: false,
          adaptiveDifficulty: 'standard',
          adaptiveTopicBalance: true,
          adaptiveStopRule: 'fixed_count',
          randomQuestionPoolCount: null,
          questions: [
            {
              id: 'q1',
              prompt: 'Pick Alpha',
              questionType: 'multiple_choice',
              choices: ['Alpha', 'Beta'],
              typeConfig: {},
              correctChoiceIndex: null,
              multipleAnswer: false,
              answerWithImage: false,
              required: true,
              points: 1,
              estimatedMinutes: 2,
            },
          ],
          usesServerQuestionSampling: false,
          updatedAt: new Date().toISOString(),
          isAdaptive: false,
          adaptiveSystemPrompt: null,
          adaptiveSourceItemIds: null,
          adaptiveQuestionCount: 5,
          adaptiveDeliveryMode: 'ai',
          assignmentGroupId: null,
        })
      }),
    )

    const onClose = () => {}
    render(
      <QuizStudentTakePanel
        open
        onClose={onClose}
        courseCode="C-TEST"
        itemId="item-1"
        quiz={minimalQuiz()}
        advanced={defaultQuizAdvancedSettings()}
        oneQuestionAtATime={false}
        allowBackNavigation
      />,
    )

    await user.click(screen.getByRole('button', { name: /^Begin$/i }))

    await waitFor(() => {
      expect(screen.getByText(/Pick Alpha/i)).toBeInTheDocument()
    })
  })
})
