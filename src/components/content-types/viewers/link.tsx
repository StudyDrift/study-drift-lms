import PrismLoader from "@/components/prism/prism-loader"
import { ContentItem } from "@/models/content.model"
import { ArrowTopRightOnSquareIcon } from "@heroicons/react/24/solid"
import { Button, Card, CardBody } from "@material-tailwind/react"
import Markdown from "react-markdown"
import rehypeRaw from "rehype-raw"
import remarkGfm from "remark-gfm"

interface Props {
  item: ContentItem
}

export const ContentTypeLink = ({ item }: Props) => {
  return (
    <Card>
      <CardBody>
        <Markdown
          className="prose"
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeRaw]}
        >
          {item.body}
        </Markdown>
        <a href={item.meta?.url} target="_blank">
          <Button className="mt-4 flex items-center">
            <ArrowTopRightOnSquareIcon className="mr-2 h-4 w-4" />
            {item.meta?.linkName || "Link Name"}
          </Button>
        </a>
      </CardBody>
      <PrismLoader />
    </Card>
  )
}
