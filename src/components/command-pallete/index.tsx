import { useCommand } from "@/hooks/use-command"
import { Command as CommandModel } from "@/models/command.model"
import { useGetCommandsQuery } from "@/redux/services/command.api"
import { selectScopedCommands } from "@/redux/slices/commands.slice"
import { PackageIcon } from "lucide-react"
import { useParams } from "next/navigation"
import { useState } from "react"
import { useHotkeys, useHotkeysContext } from "react-hotkeys-hook"
import { useSelector } from "react-redux"
import OutsideClickClose from "../events/outside-click"
import { getIcon } from "../icons"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "../ui/command"

export const CommandPallete = () => {
  const [isOpen, setIsOpen] = useState(false)
  const [isActionMode, setIsActionMode] = useState(false)
  const { toggleScope } = useHotkeysContext()
  const { courseId } = useParams<{ courseId?: string }>()

  const { data: commands } = useGetCommandsQuery({
    courseId,
  })

  const scopedCommands = useSelector(selectScopedCommands)

  const allCommands = [...(commands || []), ...scopedCommands]
  const filteredCommands = allCommands.filter((c) => {
    if (isActionMode) {
      return c.actionType === "callback"
    }

    return true
  })

  const availableCommands =
    filteredCommands.reduce((acc, command) => {
      if (!acc[command.group]) {
        acc[command.group] = []
      }
      acc[command.group].push(command)
      return acc
    }, {} as { [key: string]: CommandModel[] }) || {}

  const toggle = () => {
    setIsOpen(!isOpen)
    toggleScope("commands")
    setIsActionMode(false)
  }

  useHotkeys("meta+k", () => toggle(), { scopes: ["global"] })
  useHotkeys("ctrl+k", () => toggle(), { scopes: ["global"] })
  useHotkeys("esc", () => toggle(), { scopes: ["commands"] })

  const [executeCommand] = useCommand()

  if (!isOpen) return null

  const getCommandIcon = (command: CommandModel) => {
    const Icon = getIcon(command.icon)
    if (Icon) {
      return <Icon className="h-4 w-4 mr-2" />
    }

    return <PackageIcon className="h-4 w-4 mr-2" />
  }

  return (
    <OutsideClickClose onClose={toggle}>
      <div className="absolute flex w-screen justify-center mt-20 z-[9999]">
        <Command
          className={
            "rounded-lg border shadow-2xl min-w-[450px] max-w-[600px] relative" +
            (isActionMode ? " animate-quick-pulse" : "")
          }
        >
          {isActionMode && (
            <span className="rounded-lg bg-green-700 text-white px-3 py-0.5 absolute top-[12px] left-9 text-sm">
              Actions
            </span>
          )}
          <CommandInput
            placeholder={
              isActionMode
                ? "Press 'Tab' for everything"
                : "Press 'Tab' for actions"
            }
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Escape") toggle()
              if (e.key === "Tab") {
                e.preventDefault()
                setIsActionMode(!isActionMode)
              }
            }}
            className={
              "rounded-t-lg text-md py-6 " + (isActionMode ? "pl-20" : "")
            }
          />
          <CommandList>
            <CommandEmpty>No results found.</CommandEmpty>
            {Object.entries(availableCommands).map(([key, value], i) => (
              <div key={key + i}>
                <CommandSeparator />
                <CommandGroup heading={key}>
                  {value.map((command, commandIndex) => (
                    <CommandItem
                      key={key + i + command.name + commandIndex}
                      onSelect={() => {
                        setIsOpen(false)
                        toggle()
                        executeCommand(command)
                      }}
                    >
                      {getCommandIcon(command)}
                      <span>{command.name}</span>{" "}
                      <span className="hidden">{command.group}</span>
                      {command.hotkey && (
                        <CommandShortcut>{command.hotkey}</CommandShortcut>
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </div>
            ))}
          </CommandList>
        </Command>
      </div>
    </OutsideClickClose>
  )
}
