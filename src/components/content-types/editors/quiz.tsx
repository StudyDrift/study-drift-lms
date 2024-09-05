import { ContentItem } from "@/models/content.model"

interface Props {
  item: ContentItem
  onChange: (item: ContentItem) => void
}

export const ContentTypeQuiz = ({ item, onChange }: Props) => {
  return <p>TODO: Quiz</p>
}
