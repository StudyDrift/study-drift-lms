import { type FormEvent, useState } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { BrandLogo } from '../components/BrandLogo'
import { getAccessToken } from '../lib/auth'
import { apiUrl } from '../lib/api'
import { readApiErrorMessage } from '../lib/errors'

export default function ResetPassword() {
  const [searchParams] = useSearchParams()
  const tokenFromUrl = searchParams.get('token') ?? ''

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'error' | 'done'>('idle')
  const [message, setMessage] = useState<string | null>(null)

  if (getAccessToken()) {
    return <Navigate to="/" replace />
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setMessage(null)
    if (!tokenFromUrl.trim()) {
      setStatus('error')
      setMessage('This page needs a valid reset link. Open the link from your email.')
      return
    }
    if (password !== confirm) {
      setStatus('error')
      setMessage('Passwords do not match.')
      return
    }
    if (password.length < 8) {
      setStatus('error')
      setMessage('Password must be at least 8 characters.')
      return
    }

    setStatus('loading')
    try {
      const res = await fetch(apiUrl('/api/v1/auth/reset-password'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: tokenFromUrl, password }),
      })
      let raw: unknown
      try {
        raw = await res.json()
      } catch {
        raw = {}
      }
      if (!res.ok) {
        setStatus('error')
        setMessage(readApiErrorMessage(raw))
        return
      }
      const data = raw as { message?: string }
      setStatus('done')
      setMessage(data.message ?? 'Your password has been updated.')
    } catch {
      setStatus('error')
      setMessage('Could not reach the server. Is the API running?')
    }
  }

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-slate-50 px-4 py-12">
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(99,102,241,0.12),transparent)]"
        aria-hidden
      />
      <div className="relative z-10 w-full max-w-md">
        <header className="mb-10 text-center">
          <div className="mb-6 flex justify-center px-2">
            <BrandLogo />
          </div>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">Set a new password</h1>
          <p className="mt-2 text-sm text-slate-500">Choose a strong password you have not used elsewhere.</p>
        </header>

        <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm shadow-slate-900/5">
          {status === 'done' ? (
            <div className="space-y-4 text-center">
              <p className="text-sm text-slate-700" role="status">
                {message}
              </p>
              <Link
                to="/login"
                className="inline-block text-sm font-medium text-indigo-600 hover:text-indigo-500"
              >
                Sign in
              </Link>
            </div>
          ) : (
            <form className="space-y-5" onSubmit={onSubmit}>
              {!tokenFromUrl.trim() && (
                <p className="text-sm text-amber-700" role="status">
                  Missing token. Use the link from your reset email, or request a new link from the sign-in page.
                </p>
              )}
              <div>
                <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-slate-700">
                  New password
                </label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-slate-900 outline-none ring-indigo-500/20 transition placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2"
                  placeholder="At least 8 characters"
                />
              </div>
              <div>
                <label htmlFor="confirm" className="mb-1.5 block text-sm font-medium text-slate-700">
                  Confirm password
                </label>
                <input
                  id="confirm"
                  name="confirm"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-slate-900 outline-none ring-indigo-500/20 transition placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2"
                  placeholder="Repeat password"
                />
              </div>

              {message && status === 'error' && (
                <p className="text-sm text-rose-600" role="status">
                  {message}
                </p>
              )}

              <button
                type="submit"
                disabled={status === 'loading' || !tokenFromUrl.trim()}
                className="flex w-full items-center justify-center rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {status === 'loading' ? 'Updating…' : 'Update password'}
              </button>
            </form>
          )}

          {status !== 'done' && (
            <p className="mt-6 text-center text-sm text-slate-500">
              <Link to="/login" className="font-medium text-indigo-600 hover:text-indigo-500">
                Back to sign in
              </Link>
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
