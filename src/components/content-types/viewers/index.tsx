import { ContentItem } from "@/models/content.model"
import { ContentTypeContent } from "./content"
import { ContentTypeLink } from "./link"
import { ContentTypeQuiz } from "./quiz"

interface Props {
  item: ContentItem
}

export const ContentTypeViewers = ({ item }: Props) => {
  switch (item.contentTypeId) {
    case "content":
      return <ContentTypeContent item={item} />
    case "link":
      return <ContentTypeLink item={item} />
    case "quiz":
      return <ContentTypeQuiz item={item} />
    default:
      return <p>TODO: {item.contentTypeId}</p>
  }
}
