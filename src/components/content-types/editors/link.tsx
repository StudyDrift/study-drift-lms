import InitializedMDXEditor from "@/components/editor/InitializedMDXEditor"
import { ContentItem } from "@/models/content.model"
import { Card, Input, Typography } from "@material-tailwind/react"
import { MDXEditorMethods } from "@mdxeditor/editor"
import { useEffect, useRef } from "react"

interface Props {
  item: ContentItem
  onChange: (item: ContentItem) => void
}

export const ContentTypeLink = ({ item, onChange }: Props) => {
  const editor = useRef<MDXEditorMethods>(null)

  useEffect(() => {
    editor.current?.setMarkdown(item.body || "")
  }, [item])

  return (
    <div>
      <Typography variant="small" className="font-bold">
        Content to Introduce Link
      </Typography>
      <Card className="min-h-60">
        <InitializedMDXEditor
          editorRef={editor}
          markdown={item.body || ""}
          onChange={(body) => onChange({ ...item, body })}
          contentEditableClassName="prose"
          placeholder="Start typing here..."
          className="min-h-60"
        />
      </Card>
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
