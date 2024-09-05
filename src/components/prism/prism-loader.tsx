"use client"

import Prism from "prismjs"
import "prismjs/components/prism-bash"
import "prismjs/components/prism-c"
import "prismjs/components/prism-csharp"
import "prismjs/components/prism-css"
import "prismjs/components/prism-jsx"
import "prismjs/components/prism-python"
import "prismjs/components/prism-ruby"
import "prismjs/components/prism-tsx"
import "prismjs/components/prism-typescript"
import "prismjs/components/prism-xml-doc"
import "prismjs/themes/prism-okaidia.css"
import { useEffect } from "react"

export default function PrismLoader() {
  useEffect(() => {
    Prism.highlightAll()
  }, [])
  return <div className="hidden"></div>
}
