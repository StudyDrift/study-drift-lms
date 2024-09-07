import { Command } from "@/models/command.model"
import { createSlice } from "@reduxjs/toolkit"

export interface CommandState {
  scoped: Command[]
  executedCommandId?: string
}

const initialState: CommandState = {
  scoped: [],
  executedCommandId: undefined,
}

export const commandSlice = createSlice({
  name: "command",
  initialState,
  reducers: {
    setScopedCommands: (state, action) => {
      state.scoped = action.payload
    },
    appendScopedCommand: (state, action) => {
      state.scoped.push(action.payload)
    },
    removeScopedCommand: (state, action) => {
      state.scoped = state.scoped.filter((c) => c.id !== action.payload)
    },
    setExecutedCommandId: (state, action) => {
      state.executedCommandId = action.payload
    },
  },
  extraReducers: (builder) => {},
})

export const selectScopedCommands = (state: { command: CommandState }) =>
  state.command.scoped

export const selectExecutedCommandId = (state: { command: CommandState }) =>
  state.command.executedCommandId

export const {
  setScopedCommands,
  appendScopedCommand,
  setExecutedCommandId,
  removeScopedCommand,
} = commandSlice.actions

export default commandSlice.reducer
