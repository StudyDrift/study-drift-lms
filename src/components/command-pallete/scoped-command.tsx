import { Command } from "@/models/command.model"
import {
  appendScopedCommand,
  removeScopedCommand,
  selectExecutedCommandId,
  setExecutedCommandId,
} from "@/redux/slices/commands.slice"
import { useEffect, useRef } from "react"
import { useDispatch, useSelector } from "react-redux"

interface Props {
  children: React.ReactNode
  command: Omit<Command, "permission">
}

type Callback = () => void

export const ScopedCommand = ({ children, command }: Props) => {
  const newCommand = { ...command }
  const dispatch = useDispatch()
  const commandSet = useRef("")
  const action = useRef<Callback>()
  const executedCommandId = useSelector(selectExecutedCommandId)

  useEffect(() => {
    if (commandSet.current !== newCommand.id) {
      if (newCommand.actionType === "callback") {
        action.current = newCommand.action as Callback
        dispatch(
          appendScopedCommand({
            ...newCommand,
            action: "",
          })
        )
      } else {
        dispatch(appendScopedCommand(newCommand))
      }
      commandSet.current = newCommand.id
    }

    return () => {
      commandSet.current = ""
      dispatch(removeScopedCommand(newCommand.id))
    }
  }, [dispatch, newCommand])

  useEffect(() => {
    if (executedCommandId === newCommand.id) {
      if (newCommand.actionType === "callback") {
        if (action.current) {
          action.current()
          dispatch(setExecutedCommandId(undefined))
        }
      }
    }

    return () => {
      if (executedCommandId === newCommand.id) {
        dispatch(setExecutedCommandId(undefined))
      }
    }
  }, [executedCommandId, newCommand, dispatch])

  return <>{children}</>
}
