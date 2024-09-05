export interface QuizQuestion {
  id: string
  type: string
  content: string
  choices: QuizQuestionChoice[]
}

export interface QuizQuestionChoice {
  id: string
  content: string
  isCorrect: boolean
}
