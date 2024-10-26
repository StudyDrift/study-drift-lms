import { RootPage } from "@/components/root-page"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"

export default function Page() {
  async function handleLogin() {
    const cookiesContainer = await cookies()
    if (!cookiesContainer.get("auth")) {
      return redirect("/auth/login")
    }
  }

  handleLogin()

  return (
    <RootPage>
      <p>hello</p>
    </RootPage>
  )
}
