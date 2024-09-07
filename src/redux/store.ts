import { configureStore, ConfigureStoreOptions } from "@reduxjs/toolkit"
import { TypedUseSelectorHook, useDispatch, useSelector } from "react-redux"
import { api } from "./services/api"
import authSlice from "./slices/auth.slice"
import { commandSlice } from "./slices/commands.slice"

export const createStore = (
  options?: ConfigureStoreOptions["preloadedState"] | undefined
) =>
  configureStore({
    reducer: {
      [api.reducerPath]: api.reducer,
      auth: authSlice,
      command: commandSlice.reducer,
    },
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware().concat(api.middleware),
    ...options,
  })

export const store = createStore()

export type AppDispatch = typeof store.dispatch
export const useAppDispatch: () => AppDispatch = useDispatch
export type RootState = ReturnType<typeof store.getState>
export const useTypedSelector: TypedUseSelectorHook<RootState> = useSelector
