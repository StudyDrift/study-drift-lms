"use client"
// InitializedMDXEditor.tsx
import {
  MDXEditor,
  SandpackConfig,
  type MDXEditorMethods,
  type MDXEditorProps,
} from "@mdxeditor/editor"
import "@mdxeditor/editor/style.css"
import type { ForwardedRef } from "react"
import { ALL_PLUGINS } from "./plugins"

const defaultSnippetContent = `
export default function App() {
  return (
    <div className="App">
      <h1>Hello CodeSandbox</h1>
      <h2>Start editing to see some magic happen!</h2>
    </div>
  );
}
`.trim()

const simpleSandpackConfig: SandpackConfig = {
  defaultPreset: "react",
  presets: [
    {
      label: "React",
      name: "react",
      meta: "live react",
      sandpackTemplate: "react",
      sandpackTheme: "light",
      snippetFileName: "/App.js",
      snippetLanguage: "jsx",
      initialSnippetContent: defaultSnippetContent,
    },
  ],
}

// Only import this to the next file
export default function InitializedMDXEditor({
  editorRef,
  ...props
}: { editorRef: ForwardedRef<MDXEditorMethods> | null } & MDXEditorProps) {
  return <MDXEditor plugins={ALL_PLUGINS} {...props} ref={editorRef} />
}
