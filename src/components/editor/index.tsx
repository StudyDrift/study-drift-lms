import { Card } from "@material-tailwind/react"
import { MDXEditorMethods } from "@mdxeditor/editor"
import { useEffect, useRef } from "react"
import InitializedMDXEditor from "./InitializedMDXEditor"

interface Props {
  value?: string
  onChange: (value: string) => void
  className?: string
}

export const Editor = ({ onChange, value, className }: Props) => {
  const editor = useRef<MDXEditorMethods>(null)
  const isSet = useRef(false)

  useEffect(() => {
    if (!isSet.current && value) {
      editor.current?.setMarkdown(value || "")
      isSet.current = true
    }
  }, [value, isSet])

  return (
    <Card className={"min-h-96 " + (className || "")}>
      <InitializedMDXEditor
        editorRef={editor}
        markdown={value || ""}
        onChange={(body) => onChange(body)}
        contentEditableClassName="prose"
        placeholder="Start typing here..."
        className="min-h-96 flex flex-col"
      />
    </Card>
  )
}
