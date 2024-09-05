import { DocumentIcon, LinkIcon } from "@heroicons/react/24/solid"
import { QuestionMarkIcon } from "@radix-ui/react-icons"

export const AvailableIcons = {
  LinkIcon: LinkIcon,
  DocumentIcon: DocumentIcon,
  QuestionMarkIcon: QuestionMarkIcon,
}

export const getIcon = (name?: string) => {
  if (!name) return LinkIcon

  if (name in AvailableIcons) {
    return (AvailableIcons as any)[name]
  }
  return LinkIcon
}
