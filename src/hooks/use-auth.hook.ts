import { useGetTokenAndClaimsQuery } from "@/redux/services/auth.api"
import { setToken, setUser } from "@/redux/slices/auth.slice"
import { usePathname, useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { useDispatch } from "react-redux"

export const useAuth = () => {
  const path = usePathname()
  const {
    data: token,
    error: getTokenError,
    isLoading,
  } = useGetTokenAndClaimsQuery(undefined, {
    skip: path.includes("/auth/login") || path.includes("/auth/register"),
  })

  const dispatch = useDispatch()
  const [isSet, setIsSet] = useState(false)
  const router = useRouter()

  useEffect(() => {
    if (getTokenError) {
      router.push("/auth/login")
    }
  }, [getTokenError, router])

  useEffect(() => {
    if (path.includes("/auth/")) {
      setIsSet(true)
      return
    }

    if (token?.token && !isSet) {
      dispatch(setToken(token.token))
      dispatch(setUser(token.claims.user))
      setIsSet(true)
    }

    if (!token?.token && !isLoading) {
      router.push("/auth/login")
    }
  }, [token, dispatch, path, isSet, setIsSet, isLoading, router])

  return isSet
}
