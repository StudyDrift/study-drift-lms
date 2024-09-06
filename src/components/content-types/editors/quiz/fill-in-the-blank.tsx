import {
  FillInTheBlankQuizQuestion,
  FillInTheBlankSettings,
} from "@/models/quiz.model"
import { Input, Switch, Textarea, Typography } from "@material-tailwind/react"

interface Props {
  question: FillInTheBlankQuizQuestion
  onChange: (question: FillInTheBlankQuizQuestion) => void
}

export const QuizFillInTheBlank = ({ question, onChange }: Props) => {
  const handleSettingsChange = (settings: FillInTheBlankSettings) => {
    onChange({
      ...question,
      settings,
    })
  }

  return (
    <div className="mt-4">
      <div className="flex flex-row gap-4 mb-4">
        <div className="flex flex-row gap-2">
          <Typography
            variant="small"
            className={
              question.settings.multiLine ? "" : "font-bold text-gray-900"
            }
          >
            Single Line
          </Typography>
          <Switch
            onChange={() =>
              handleSettingsChange({
                ...question.settings,
                multiLine: !question.settings.multiLine,
              })
            }
            checked={question.settings.multiLine}
            crossOrigin={"anonymous"}
          />
          <Typography
            variant="small"
            className={
              question.settings.multiLine ? "font-bold text-gray-900" : ""
            }
          >
            Multi-Line
          </Typography>
        </div>
      </div>
      {question.settings.multiLine ? (
        <Textarea label="Content" />
      ) : (
        <Input label="Content" crossOrigin={"anonymous"} />
      )}
    </div>
  )
}
