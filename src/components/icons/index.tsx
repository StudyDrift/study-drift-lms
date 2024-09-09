import {
  ChatBubbleLeftIcon,
  CogIcon,
  DocumentIcon,
  LinkIcon,
  UsersIcon,
} from "@heroicons/react/24/solid"
import {
  LetterCaseCapitalizeIcon,
  LockClosedIcon,
  QuestionMarkIcon,
} from "@radix-ui/react-icons"
import {
  Calendar,
  HeadingIcon,
  HomeIcon,
  LayoutDashboardIcon,
  ListCheckIcon,
  NotebookIcon,
  School2Icon,
  StampIcon,
} from "lucide-react"

export const AvailableIcons = {
  LinkIcon,
  DocumentIcon,
  QuestionMarkIcon,
  LayoutDashboardIcon,
  School2Icon,
  Calendar,
  ListCheckIcon,
  LockClosedIcon,
  HomeIcon,
  ChatBubbleLeftIcon,
  StampIcon,
  NotebookIcon,
  LetterCaseCapitalizeIcon,
  CogIcon,
  UsersIcon,
  HeadingIcon,
}

export const getIcon = (name?: string) => {
  if (!name) return LinkIcon

  if (name in AvailableIcons) {
    return (AvailableIcons as any)[name]
  }
  return LinkIcon
}
