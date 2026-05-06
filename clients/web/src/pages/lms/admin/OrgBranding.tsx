import { type CSSProperties, type FormEvent, useCallback, useEffect, useId, useState } from 'react'
import { Loader2, Palette, Save } from 'lucide-react'
import { resolveOrgBrandAssetUrl } from '../../../lib/branding-url'
import { decodeJwtPayload } from '../../../lib/jwt-payload'
import { getAccessToken } from '../../../lib/auth'
import { authorizedFetch } from '../../../lib/api'
import { readApiErrorMessage } from '../../../lib/errors'
import { toastMutationError, toastSaveOk } from '../../../lib/lms-toast'

type BrandingResponse = {
  logoUrl: string | null
  faviconUrl: string | null
  primaryColor: string
  secondaryColor: string
  customDomain: string | null
  customEmailDisplayName: string | null
  contrastWarningPrimary: boolean
  contrastRatioPrimary: number | null
}

function contrastOk(ratio: number) {
  return ratio >= 4.5
}

/**
 * Settings — organization branding (plan 5.7). Requires org unit admin or global admin.
 */
export default function OrgBranding() {
  const formId = useId()
  const [orgId, setOrgId] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<BrandingResponse>({
    logoUrl: null,
    faviconUrl: null,
    primaryColor: '#4F46E5',
    secondaryColor: '#7C3AED',
    customDomain: null,
    customEmailDisplayName: null,
    contrastWarningPrimary: false,
    contrastRatioPrimary: null,
  })
  const [previewLogoUrl, setPreviewLogoUrl] = useState<string | null>(null)

  const jwtOrg = decodeJwtPayload(getAccessToken())?.org_id ?? null
  useEffect(() => {
    if (jwtOrg) setOrgId(jwtOrg)
  }, [jwtOrg])

  const load = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    setError(null)
    try {
      const res = await authorizedFetch(`/api/v1/orgs/${encodeURIComponent(orgId)}/branding`)
      const raw: unknown = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(readApiErrorMessage(raw))
        return
      }
      const b = raw as BrandingResponse
      setForm(b)
      setPreviewLogoUrl(resolveOrgBrandAssetUrl(b.logoUrl))
    } catch {
      setError('Could not load branding.')
    } finally {
      setLoading(false)
    }
  }, [orgId])

  useEffect(() => {
    void load()
  }, [load])

  async function onSave(e: FormEvent) {
    e.preventDefault()
    if (!orgId) return
    setSaving(true)
    setMessage(null)
    setError(null)
    try {
      const res = await authorizedFetch(`/api/v1/orgs/${encodeURIComponent(orgId)}/branding`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          logoUrl: form.logoUrl,
          faviconUrl: form.faviconUrl,
          primaryColor: form.primaryColor,
          secondaryColor: form.secondaryColor,
          customDomain: form.customDomain,
          customEmailDisplayName: form.customEmailDisplayName,
        }),
      })
      const raw: unknown = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(readApiErrorMessage(raw))
        toastMutationError(readApiErrorMessage(raw))
        return
      }
      const b = raw as BrandingResponse
      setForm(b)
      setPreviewLogoUrl(resolveOrgBrandAssetUrl(b.logoUrl))
      setMessage('Saved.')
      toastSaveOk('Branding saved')
    } catch {
      setError('Could not save.')
      toastMutationError('Could not save.')
    } finally {
      setSaving(false)
    }
  }

  async function upload(kind: 'logo' | 'favicon', file: File) {
    if (!orgId) return
    const fd = new FormData()
    fd.set('file', file)
    const res = await authorizedFetch(
      `/api/v1/orgs/${encodeURIComponent(orgId)}/branding/${kind}`,
      { method: 'POST', body: fd },
    )
    const raw: unknown = await res.json().catch(() => ({}))
    if (!res.ok) {
      toastMutationError(readApiErrorMessage(raw))
      return
    }
    const u = raw as { url?: string }
    if (u.url && kind === 'logo') {
      setForm((f) => ({ ...f, logoUrl: u.url ?? null }))
      setPreviewLogoUrl(resolveOrgBrandAssetUrl(u.url))
    }
    if (u.url && kind === 'favicon') {
      setForm((f) => ({ ...f, faviconUrl: u.url ?? null }))
    }
    toastSaveOk(kind === 'logo' ? 'Logo uploaded' : 'Favicon uploaded')
  }

  const approxWarn =
    form.contrastWarningPrimary ||
    (form.contrastRatioPrimary != null && !contrastOk(form.contrastRatioPrimary))

  return (
    <>
      {loading ? (
        <p className="mt-8 text-sm text-slate-500 dark:text-neutral-400">Loading…</p>
      ) : !orgId ? (
        <p className="mt-8 text-sm text-amber-700 dark:text-amber-300">
          No organization id on your session.
        </p>
      ) : (
        <div className="mt-4 grid gap-8 lg:grid-cols-2">
          <form id={formId} className="space-y-6" onSubmit={onSave}>
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-800 dark:text-neutral-100">
                Logo
              </label>
              <input
                type="file"
                accept="image/png,image/jpeg,image/gif,image/svg+xml"
                aria-label="Upload organization logo"
                className="block w-full text-sm text-slate-600 file:mr-4 file:rounded-lg file:border file:border-slate-200 file:bg-white file:px-3 file:py-2 file:text-sm file:font-medium dark:text-neutral-300 dark:file:border-neutral-600 dark:file:bg-neutral-800"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void upload('logo', f)
                  e.target.value = ''
                }}
              />
              <p className="mt-1 text-xs text-slate-500 dark:text-neutral-400">
                PNG, JPEG, GIF, or SVG. Shown on the sign-in page and navigation.
              </p>
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-800 dark:text-neutral-100">
                Favicon
              </label>
              <input
                type="file"
                accept="image/png,image/jpeg,image/gif,image/svg+xml"
                aria-label="Upload favicon"
                className="block w-full text-sm text-slate-600 file:mr-4 file:rounded-lg file:border file:border-slate-200 file:bg-white file:px-3 file:py-2 file:text-sm file:font-medium dark:text-neutral-300 dark:file:border-neutral-600 dark:file:bg-neutral-800"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void upload('favicon', f)
                  e.target.value = ''
                }}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label
                  className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-800 dark:text-neutral-100"
                  htmlFor={`${formId}-primary`}
                >
                  <Palette className="h-4 w-4" aria-hidden />
                  Primary color
                </label>
                <div className="flex gap-2">
                  <input
                    id={`${formId}-primary`}
                    type="color"
                    value={form.primaryColor}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, primaryColor: e.target.value }))
                    }
                    className="h-10 w-14 cursor-pointer rounded border border-slate-200 bg-white dark:border-neutral-600"
                  />
                  <input
                    type="text"
                    value={form.primaryColor}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, primaryColor: e.target.value }))
                    }
                    className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100"
                    autoComplete="off"
                  />
                </div>
              </div>
              <div>
                <label
                  className="mb-2 block text-sm font-medium text-slate-800 dark:text-neutral-100"
                  htmlFor={`${formId}-secondary`}
                >
                  Secondary color
                </label>
                <div className="flex gap-2">
                  <input
                    id={`${formId}-secondary`}
                    type="color"
                    value={form.secondaryColor}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, secondaryColor: e.target.value }))
                    }
                    className="h-10 w-14 cursor-pointer rounded border border-slate-200 bg-white dark:border-neutral-600"
                  />
                  <input
                    type="text"
                    value={form.secondaryColor}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, secondaryColor: e.target.value }))
                    }
                    className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100"
                    autoComplete="off"
                  />
                </div>
              </div>
            </div>
            {approxWarn ? (
              <div
                role="status"
                className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-950/50 dark:text-amber-100"
              >
                This color may not meet WCAG AA contrast requirements against white (need 4.5:1
                for normal text).
                {form.contrastRatioPrimary != null && (
                  <span className="ml-1">
                    Current ratio (approx.): {form.contrastRatioPrimary.toFixed(2)}:1
                  </span>
                )}
              </div>
            ) : null}
            <div>
              <label
                className="mb-2 block text-sm font-medium text-slate-800 dark:text-neutral-100"
                htmlFor={`${formId}-domain`}
              >
                Custom domain
              </label>
              <input
                id={`${formId}-domain`}
                type="text"
                value={form.customDomain ?? ''}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    customDomain: e.target.value.trim() ? e.target.value : null,
                  }))
                }
                placeholder="lms.yourschool.edu"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100"
              />
              <p className="mt-1 text-xs text-slate-500 dark:text-neutral-400">
                Point DNS to this service; map the hostname to your org after it resolves.
              </p>
            </div>
            <div>
              <label
                className="mb-2 block text-sm font-medium text-slate-800 dark:text-neutral-100"
                htmlFor={`${formId}-emailname`}
              >
                Email display name
              </label>
              <input
                id={`${formId}-emailname`}
                type="text"
                value={form.customEmailDisplayName ?? ''}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    customEmailDisplayName: e.target.value.trim() ? e.target.value : null,
                  }))
                }
                placeholder="Your District Name"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100"
              />
              <p className="mt-1 text-xs text-slate-500 dark:text-neutral-400">
                Shown as the sender name on password-reset and similar emails.
              </p>
            </div>
            {error ? (
              <p className="text-sm text-rose-600 dark:text-rose-400" role="alert">
                {error}
              </p>
            ) : null}
            {message ? (
              <p className="text-sm text-emerald-700 dark:text-emerald-400" role="status">
                {message}
              </p>
            ) : null}
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-indigo-500 dark:hover:bg-indigo-400"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Save className="h-4 w-4" aria-hidden />
              )}
              Save branding
            </button>
          </form>
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-neutral-100">Preview</h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-neutral-400">
              Mini sign-in mockup using your colors (saved values apply after save).
            </p>
            <div
              className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-6 dark:border-neutral-700 dark:bg-neutral-950"
              style={
                {
                  '--preview-primary': form.primaryColor,
                } as CSSProperties
              }
            >
              <div className="mx-auto max-w-xs rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-neutral-600 dark:bg-neutral-900">
                <div className="mb-4 flex justify-center">
                  {previewLogoUrl ? (
                    <img
                      src={previewLogoUrl}
                      alt=""
                      className="mx-auto h-16 w-auto max-w-full object-contain"
                    />
                  ) : (
                    <img
                      src="/logo-trimmed.svg"
                      alt=""
                      className="mx-auto h-16 w-auto max-w-[180px] object-contain opacity-80"
                    />
                  )}
                </div>
                <div
                  className="mb-3 h-2 rounded-full"
                  style={{ backgroundColor: 'var(--preview-primary)' }}
                />
                <p className="text-center text-sm font-medium text-slate-800 dark:text-neutral-100">
                  Sign in
                </p>
                <button
                  type="button"
                  className="mt-4 w-full rounded-lg py-2 text-sm font-semibold text-white"
                  style={{ backgroundColor: 'var(--preview-primary)' }}
                >
                  Continue
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
