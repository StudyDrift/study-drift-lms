import { FillInTheBlankQuizQuestion } from "@/models/quiz.model"
import { Input, Textarea } from "@material-tailwind/react"

interface Props {
  question: FillInTheBlankQuizQuestion
}

export const QuizFillInTheBlank = ({ question }: Props) => {
  return (
    <div>
      {question.settings.multiLine ? (
        <Textarea label="Content" />
      ) : (
        <Input label="Content" crossOrigin={"anonymous"} />
      )}
    </div>
  )
}
