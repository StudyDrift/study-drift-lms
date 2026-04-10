import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { matchPath, useLocation } from 'react-router-dom'
import { getAccessToken } from '../lib/auth'
import { courseViewStorageKey, getCourseViewAs } from '../lib/courseViewAs'
import { anyGrantMatches } from '../lib/permissionMatch'
import { fetchMyPermissionStrings } from '../lib/rbacApi'
import { PermissionsContext } from './permissionsContext'

function courseCodeFromPathname(pathname: string): string | null {
  const m = matchPath({ path: '/courses/:courseCode', end: false }, pathname)
  return m?.params.courseCode ?? null
}

export function PermissionsProvider({ children }: { children: ReactNode }) {
  const location = useLocation()
  /** Always read the latest path inside async refresh (e.g. auth / view-as events). */
  const pathnameRef = useRef(location.pathname)
  pathnameRef.current = location.pathname

  const courseCodeFromRoute = useMemo(
    () => courseCodeFromPathname(location.pathname),
    [location.pathname],
  )

  const [permissionStrings, setPermissionStrings] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const token = getAccessToken()
    if (!token) {
      setPermissionStrings([])
      setLoading(false)
      setError(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const courseCode = courseCodeFromPathname(pathnameRef.current)
      let list: string[]
      if (courseCode && getCourseViewAs(courseCode) === 'student') {
        try {
          list = await fetchMyPermissionStrings({ courseCode, viewAs: 'student' })
        } catch {
          if (typeof localStorage !== 'undefined') {
            localStorage.removeItem(courseViewStorageKey(courseCode))
          }
          list = await fetchMyPermissionStrings()
        }
      } else {
        list = await fetchMyPermissionStrings()
      }
      setPermissionStrings(list)
    } catch (e) {
      setPermissionStrings([])
      setError(e instanceof Error ? e.message : 'Could not load permissions.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    // Refetch when the *course* context changes (including leaving a course), not on every
    // in-course path segment change — otherwise `loading` flashes and permission-gated nav
    // (e.g. Gradebook) appears late on every page transition.
  }, [courseCodeFromRoute, refresh])

  useEffect(() => {
    const onAuth = () => void refresh()
    const onView = () => void refresh()
    window.addEventListener('studydrift-auth-token', onAuth)
    window.addEventListener('studydrift-course-view-as', onView)
    return () => {
      window.removeEventListener('studydrift-auth-token', onAuth)
      window.removeEventListener('studydrift-course-view-as', onView)
    }
  }, [refresh])

  const allows = useCallback(
    (required: string) => anyGrantMatches(permissionStrings, required),
    [permissionStrings],
  )

  const value = useMemo(
    () => ({
      permissionStrings,
      loading,
      error,
      allows,
      refresh,
    }),
    [permissionStrings, loading, error, allows, refresh],
  )

  return <PermissionsContext.Provider value={value}>{children}</PermissionsContext.Provider>
}
