import { PaperAirplaneIcon } from "@heroicons/react/24/solid"
import { Card, IconButton, Textarea } from "@material-tailwind/react"
import { ScrollArea } from "../ui/scroll-area"

export const Window = () => {
  return (
    <div className="w-full">
      <ScrollArea className="h-[calc(100vh-15rem)] bg-white">
        <div>Window</div>
      </ScrollArea>
      <Card className="mt-4">
        <Textarea
          label="Content"
          className="-mb-[7px] placeholder:opacity-100 focus:border-t-primary border-t-blue-gray-200"
          labelProps={{
            className: "hidden",
          }}
          placeholder="Ask me anything..."
          autoFocus
        />
        <div className="absolute bottom-3 right-3">
          <IconButton className="rounded-full" color="blue">
            <PaperAirplaneIcon className="w-6 h-6" />
          </IconButton>
        </div>
      </Card>
    </div>
  )
}
