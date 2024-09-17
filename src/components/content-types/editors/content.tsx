import { Editor } from "@/components/editor"
import { ContentItem } from "@/models/content.model"

interface Props {
  item: ContentItem
  onChange: (item: ContentItem) => void
}

export const ContentTypeContent = ({ item, onChange }: Props) => {
  return (
    <Editor
      value={item.body}
      onChange={(body) => onChange({ ...item, body })}
    />
  )
}
