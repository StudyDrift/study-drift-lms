import { type FormEvent, useState } from 'react'
import { apiUrl } from '../../lib/api'
import { readApiErrorMessage } from '../../lib/errors'

type Props = {
  /** Optional app path to resume after sign-in (same-origin). */
  redirectTo?: string
  defaultEmail?: string
}

export function MagicLinkRequestForm({ redirectTo, defaultEmail = '' }: Props) {
  const [email, setEmail] = useState(defaultEmail)
  const [status, setStatus] = useState<'idle' | 'loading' | 'error' | 'sent'>('idle')
  const [message, setMessage] = useState<string | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setStatus('loading')
    setMessage(null)
    try {
      const body: { email: string; redirect_to?: string } = { email }
      if (redirectTo && redirectTo.trim() !== '') {
        body.redirect_to = redirectTo
      }
      const res = await fetch(apiUrl('/api/v1/auth/magic-link/request'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
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
      setMessage(data.message ?? 'Check your inbox for a sign-in link.')
    } catch {
      setStatus('error')
      setMessage('Could not reach the server. Is the API running?')
    }
  }

  if (status === 'sent') {
    return (
      <p className="text-sm text-slate-700" role="status" aria-live="polite">
        {message}
      </p>
    )
  }

  return (
    <form className="space-y-4 border-t border-slate-200 pt-5" onSubmit={onSubmit}>
      <p className="text-sm font-medium text-slate-800">Email me a magic link</p>
      <p className="text-xs text-slate-500">We will email you a one-time link that signs you in without a password.</p>
      <div>
        <label htmlFor="magic-link-email" className="mb-1.5 block text-sm font-medium text-slate-700">
          Email for magic link
        </label>
        <input
          id="magic-link-email"
          name="magic-link-email"
          type="email"
          autoComplete="email"
          aria-required="true"
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
        className="flex w-full items-center justify-center rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-sm font-semibold text-indigo-800 shadow-sm transition hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {status === 'loading' ? 'Sending link…' : 'Send magic link'}
      </button>
    </form>
  )
}
