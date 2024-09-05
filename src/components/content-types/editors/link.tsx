import { ContentItem } from "@/models/content.model"

interface Props {
  item: ContentItem
  onChange: (item: ContentItem) => void
}

export const ContentTypeLink = ({ item, onChange }: Props) => {
  return <p>TODO: Link</p>
}
