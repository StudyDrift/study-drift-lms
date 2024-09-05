import { ContentItem } from "@/models/content.model"
import { ContentTypeContent } from "./content"
import { ContentTypeLink } from "./link"
import { ContentTypeQuiz } from "./quiz"

interface Props {
  item: ContentItem
  onChange: (item: ContentItem) => void
}

export const ContentTypeEditors = ({ item, onChange }: Props) => {
  switch (item.contentTypeId) {
    case "content":
      return <ContentTypeContent item={item} onChange={onChange} />
    case "link":
      return <ContentTypeLink item={item} onChange={onChange} />
    case "quiz":
      return <ContentTypeQuiz item={item} onChange={onChange} />
    default:
      return <p>TODO: {item.contentTypeId}</p>
  }
}
