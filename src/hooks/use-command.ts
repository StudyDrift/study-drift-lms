"use client"
import { Command } from "@/models/command.model"
import { setExecutedCommandId } from "@/redux/slices/commands.slice"
import { useRouter } from "next/navigation"
import { useDispatch } from "react-redux"

export const useCommand = () => {
  const router = useRouter()
  const dispatch = useDispatch()

  const execute = (command: Command) => {
    if (command.actionType === "link") {
      router.push(command.action)
    } else if (command.actionType === "callback") {
      dispatch(setExecutedCommandId(command.id))
    }
  }

  return [execute]
}
