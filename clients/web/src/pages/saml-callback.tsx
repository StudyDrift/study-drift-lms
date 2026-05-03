import { useEffect, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { applyAuthTokenResponse } from '../lib/session-tokens'
import { markPostLoginShortcutTip } from '../lib/post-login-shortcut-tip'

/** Completes the SAML flow: `POST /auth/saml/acs` redirects here with `#access_token=...`. */
export default function SamlCallback() {
  const navigate = useNavigate()
  const [search] = useSearchParams()

  const { token, refreshToken, nextPath } = useMemo(() => {
    const h = window.location.hash.startsWith('#')
      ? window.location.hash.slice(1)
      : window.location.hash
    const params = new URLSearchParams(h)
    const t = params.get('access_token') ?? search.get('access_token')
    const rt = params.get('refresh_token') ?? search.get('refresh_token')
    const nextRaw = params.get('next') ?? search.get('next')
    const to = nextRaw && nextRaw.startsWith('/') ? decodeURIComponent(nextRaw) : '/'
    return { token: t, refreshToken: rt, nextPath: to }
  }, [search])

  useEffect(() => {
    if (!token) return
    applyAuthTokenResponse({
      access_token: token,
      ...(refreshToken ? { refresh_token: refreshToken } : {}),
    })
    markPostLoginShortcutTip()
    navigate(nextPath, { replace: true })
  }, [navigate, nextPath, token, refreshToken])

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <p className="max-w-md text-center text-rose-600" role="status">
          This page did not receive a sign-in token. Start again from the login page.
        </p>
      </div>
    )
  }
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <p className="text-slate-600">Signing you in…</p>
    </div>
  )
}
