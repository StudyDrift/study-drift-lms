import { useEffect, useState } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { BrandLogo } from '../components/brand-logo'
import { getAccessToken } from '../lib/auth'
import { applyAuthTokenResponse } from '../lib/session-tokens'
import { pickPostAuthPath } from '../lib/post-auth-redirect'
import { apiUrl } from '../lib/api'
import { readApiErrorMessage } from '../lib/errors'
import { applyUiTheme, parseUiTheme } from '../lib/ui-theme'
import { markPostLoginShortcutTip } from '../lib/post-login-shortcut-tip'
import { setMfaFlow } from '../lib/mfa-flow-storage'

export default function MagicLinkPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const token = params.get('token') ?? ''
  const redirectTo = params.get('redirect_to') ?? ''

  const [status, setStatus] = useState<'loading' | 'error'>(() =>
    token.trim() === '' ? 'error' : 'loading',
  )
  const [message, setMessage] = useState<string | null>(() =>
    token.trim() === ''
      ? 'This sign-in link is missing a token. Request a new link from the sign-in page.'
      : null,
  )

  useEffect(() => {
    if (getAccessToken()) {
      return
    }
    if (!token.trim()) {
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(apiUrl('/api/v1/auth/magic-link/consume'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        })
        let raw: unknown
        try {
          raw = await res.json()
        } catch {
          raw = {}
        }
        if (cancelled) return
        if (!res.ok) {
          setStatus('error')
          setMessage(readApiErrorMessage(raw))
          return
        }
        const data = raw as {
          access_token?: string
          mfa_pending_token?: string
          requires_mfa?: boolean
          mfa_setup_required?: boolean
          user?: { email?: string; uiTheme?: string | null }
        }
        if (data.requires_mfa && data.mfa_pending_token) {
          setMfaFlow({ token: data.mfa_pending_token, mode: 'challenge' })
          navigate('/login/mfa', { replace: true, state: { from: redirectTo || '/' } })
          return
        }
        if (data.mfa_setup_required && data.mfa_pending_token) {
          setMfaFlow({ token: data.mfa_pending_token, mode: 'setup' })
          navigate('/login/mfa', { replace: true, state: { from: redirectTo || '/' } })
          return
        }
        if (!data.access_token) {
          setStatus('error')
          setMessage('Unexpected sign-in response.')
          return
        }
        applyAuthTokenResponse(data)
        applyUiTheme(parseUiTheme(data.user?.uiTheme))
        markPostLoginShortcutTip()
        const rawDest =
          redirectTo && redirectTo.startsWith('/') && !redirectTo.startsWith('//') ? redirectTo : '/'
        navigate(pickPostAuthPath(rawDest), { replace: true })
      } catch {
        if (!cancelled) {
          setStatus('error')
          setMessage('Could not reach the server. Is the API running?')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [navigate, redirectTo, token])

  if (getAccessToken()) {
    return <Navigate to="/" replace />
  }

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-slate-50 px-4 py-12">
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(99,102,241,0.12),transparent)]"
        aria-hidden
      />
      <div className="relative z-10 w-full max-w-md text-center">
        <div className="mb-6 flex justify-center px-2">
          <BrandLogo />
        </div>
        {status === 'loading' && (
          <>
            <p className="text-lg font-medium text-slate-900">Signing you in…</p>
            <p className="mt-2 text-sm text-slate-500">One moment while we verify your link.</p>
            <div
              className="mx-auto mt-8 h-8 w-8 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent"
              role="status"
              aria-label="Loading"
            />
          </>
        )}
        {status === 'error' && message && (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
            <p className="text-sm text-rose-600" role="alert">
              {message}
            </p>
            <a
              href="/login"
              className="mt-6 inline-block text-sm font-medium text-indigo-600 hover:text-indigo-500"
            >
              Back to sign in
            </a>
          </div>
        )}
      </div>
    </div>
  )
}
