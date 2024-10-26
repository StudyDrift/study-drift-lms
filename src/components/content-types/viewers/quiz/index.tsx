import { ContentItem } from "@/models/content.model"
import {
  FillInTheBlankQuizQuestion,
  MultipleChoiceQuizQuestion,
  QuizQuestion,
} from "@/models/quiz.model"
import { Card, CardBody, Typography } from "@material-tailwind/react"
import Markdown from "react-markdown"
import rehypeRaw from "rehype-raw"
import remarkGfm from "remark-gfm"
import { QuizFillInTheBlank } from "./fill-in-the-blank"
import { QuizMultipleChoice } from "./multiple-choice"

interface Props {
  item: ContentItem
}

export const ContentTypeQuiz = ({ item }: Props) => {
  const questions = item.meta?.questions || ([] as QuizQuestion[])

  const getQuestionType = (question: QuizQuestion) => {
    switch (question.type) {
      case "multiple-choice":
        return (
          <QuizMultipleChoice
            question={question as MultipleChoiceQuizQuestion}
          />
        )
      case "fill-in-the-blank":
        return (
          <QuizFillInTheBlank
            question={question as FillInTheBlankQuizQuestion}
          />
        )
      default:
        return "Unknown"
    }
  }

  return (
    <div className="flex flex-col gap-4">
      Test
      <Markdown
        className="prose"
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw]}
      >
        {item.body}
      </Markdown>
      {questions.map((q: QuizQuestion, i: number) => (
        <Card key={q.id}>
          <Typography variant="small" className="mt-3 ml-3">
            Question {i + 1}
          </Typography>
          <CardBody className="pt-0">
            <Markdown
              className="prose"
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeRaw]}
            >
              {q.content}
            </Markdown>
            {getQuestionType(q)}
          </CardBody>
        </Card>
      ))}
    </div>
  )
}
