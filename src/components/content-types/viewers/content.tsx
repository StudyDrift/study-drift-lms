import PrismLoader from "@/components/prism/prism-loader"
import { ContentItem } from "@/models/content.model"
import { Card, CardBody } from "@material-tailwind/react"
import Markdown from "react-markdown"
import rehypeRaw from "rehype-raw"
import remarkGfm from "remark-gfm"

interface Props {
  item: ContentItem
}

export const ContentTypeContent = ({ item }: Props) => {
  return (
    <Card className="min-h-96">
      <CardBody>
        <Markdown
          className="prose"
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeRaw]}
        >
          {item.body}
        </Markdown>
      </CardBody>
      <PrismLoader />
    </Card>
  )
}
