import InitializedMDXEditor from "@/components/editor/InitializedMDXEditor"
import { ContentItem } from "@/models/content.model"
import { Card } from "@material-tailwind/react"
import { MDXEditorMethods } from "@mdxeditor/editor"
import { useEffect, useRef } from "react"

interface Props {
  item: ContentItem
  onChange: (item: ContentItem) => void
}

export const ContentTypeContent = ({ item, onChange }: Props) => {
  const editor = useRef<MDXEditorMethods>(null)

  useEffect(() => {
    editor.current?.setMarkdown(item.body || "")
  }, [item])

  return (
    <Card className="min-h-96">
      <InitializedMDXEditor
        editorRef={editor}
        markdown={item.body || ""}
        onChange={(body) => onChange({ ...item, body })}
        contentEditableClassName="prose"
        placeholder="Start typing here..."
      />
    </Card>
  )
}
