import { SortableList } from "@/components/dnd/sortable-list"
import InitializedMDXEditor from "@/components/editor/InitializedMDXEditor"
import { ContentItem } from "@/models/content.model"
import { QuizQuestion } from "@/models/quiz.model"
import { TrashIcon } from "@heroicons/react/24/solid"
import {
  Button,
  Card,
  IconButton,
  Option,
  Select,
  Typography,
} from "@material-tailwind/react"
import { MDXEditorMethods } from "@mdxeditor/editor"
import { nanoid } from "nanoid"
import { useEffect, useRef, useState } from "react"

interface Props {
  item: ContentItem
  onChange: (item: ContentItem) => void
}

const QUESTION_TYPES = [
  { name: "Multiple Choice", value: "multiple-choice" },
  { name: "True/False", value: "true-false" },
  { name: "Fill In The Blank", value: "fill-in-the-blank" },
]

export const ContentTypeQuiz = ({ item, onChange }: Props) => {
  const [questions, setQuestions] = useState<QuizQuestion[]>([])

  const handleAddQuestion = () => {
    setQuestions([
      ...questions,
      {
        id: nanoid(),
        type: "multiple-choice",
        content: "This is an example question",
        choices: [
          { id: nanoid(), content: "Choice 1", isCorrect: false },
          { id: nanoid(), content: "Choice 2", isCorrect: false },
          { id: nanoid(), content: "Choice 3", isCorrect: false },
          { id: nanoid(), content: "Choice 4", isCorrect: false },
        ],
      },
    ])
  }

  const handleOrderChange = (items: QuizQuestion[]) => {
    setQuestions(items)
    // onChange({
    //   ...item,
    //   body: JSON.stringify(items),
    // })
  }

  const handleQuestionChange = (
    question: QuizQuestion,
    key: string,
    value: string
  ) => {
    const find = questions.find((q) => q.id === question.id)
    const index = questions.indexOf(find!)
    ;(question as any)[key] = value
    questions[index] = question
    setQuestions([...questions])
  }

  const handleQuestionRemoval = (question: QuizQuestion) => {
    setQuestions(questions.filter((q) => q.id !== question.id))
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
                onChange={(e) => {
                  handleQuestionChange(q, "type", e ?? "multiple-choice")
                }}
              >
                {QUESTION_TYPES.map((t) => (
                  <Option key={t.value} value={t.value} onClick={() => {}}>
                    {t.name}
                  </Option>
                ))}
              </Select>
              <div className="mt-4">
                <Typography variant="h6">Question Content</Typography>
                <div className="border border-gray-200 rounded-xl">
                  <QuestionContentEditor
                    content={q.content}
                    onChange={(content) =>
                      handleQuestionChange(q, "content", content)
                    }
                  />
                </div>
              </div>
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

const QuestionContentEditor = ({
  content,
  onChange,
}: {
  content: string
  onChange: (content: string) => void
}) => {
  const editor = useRef<MDXEditorMethods>(null)

  useEffect(() => {
    editor.current?.setMarkdown(content || "")
  }, [content])

  return (
    <InitializedMDXEditor
      editorRef={editor}
      markdown={content || ""}
      onChange={(body) => onChange(body)}
      contentEditableClassName="prose"
      placeholder="Start typing here..."
    />
  )
}
