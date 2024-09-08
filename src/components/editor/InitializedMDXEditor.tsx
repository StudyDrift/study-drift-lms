"use client"
// InitializedMDXEditor.tsx
import {
  MDXEditor,
  type MDXEditorMethods,
  type MDXEditorProps,
} from "@mdxeditor/editor"
import "@mdxeditor/editor/style.css"
import type { ForwardedRef } from "react"
import { ALL_PLUGINS } from "./plugins"

// Only import this to the next file
export default function InitializedMDXEditor({
  editorRef,
  ...props
}: { editorRef: ForwardedRef<MDXEditorMethods> | null } & MDXEditorProps) {
  return <MDXEditor plugins={ALL_PLUGINS} {...props} ref={editorRef} />
}
