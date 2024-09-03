"use client"
import { useAuth } from "@/hooks/use-auth.hook"
import { store } from "@/redux/store"
import { usePathname } from "next/navigation"
import { Provider } from "react-redux"
import { Spinner } from "../loaders/spinner"
import { SideNav } from "../sidenav"

export const Providers = ({ children }: { children: React.ReactNode }) => {
  return (
    <Provider store={store}>
      <AuthProvider>
        <SideNavProvider>{children}</SideNavProvider>
      </AuthProvider>
    </Provider>
  )
}

const SideNavProvider = ({ children }: { children: React.ReactNode }) => {
  const path = usePathname()
  const excludePathnames = ["/auth/login", "/auth/register", "/auth/reset"]

  if (excludePathnames.includes(path)) return <>{children}</>

  return (
    <>
      <SideNav />
      {children}
    </>
  )
}

const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const isSet = useAuth()
  if (!isSet)
    return (
      <div className="w-screen h-screen flex items-center justify-center flex-col bg-gray-900">
        <div>
          <Spinner />
          <p className="text-center text-white">Loading...</p>
        </div>
      </div>
    )

  return <>{children}</>
}
