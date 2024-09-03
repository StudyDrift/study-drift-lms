"use client"
import { useAuth } from "@/hooks/use-auth.hook"
import { store } from "@/redux/store"
import { Provider } from "react-redux"
import { Spinner } from "../loaders/spinner"

export const Providers = ({ children }: { children: React.ReactNode }) => {
  return (
    <Provider store={store}>
      <AuthProvider>{children}</AuthProvider>
    </Provider>
  )
}

const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const isSet = useAuth()
  if (!isSet)
    return (
      <div className="w-screen h-screen flex items-center justify-center flex-col bg-gray-900">
        <div>
          <Spinner />
          <p className="text-center text-white">Authenticating...</p>
        </div>
      </div>
    )

  return <>{children}</>
}
