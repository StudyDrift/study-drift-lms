export interface QuizQuestion {
  id: string
  type: string
  content: string
}

export interface MultipleChoiceQuizQuestion extends QuizQuestion {
  type: "multiple-choice"
  choices: QuizQuestionChoice[]
}

export interface FillInTheBlankQuizQuestion extends QuizQuestion {
  type: "fill-in-the-blank"
  settings: FillInTheBlankSettings
}

export interface FillInTheBlankSettings {
  multiLine: boolean
}

export interface QuizQuestionChoice {
  id: string
  content: string
  isCorrect: boolean
}
