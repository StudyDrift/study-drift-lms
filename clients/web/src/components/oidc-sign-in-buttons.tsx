import { useEffect, useState } from 'react'
import { apiUrl } from '../lib/api'

type OidcStatus = {
  enabled: boolean
  cleverEnabled?: boolean
  classlinkEnabled?: boolean
  /** Legacy alias from API for Clever SSO (same meaning as cleverEnabled). */
  clever?: boolean
  /** Legacy alias from API for ClassLink SSO (same meaning as classlinkEnabled). */
  classlink?: boolean
  google?: boolean
  microsoft?: boolean
  apple?: boolean
  custom?: { id: string; displayName: string }[]
}

type Props = {
  /** In-app path after sign-in (e.g. from login location state). */
  nextPath: string
}

/**
 * Renders “Sign in with …” primary IdP controls when the API reports OIDC is enabled.
 */
export function OidcSignInButtons({ nextPath }: Props) {
  const [s, setS] = useState<OidcStatus | null>(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const res = await fetch(apiUrl('/api/v1/auth/oidc/status'))
        const raw: unknown = await res.json().catch(() => ({}))
        if (!alive) return
        setS((raw as OidcStatus) ?? { enabled: false })
      } catch {
        if (alive) setS({ enabled: false })
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  const cleverOn = !!(s?.cleverEnabled || s?.clever)
  const classlinkOn = !!(s?.classlinkEnabled || s?.classlink)

  if (!s?.enabled && !cleverOn && !classlinkOn) return null

  const nextQ = `next=${encodeURIComponent(nextPath)}`
  const p = (path: string) => apiUrl(path.includes('?') ? `${path}&${nextQ}` : `${path}?${nextQ}`)

  return (
    <div className="mb-6 space-y-2">
      {cleverOn && (
        <a
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-[#436CF6] bg-[#436CF6] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#3a5fd9]"
          href={p('/auth/clever/login')}
          aria-label="Sign in using your Clever account"
        >
          Log in with Clever
        </a>
      )}
      {classlinkOn && (
        <a
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-800 bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800"
          href={p('/auth/oidc/classlink/login')}
          aria-label="Sign in with ClassLink"
        >
          Log in with ClassLink
        </a>
      )}
      {s.enabled && s.google && (
        <a
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
          href={p('/auth/oidc/google/login')}
          aria-label="Sign in with Google"
        >
          <span className="text-[15px] font-bold text-slate-700">G</span>
          Sign in with Google
        </a>
      )}
      {s.enabled && s.microsoft && (
        <a
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
          href={p('/auth/oidc/microsoft/login')}
          aria-label="Sign in with Microsoft"
        >
          <span className="text-sm font-bold text-slate-800">M</span>
          Sign in with Microsoft
        </a>
      )}
      {s.enabled && s.apple && (
        <a
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-900 bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800"
          href={p('/auth/oidc/apple/login')}
          aria-label="Sign in with Apple"
        >
          Sign in with Apple
        </a>
      )}
      {s.enabled &&
        s.custom?.map((c) => (
          <a
            key={c.id}
            className="flex w-full items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 shadow-sm transition hover:border-indigo-300 hover:bg-slate-50"
            href={p(`/auth/oidc/custom/login?configId=${encodeURIComponent(c.id)}`)}
            aria-label={`Sign in with ${c.displayName}`}
          >
            Sign in with {c.displayName}
          </a>
        ))}
    </div>
  )
}
