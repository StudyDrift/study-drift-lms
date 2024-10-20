import { User } from "@/models/user.model"
import { createSlice } from "@reduxjs/toolkit"

export interface AuthState {
  token: string
  userId?: string
  user?: User
}

const initialState: AuthState = {
  token: "",
  userId: undefined,
  user: undefined,
}

export const authSlice = createSlice({
  name: "auth",
  initialState,
  reducers: {
    setToken: (state, action) => {
      state.token = action.payload
    },
    setUserId: (state, action) => {
      state.userId = action.payload
    },
    setUser: (state, action) => {
      state.user = action.payload
    },
  },
})

export const selectUser = (state: { auth: AuthState }) => state.auth.user
export const selectToken = (state: { auth: AuthState }) => state.auth.token

export const { setToken, setUserId, setUser } = authSlice.actions

export default authSlice.reducer
