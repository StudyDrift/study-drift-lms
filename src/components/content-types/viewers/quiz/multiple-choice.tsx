import { MultipleChoiceQuizQuestion } from "@/models/quiz.model"
import { Radio, Typography } from "@material-tailwind/react"

interface Props {
  question: MultipleChoiceQuizQuestion
}

export const QuizMultipleChoice = ({ question }: Props) => {
  return (
    <div className="flex flex-col gap-1">
      {question.choices.map((c, i) => (
        <Radio
          name={question.id}
          key={i}
          label={
            <Typography variant="small" className="font-normal text-gray-900">
              {c.content}
            </Typography>
          }
          crossOrigin={"anonymous"}
        />
      ))}
    </div>
  )
}
