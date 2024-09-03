import { RootPage } from "@/components/root-page"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"

export default function Page() {
  if (!cookies().get("auth")) {
    return redirect("/auth/login")
  }

  return (
    <RootPage>
      <p>hello</p>
    </RootPage>
  )
}
