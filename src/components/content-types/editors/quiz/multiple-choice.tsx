import { SortableList } from "@/components/dnd/sortable-list"
import {
  MultipleChoiceQuizQuestion,
  QuizQuestionChoice,
} from "@/models/quiz.model"
import { CheckCircleIcon, PlusIcon } from "@heroicons/react/24/outline"
import {
  CheckCircleIcon as CheckIcon,
  TrashIcon,
} from "@heroicons/react/24/solid"
import {
  IconButton,
  Input,
  ListItem,
  ListItemPrefix,
  ListItemSuffix,
} from "@material-tailwind/react"
import { nanoid } from "nanoid"
import { useState } from "react"

interface Props {
  question: MultipleChoiceQuizQuestion
  onChange: (question: MultipleChoiceQuizQuestion) => void
}

export const QuizMultipleChoice = ({ question, onChange }: Props) => {
  const [choices, setChoices] = useState(question.choices)

  const handleOrderChange = (items: QuizQuestionChoice[]) => {
    setChoices(items)
    onChange({
      ...question,
      choices: items,
    })
  }

  const setCorrect = (choice: QuizQuestionChoice) => {
    const newChoices = choices.map((q) => {
      return {
        ...q,
        isCorrect: q.id === choice.id,
      }
    })
    setChoices(newChoices)

    onChange({
      ...question,
      choices: newChoices,
    })
  }

  const handleAddChoice = () => {
    const newChoices = [
      ...choices,
      {
        id: nanoid(),
        content: "",
        isCorrect: false,
      },
    ]
    setChoices(newChoices)

    onChange({
      ...question,
      choices: newChoices,
    })
  }

  const handleChoiceTextChange = (
    choice: QuizQuestionChoice,
    value: string
  ) => {
    const find = choices.find((q) => q.id === choice.id)
    const index = choices.indexOf(find!)

    const newChoices = [...choices]
    const newChoice = { ...choice, content: value }

    newChoices[index] = newChoice

    setChoices(newChoices)

    onChange({
      ...question,
      choices: newChoices,
    })
  }

  return (
    <div>
      <SortableList
        id={question.id + "-multiple-choice"}
        items={choices}
        onChange={handleOrderChange}
        renderItem={(q, i) => (
          <SortableList.Item id={q.id} key={q.id}>
            <ListItem ripple={false} className="w-full hover:bg-transparent">
              <ListItemPrefix className="flex flex-row gap-2">
                <SortableList.DragHandle />
                <IconButton
                  onClick={() => setCorrect(q)}
                  variant="text"
                  size="sm"
                >
                  {q.isCorrect ? (
                    <CheckIcon className="h-5 w-5 text-green-500" />
                  ) : (
                    <CheckCircleIcon className="h-5 w-5" />
                  )}
                </IconButton>
              </ListItemPrefix>
              <Input
                value={q.content}
                onChange={(e) => handleChoiceTextChange(q, e.target.value)}
                className="w-full"
                label={i + 1 + ". "}
                crossOrigin={"anonymous"}
              />
              <ListItemSuffix className="ml-2">
                <IconButton
                  onClick={() =>
                    setChoices(choices.filter((o) => o.id !== q.id))
                  }
                  variant="text"
                  size="sm"
                >
                  <TrashIcon className="h-5 w-5" />
                </IconButton>
              </ListItemSuffix>
            </ListItem>
          </SortableList.Item>
        )}
      />
      <ListItem
        className="flex flex-row gap-2 items-center justify-center bg-gray-200 text-gray-900 rounded-md p-2"
        ripple={false}
        onClick={handleAddChoice}
      >
        <PlusIcon className="h-4 w-4 mr-2" />
        Add Choice
      </ListItem>
    </div>
  )
}
