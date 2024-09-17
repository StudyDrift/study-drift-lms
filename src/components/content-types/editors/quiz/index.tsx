import { SortableList } from "@/components/dnd/sortable-list"
import { Editor } from "@/components/editor"
import { ContentItem } from "@/models/content.model"
import {
  FillInTheBlankQuizQuestion,
  MultipleChoiceQuizQuestion,
  QuizQuestion,
} from "@/models/quiz.model"
import { TrashIcon } from "@heroicons/react/24/solid"
import {
  Button,
  Card,
  IconButton,
  Option,
  Select,
  Typography,
} from "@material-tailwind/react"
import { nanoid } from "nanoid"
import { useState } from "react"
import { QuizFillInTheBlank } from "./fill-in-the-blank"
import { QuizMultipleChoice } from "./multiple-choice"

interface Props {
  item: ContentItem
  onChange: (item: ContentItem) => void
}

const QUESTION_TYPES = [
  { name: "Multiple Choice", value: "multiple-choice" },
  { name: "Fill In The Blank", value: "fill-in-the-blank" },
]

export const ContentTypeQuiz = ({ item, onChange }: Props) => {
  const [questions, setQuestions] = useState<QuizQuestion[]>(
    item.meta?.questions || []
  )

  const handleAddQuestion = () => {
    setQuestions([
      ...questions,
      {
        id: nanoid(),
        type: "multiple-choice",
        content: "This is an example question",
        choices: [
          { id: nanoid(), content: "", isCorrect: false },
          { id: nanoid(), content: "", isCorrect: false },
          { id: nanoid(), content: "", isCorrect: true },
          { id: nanoid(), content: "", isCorrect: false },
        ],
      } as MultipleChoiceQuizQuestion,
    ])

    onChange({
      ...item,
      meta: {
        questions: questions,
      },
    })
  }

  const handleOrderChange = (items: QuizQuestion[]) => {
    setQuestions(items)
    onChange({
      ...item,
      meta: {
        questions: questions,
      },
    })
  }

  const handleQuestionChange = (
    question: QuizQuestion,
    key: string,
    value: any
  ) => {
    const find = questions.find((q) => q.id === question.id)
    const index = questions.indexOf(find!)
    const newQuestion = { ...question }
    ;(newQuestion as any)[key] = value

    const newQuestions = [...questions]
    newQuestions[index] = newQuestion
    setQuestions([...newQuestions])

    onChange({
      ...item,
      meta: {
        questions: newQuestions,
      },
    })
  }

  const handleQuestionRemoval = (question: QuizQuestion) => {
    setQuestions(questions.filter((q) => q.id !== question.id))

    onChange({
      ...item,
      meta: {
        questions: questions,
      },
    })
  }

  const handleQuestionTypeChange = (question: QuizQuestion, type: string) => {
    const newQuestion = { ...question, type: type } as QuizQuestion

    switch (type) {
      case "multiple-choice":
        ;(newQuestion as MultipleChoiceQuizQuestion).choices = []
        break
      case "fill-in-the-blank":
        ;(newQuestion as FillInTheBlankQuizQuestion).settings = {
          multiLine: false,
        }
        break
    }

    handleQuestionChange(newQuestion, "type", newQuestion.type)
  }

  const getQuestionType = (question: QuizQuestion) => {
    switch (question.type) {
      case "multiple-choice":
        return (
          <QuizMultipleChoice
            question={question as MultipleChoiceQuizQuestion}
            onChange={(q) => handleQuestionChange(q, "choices", q.choices)}
          />
        )
      case "fill-in-the-blank":
        return (
          <QuizFillInTheBlank
            question={question as FillInTheBlankQuizQuestion}
            onChange={(q) => handleQuestionChange(q, "settings", q.settings)}
          />
        )
    }
  }

  return (
    <div className="w-full flex flex-col gap-5">
      <Typography variant="h5">Questions</Typography>
      <SortableList
        id={item.id + "-questions"}
        items={questions}
        onChange={handleOrderChange}
        renderItem={(q, i) => (
          <SortableList.Item id={q.id} key={q.id}>
            <Card key={i} className="w-full flex flex-col gap-2 p-4">
              <div className="flex flex-row justify-between">
                <Typography variant="h6" className="mb-2">
                  <SortableList.DragHandle /> Question {i + 1}
                </Typography>
                <IconButton
                  variant="text"
                  onClick={() => handleQuestionRemoval(q)}
                >
                  <TrashIcon className="w-4 h-4" />
                </IconButton>
              </div>
              <Select
                label="Question Type"
                value={q.type}
                onChange={(e) => handleQuestionTypeChange(q, e + "")}
              >
                {QUESTION_TYPES.map((t) => (
                  <Option key={t.value} value={t.value} onClick={() => {}}>
                    {t.name}
                  </Option>
                ))}
              </Select>
              <div className="mt-4">
                <Typography variant="h6">Question Content</Typography>
                <div className="border border-gray-300 rounded-xl">
                  <Editor
                    value={q.content}
                    onChange={(content) =>
                      handleQuestionChange(q, "content", content)
                    }
                  />
                </div>
              </div>
              <div className="mt-4">{getQuestionType(q)}</div>
            </Card>
          </SortableList.Item>
        )}
      />
      <Button
        className="w-full"
        color="blue-gray"
        variant="outlined"
        ripple={false}
        onClick={handleAddQuestion}
      >
        Add Question
      </Button>
    </div>
  )
}
