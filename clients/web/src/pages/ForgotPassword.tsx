import { type FormEvent, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { BrandLogo } from '../components/BrandLogo'
import { getAccessToken } from '../lib/auth'
import { apiUrl } from '../lib/api'
import { readApiErrorMessage } from '../lib/errors'

export default function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'error' | 'sent'>('idle')
  const [message, setMessage] = useState<string | null>(null)

  if (getAccessToken()) {
    return <Navigate to="/" replace />
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setStatus('loading')
    setMessage(null)
    try {
      const res = await fetch(apiUrl('/api/v1/auth/forgot-password'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
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
      setStatus('sent')
      setMessage(data.message ?? 'Check your email for a reset link.')
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
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">Forgot password</h1>
          <p className="mt-2 text-sm text-slate-500">
            Enter your email and we will send a link to reset your password.
          </p>
        </header>

        <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm shadow-slate-900/5">
          {status === 'sent' ? (
            <div className="space-y-4 text-center">
              <p className="text-sm text-slate-700" role="status">
                {message}
              </p>
              <Link
                to="/login"
                className="inline-block text-sm font-medium text-indigo-600 hover:text-indigo-500"
              >
                Back to sign in
              </Link>
            </div>
          ) : (
            <form className="space-y-5" onSubmit={onSubmit}>
              <div>
                <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-slate-700">
                  Email
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-slate-900 outline-none ring-indigo-500/20 transition placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2"
                  placeholder="you@school.edu"
                />
              </div>

              {message && status === 'error' && (
                <p className="text-sm text-rose-600" role="status">
                  {message}
                </p>
              )}

              <button
                type="submit"
                disabled={status === 'loading'}
                className="flex w-full items-center justify-center rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {status === 'loading' ? 'Sending…' : 'Send reset link'}
              </button>
            </form>
          )}

          {status !== 'sent' && (
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
