"use client"
import { useAuth } from "@/hooks/use-auth.hook"
import { useColorScheme } from "@/hooks/use-color-scheme.hook"
import { THEMES } from "@/lib/theme"
import { ColorScheme } from "@/models/user-settings.model"
import { store } from "@/redux/store"
import { ThemeProvider } from "@material-tailwind/react"
import { usePathname } from "next/navigation"
import { HotkeysProvider } from "react-hotkeys-hook"
import { Provider } from "react-redux"
import { CommandPallete } from "../command-pallete"
import { Spinner } from "../loaders/spinner"
import { SideNav } from "../sidenav"

export const Providers = ({ children }: { children: React.ReactNode }) => {
  return (
    <Provider store={store}>
      <HotkeysProvider initiallyActiveScopes={["global"]}>
        <AuthProvider>
          <CustomThemeProvider>
            <SideNavProvider>
              <CommandsProvider>{children}</CommandsProvider>
            </SideNavProvider>
          </CustomThemeProvider>
        </AuthProvider>
      </HotkeysProvider>
    </Provider>
  )
}

const CommandsProvider = ({ children }: { children: React.ReactNode }) => {
  return (
    <>
      <CommandPallete />
      {children}
    </>
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

export const CustomThemeProvider = ({ children }: { children: any }) => {
  const scheme = useColorScheme()

  return (
    <ThemeProvider value={THEMES[scheme || ColorScheme.Light]}>
      {children}
    </ThemeProvider>
  )
}
