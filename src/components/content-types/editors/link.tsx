import { Editor } from "@/components/editor"
import { ContentItem } from "@/models/content.model"
import { Input, Typography } from "@material-tailwind/react"

interface Props {
  item: ContentItem
  onChange: (item: ContentItem) => void
}

export const ContentTypeLink = ({ item, onChange }: Props) => {
  return (
    <div>
      <Typography variant="small" className="font-bold">
        Content to Introduce Link
      </Typography>
      <Editor
        value={item.meta?.description || ""}
        onChange={(description) =>
          onChange({ ...item, meta: { ...item.meta, description } })
        }
        className="min-h-60"
      />
      <div className="mt-6">
        <Input
          label="Link Name"
          value={item.meta?.linkName || ""}
          onChange={(e) =>
            onChange({
              ...item,
              meta: { ...item.meta, linkName: e.target.value },
            })
          }
          crossOrigin={"anonymous"}
        />
      </div>
      <div className="mt-6">
        <Input
          label="External Link"
          value={item.meta?.url || ""}
          onChange={(e) =>
            onChange({ ...item, meta: { ...item.meta, url: e.target.value } })
          }
          crossOrigin={"anonymous"}
        />
      </div>
    </div>
  )
}
