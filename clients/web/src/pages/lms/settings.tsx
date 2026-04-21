import { type ChangeEvent, type FormEvent, useCallback, useEffect, useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { ImageIcon, Save, Upload, X } from 'lucide-react'
import { settingsViewFromPathname } from '../../components/layout/side-nav-path-utils'
import { ImageModelPicker } from '../../components/image-model-picker'
import { RequirePermission } from '../../components/require-permission'
import { LtiToolsSettingsPanel } from '../../components/settings/lti-tools-settings-panel'
import { RolesPermissionsPanel } from '../../components/settings/roles-permissions-panel'
import { usePermissions } from '../../context/use-permissions'
import { PERM_RBAC_MANAGE } from '../../lib/rbac-api'
import { LmsPage } from './lms-page'
import { FALLBACK_IMAGE_MODEL_OPTIONS, FALLBACK_TEXT_MODEL_OPTIONS } from '../../lib/ai-models'
import { authorizedFetch } from '../../lib/api'
import { readApiErrorMessage } from '../../lib/errors'
import { toastMutationError, toastSaveOk } from '../../lib/lms-toast'
import { applyUiTheme, parseUiTheme, type UiTheme } from '../../lib/ui-theme'
import { useUiDensityControls } from '../../context/ui-density-context'

function isSystemSettingsPath(pathname: string): boolean {
  if (pathname.startsWith('/settings/ai/')) return true
  return pathname === '/settings/roles' || pathname === '/settings/lti-tools'
}

type SystemPromptItem = {
  key: string
  label: string
  content: string
  updatedAt: string
}

type AiModelOption = {
  id: string
  name: string
  contextLength?: number | null
  inputPricePerMillionUsd?: number | null
  outputPricePerMillionUsd?: number | null
  modalitiesSummary?: string | null
}

function fallbackImageModels(): AiModelOption[] {
  return FALLBACK_IMAGE_MODEL_OPTIONS.map((o) => ({
    id: o.id,
    name: o.label,
    contextLength: null,
    inputPricePerMillionUsd: null,
    outputPricePerMillionUsd: null,
    modalitiesSummary: null,
  }))
}

function fallbackTextModels(): AiModelOption[] {
  return FALLBACK_TEXT_MODEL_OPTIONS.map((o) => ({
    id: o.id,
    name: o.label,
    contextLength: null,
    inputPricePerMillionUsd: null,
    outputPricePerMillionUsd: null,
    modalitiesSummary: null,
  }))
}

type ModelKind = 'image' | 'text'

type AccountProfile = {
  email: string
  displayName?: string | null
  firstName?: string | null
  lastName?: string | null
  avatarUrl?: string | null
  uiTheme?: string | null
  sid?: string | null
}

function defaultAvatarPrompt(firstName: string, lastName: string): string {
  const name = [firstName.trim(), lastName.trim()].filter(Boolean).join(' ').trim()
  return name
    ? `Create a friendly profile avatar illustration for ${name}. Clean background, centered portrait framing, modern style.`
    : 'Create a friendly profile avatar illustration with clean background, centered portrait framing, and modern style.'
}

async function fetchModelsForKind(kind: ModelKind): Promise<{
  models: AiModelOption[]
  fromApi: boolean
  configured: boolean
}> {
  const modelsRes = await authorizedFetch(`/api/v1/settings/ai/models?kind=${kind}`)
  const modelsRaw: unknown = await modelsRes.json().catch(() => ({}))
  if (!modelsRes.ok) {
    throw new Error(readApiErrorMessage(modelsRaw))
  }
  const list = modelsRaw as {
    configured?: boolean
    models?: AiModelOption[]
  }
  const apiModels = list.models ?? []
  const configured = list.configured === true
  if (apiModels.length > 0) {
    return { models: apiModels, fromApi: true, configured }
  }
  return {
    models: kind === 'image' ? fallbackImageModels() : fallbackTextModels(),
    fromApi: false,
    configured,
  }
}

export default function Settings() {
  const location = useLocation()
  const { allows, loading: permLoading } = usePermissions()
  const { density, setDensity } = useUiDensityControls()
  const activeView = settingsViewFromPathname(location.pathname)

  const [systemPrompts, setSystemPrompts] = useState<SystemPromptItem[]>([])
  const [systemPromptKey, setSystemPromptKey] = useState('')
  const [systemPromptDraft, setSystemPromptDraft] = useState('')
  const [systemPromptsLoading, setSystemPromptsLoading] = useState(false)
  const [systemPromptsSaving, setSystemPromptsSaving] = useState(false)
  const [systemPromptsError, setSystemPromptsError] = useState<string | null>(null)
  const [systemPromptsMessage, setSystemPromptsMessage] = useState<string | null>(null)

  const [imageModelId, setImageModelId] = useState('')
  const [courseSetupModelId, setCourseSetupModelId] = useState('')
  const [aiLoading, setAiLoading] = useState(true)
  const [aiSaving, setAiSaving] = useState(false)
  const [aiMessage, setAiMessage] = useState<string | null>(null)
  const [aiError, setAiError] = useState<string | null>(null)

  const [imageModels, setImageModels] = useState<AiModelOption[]>([])
  const [textModels, setTextModels] = useState<AiModelOption[]>([])
  const [imageModelsFromApi, setImageModelsFromApi] = useState(false)
  const [textModelsFromApi, setTextModelsFromApi] = useState(false)
  const [modelsConfigured, setModelsConfigured] = useState(false)
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [modelsRefreshing, setModelsRefreshing] = useState(false)

  const [accountLoading, setAccountLoading] = useState(false)
  const [accountSaving, setAccountSaving] = useState(false)
  const [accountMessage, setAccountMessage] = useState<string | null>(null)
  const [accountError, setAccountError] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [avatarUrl, setAvatarUrl] = useState('')
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState<string | null>(null)
  const [avatarModalOpen, setAvatarModalOpen] = useState(false)
  const [avatarPrompt, setAvatarPrompt] = useState('')
  const [avatarGenStatus, setAvatarGenStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [avatarGenMessage, setAvatarGenMessage] = useState<string | null>(null)
  const [uiTheme, setUiTheme] = useState<UiTheme>('light')
  const [studentId, setStudentId] = useState<string | null>(null)

  const loadModels = useCallback(async () => {
    setModelsError(null)
    try {
      const [img, txt] = await Promise.all([
        fetchModelsForKind('image'),
        fetchModelsForKind('text'),
      ])
      setModelsConfigured(img.configured)
      setImageModels(img.models)
      setImageModelsFromApi(img.fromApi)
      setTextModels(txt.models)
      setTextModelsFromApi(txt.fromApi)
    } catch (e) {
      setModelsError(e instanceof Error ? e.message : 'Could not load models.')
      setImageModels(fallbackImageModels())
      setTextModels(fallbackTextModels())
      setImageModelsFromApi(false)
      setTextModelsFromApi(false)
      setModelsConfigured(false)
    }
  }, [])

  const refreshModels = useCallback(async () => {
    setModelsRefreshing(true)
    await loadModels()
    setModelsRefreshing(false)
  }, [loadModels])

  const loadSystemPrompts = useCallback(async () => {
    setSystemPromptsLoading(true)
    setSystemPromptsError(null)
    try {
      const res = await authorizedFetch('/api/v1/settings/system-prompts')
      const raw: unknown = await res.json().catch(() => ({}))
      if (!res.ok) {
        setSystemPromptsError(readApiErrorMessage(raw))
        return
      }
      const data = raw as { prompts?: SystemPromptItem[] }
      const list = data.prompts ?? []
      setSystemPrompts(list)
      if (list.length > 0) {
        setSystemPromptKey((prev) => {
          const nextKey = list.some((p) => p.key === prev) ? prev : list[0].key
          const row = list.find((p) => p.key === nextKey)
          if (row) setSystemPromptDraft(row.content)
          return nextKey
        })
      }
    } catch {
      setSystemPromptsError('Could not load system prompts.')
    } finally {
      setSystemPromptsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (activeView !== 'ai-prompts') return
    if (permLoading || !allows(PERM_RBAC_MANAGE)) return
    void loadSystemPrompts()
  }, [activeView, allows, loadSystemPrompts, permLoading])

  const canConfigureAi = !permLoading && allows(PERM_RBAC_MANAGE)

  useEffect(() => {
    if (activeView !== 'ai-models' || !canConfigureAi) return
    let cancelled = false
    ;(async () => {
      setAiLoading(true)
      setAiError(null)
      setModelsError(null)
      try {
        const settingsRes = await authorizedFetch('/api/v1/settings/ai')
        const settingsRaw: unknown = await settingsRes.json().catch(() => ({}))
        if (!settingsRes.ok) {
          if (!cancelled) setAiError(readApiErrorMessage(settingsRaw))
        } else {
          const data = settingsRaw as { imageModelId?: string; courseSetupModelId?: string }
          if (!cancelled && data.imageModelId) setImageModelId(data.imageModelId)
          if (!cancelled && data.courseSetupModelId) setCourseSetupModelId(data.courseSetupModelId)
        }
        if (!cancelled) await loadModels()
      } catch {
        if (!cancelled) {
          setAiError('Could not load AI settings.')
          setImageModels(fallbackImageModels())
          setTextModels(fallbackTextModels())
          setImageModelsFromApi(false)
          setTextModelsFromApi(false)
          setModelsConfigured(false)
        }
      } finally {
        if (!cancelled) setAiLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [activeView, canConfigureAi, loadModels])

  async function onSaveAi(e: FormEvent) {
    e.preventDefault()
    setAiSaving(true)
    setAiMessage(null)
    setAiError(null)
    try {
      const res = await authorizedFetch('/api/v1/settings/ai', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageModelId,
          courseSetupModelId,
        }),
      })
      const raw: unknown = await res.json().catch(() => ({}))
      if (!res.ok) {
        setAiError(readApiErrorMessage(raw))
        return
      }
      const data = raw as { imageModelId?: string; courseSetupModelId?: string }
      if (data.imageModelId) setImageModelId(data.imageModelId)
      if (data.courseSetupModelId) setCourseSetupModelId(data.courseSetupModelId)
      setAiMessage('Saved.')
      toastSaveOk('AI defaults saved')
    } catch {
      setAiError('Could not save settings.')
      toastMutationError('Could not save AI settings.')
    } finally {
      setAiSaving(false)
    }
  }

  const loadAccount = useCallback(async () => {
    setAccountLoading(true)
    setAccountError(null)
    try {
      const res = await authorizedFetch('/api/v1/settings/account')
      const raw: unknown = await res.json().catch(() => ({}))
      if (!res.ok) {
        setAccountError(readApiErrorMessage(raw))
        return
      }
      const data = raw as AccountProfile
      setEmail(data.email ?? '')
      setFirstName(data.firstName ?? '')
      setLastName(data.lastName ?? '')
      const currentAvatar = data.avatarUrl ?? ''
      setAvatarUrl(currentAvatar)
      setAvatarPreviewUrl(currentAvatar || null)
      setUiTheme(parseUiTheme(data.uiTheme))
      setStudentId(data.sid?.trim() ? data.sid.trim() : null)
    } catch {
      setAccountError('Could not load account settings.')
    } finally {
      setAccountLoading(false)
    }
  }, [])

  useEffect(() => {
    if (activeView !== 'account') return
    void loadAccount()
  }, [activeView, loadAccount])

  useEffect(() => {
    if (!avatarModalOpen) return
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      if (avatarGenStatus === 'loading') return
      e.preventDefault()
      setAvatarModalOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [avatarModalOpen, avatarGenStatus])

  async function onAvatarUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setAccountError('Choose an image file.')
      return
    }
    if (file.size > 3 * 1024 * 1024) {
      setAccountError('Image file must be 3MB or smaller.')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      setAvatarUrl(result)
      setAvatarPreviewUrl(result || null)
      setAccountError(null)
      setAccountMessage('Image selected. Save to apply it.')
    }
    reader.onerror = () => {
      setAccountError('Could not read that image file.')
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  function openGenerateAvatarModal() {
    setAvatarPrompt(defaultAvatarPrompt(firstName, lastName))
    setAvatarGenStatus('idle')
    setAvatarGenMessage(null)
    setAvatarModalOpen(true)
  }

  async function onGenerateAvatar(e: FormEvent) {
    e.preventDefault()
    if (!avatarPrompt.trim()) return
    setAvatarGenStatus('loading')
    setAvatarGenMessage(null)
    try {
      const res = await authorizedFetch('/api/v1/settings/account/generate-avatar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: avatarPrompt.trim() }),
      })
      const raw: unknown = await res.json().catch(() => ({}))
      if (!res.ok) {
        setAvatarGenStatus('error')
        setAvatarGenMessage(readApiErrorMessage(raw))
        return
      }
      const data = raw as { imageUrl?: string }
      if (data.imageUrl) {
        setAvatarUrl(data.imageUrl)
        setAvatarPreviewUrl(data.imageUrl)
      }
      setAvatarGenStatus('idle')
      setAvatarGenMessage('Avatar generated. Save account to apply it.')
    } catch {
      setAvatarGenStatus('error')
      setAvatarGenMessage('Could not reach the server.')
    }
  }

  async function persistUiTheme(next: UiTheme) {
    const prev = uiTheme
    setUiTheme(next)
    applyUiTheme(next)
    setAccountError(null)
    try {
      const res = await authorizedFetch('/api/v1/settings/account', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName,
          lastName,
          avatarUrl: avatarUrl.trim() || null,
          uiTheme: next,
        }),
      })
      const raw: unknown = await res.json().catch(() => ({}))
      if (!res.ok) {
        setUiTheme(prev)
        applyUiTheme(prev)
        setAccountError(readApiErrorMessage(raw))
        return
      }
      window.dispatchEvent(new Event('studydrift-profile-updated'))
    } catch {
      setUiTheme(prev)
      applyUiTheme(prev)
      setAccountError('Could not save appearance.')
    }
  }

  async function onSaveAccount(e: FormEvent) {
    e.preventDefault()
    setAccountSaving(true)
    setAccountMessage(null)
    setAccountError(null)
    try {
      const res = await authorizedFetch('/api/v1/settings/account', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName,
          lastName,
          avatarUrl: avatarUrl.trim() || null,
          uiTheme,
        }),
      })
      const raw: unknown = await res.json().catch(() => ({}))
      if (!res.ok) {
        setAccountError(readApiErrorMessage(raw))
        return
      }
      const data = raw as AccountProfile
      setFirstName(data.firstName ?? '')
      setLastName(data.lastName ?? '')
      setStudentId(data.sid?.trim() ? data.sid.trim() : null)
      const nextAvatar = data.avatarUrl ?? ''
      setAvatarUrl(nextAvatar)
      setAvatarPreviewUrl(nextAvatar || null)
      setAccountMessage('Saved.')
      toastSaveOk('Account saved')
      window.dispatchEvent(new Event('studydrift-profile-updated'))
    } catch {
      setAccountError('Could not save account settings.')
      toastMutationError('Could not save account settings.')
    } finally {
      setAccountSaving(false)
    }
  }

  const saveDisabled = aiSaving || !imageModelId || !courseSetupModelId

  async function onSaveSystemPrompt(e: FormEvent) {
    e.preventDefault()
    if (!systemPromptKey.trim()) return
    setSystemPromptsSaving(true)
    setSystemPromptsError(null)
    setSystemPromptsMessage(null)
    try {
      const res = await authorizedFetch(
        `/api/v1/settings/system-prompts/${encodeURIComponent(systemPromptKey)}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: systemPromptDraft }),
        },
      )
      const raw: unknown = await res.json().catch(() => ({}))
      if (!res.ok) {
        setSystemPromptsError(readApiErrorMessage(raw))
        return
      }
      const row = raw as SystemPromptItem
      setSystemPrompts((prev) =>
        prev.map((p) =>
          p.key === row.key
            ? { ...p, content: row.content, updatedAt: row.updatedAt }
            : p,
        ),
      )
      setSystemPromptsMessage('Saved.')
      toastSaveOk('System prompt saved')
    } catch {
      setSystemPromptsError('Could not save system prompt.')
      toastMutationError('Could not save system prompt.')
    } finally {
      setSystemPromptsSaving(false)
    }
  }

  function onSystemPromptKeyChange(key: string) {
    setSystemPromptKey(key)
    const row = systemPrompts.find((p) => p.key === key)
    if (row) setSystemPromptDraft(row.content)
  }

  if (permLoading && isSystemSettingsPath(location.pathname)) {
    return (
      <LmsPage title="Settings" description="Account and learning preferences.">
        <p className="mt-8 text-sm text-slate-500 dark:text-neutral-400">Loading…</p>
      </LmsPage>
    )
  }
  if (!permLoading && isSystemSettingsPath(location.pathname) && !allows(PERM_RBAC_MANAGE)) {
    return <Navigate to="/settings/account" replace />
  }

  return (
    <LmsPage title="Settings" description="Account and learning preferences.">
      <div
        className={`mt-8 ${
          activeView === 'roles' || activeView === 'lti-tools'
            ? 'max-w-4xl'
            : activeView === 'ai-prompts'
              ? 'max-w-3xl'
              : 'max-w-xl'
        }`}
      >
        {activeView === 'ai-models' && (
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-neutral-100">Models</h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-neutral-400">
              Choose models for course setup (text) and for generating course hero images. Lists are
              loaded from{' '}
              <a
                href="https://openrouter.ai/docs/api/api-reference/models/get-models"
                className="font-medium text-indigo-600 hover:text-indigo-500"
                target="_blank"
                rel="noreferrer"
              >
                OpenRouter&apos;s models API
              </a>{' '}
              (text-capable and image-capable models). Generation still requires an API key on the
              server.
            </p>

            {aiLoading && <p className="mt-4 text-sm text-slate-500">Loading…</p>}
            {aiError && (
              <p className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
                {aiError}
              </p>
            )}

            {!modelsConfigured && !aiLoading && (
              <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                Set <code className="rounded bg-amber-100/80 px-1.5 py-0.5 font-mono text-xs">OPENROUTER_API_KEY</code> or{' '}
                <code className="rounded bg-amber-100/80 px-1.5 py-0.5 font-mono text-xs">OPEN_ROUTER_API_KEY</code> in the
                server environment so AI image generation can call OpenRouter.
              </p>
            )}

            {modelsError && !aiLoading && (
              <p className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
                {modelsError} Showing a static fallback list.
              </p>
            )}

            {!imageModelsFromApi && modelsConfigured && !aiLoading && !modelsError && (
              <p className="mt-4 text-sm text-slate-500">No image models returned from OpenRouter; using fallback IDs.</p>
            )}

            {!textModelsFromApi && modelsConfigured && !aiLoading && !modelsError && (
              <p className="mt-4 text-sm text-slate-500">No text models returned from OpenRouter; using fallback IDs.</p>
            )}

            {!aiLoading && (
              <form className="mt-6 space-y-5" onSubmit={onSaveAi}>
                <div>
                  <ImageModelPicker
                    id="course-setup-model"
                    label="Course setup model"
                    models={textModels}
                    value={courseSetupModelId}
                    onChange={setCourseSetupModelId}
                    disabled={aiSaving}
                    onRefresh={refreshModels}
                    refreshing={modelsRefreshing}
                  />
                  <p className="mt-1.5 text-xs text-slate-500">
                    Text-to-text model used when setting up course structure and content. Each option
                    shows the display name, model id, then modalities, context window, and
                    input/output price per 1M tokens (USD). Use{' '}
                    <span className="font-medium">Refresh list</span> to reload from OpenRouter.
                  </p>
                </div>

                <div>
                  <ImageModelPicker
                    id="image-model"
                    label="Image model"
                    models={imageModels}
                    value={imageModelId}
                    onChange={setImageModelId}
                    disabled={aiSaving}
                    onRefresh={refreshModels}
                    refreshing={modelsRefreshing}
                  />
                  <p className="mt-1.5 text-xs text-slate-500">
                    Used when you generate course images. Each option shows the display name, model id,
                    then modalities, context window, and input/output price per 1M tokens (USD). Use{' '}
                    <span className="font-medium">Refresh list</span> to reload from OpenRouter.
                  </p>
                </div>

                {aiMessage && (
                  <p className="text-sm text-emerald-700" role="status">
                    {aiMessage}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={saveDisabled}
                  className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-neutral-100 dark:text-neutral-950 dark:hover:bg-white dark:shadow-none"
                >
                  {aiSaving ? 'Saving…' : 'Save'}
                </button>
              </form>
            )}
          </div>
        )}

        {activeView === 'ai-prompts' && (
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-neutral-100">System Prompts</h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-neutral-400">
              Edit platform system prompts used by AI features. Changes are audited.
            </p>
            <RequirePermission
              permission={PERM_RBAC_MANAGE}
              fallback={
                <p className="mt-6 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 dark:border-neutral-600 dark:bg-neutral-800/50 dark:text-neutral-300">
                  You need permission to manage system prompts (
                  <code className="font-mono text-xs">{PERM_RBAC_MANAGE}</code>).
                </p>
              }
            >
              {systemPromptsLoading && (
                <p className="mt-4 text-sm text-slate-500">Loading…</p>
              )}
              {systemPromptsError && (
                <p className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-200">
                  {systemPromptsError}
                </p>
              )}
              {!systemPromptsLoading && systemPrompts.length > 0 && (
                <form className="mt-6 space-y-4" onSubmit={onSaveSystemPrompt}>
                  <div>
                    <label htmlFor="system-prompt-select" className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-neutral-200">
                      Prompt
                    </label>
                    <select
                      id="system-prompt-select"
                      value={systemPromptKey}
                      onChange={(e) => onSystemPromptKeyChange(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none ring-indigo-500/20 focus:border-indigo-400 focus:ring-2 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
                    >
                      {systemPrompts.map((p) => (
                        <option key={p.key} value={p.key}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="system-prompt-body" className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-neutral-200">
                      Content
                    </label>
                    <textarea
                      id="system-prompt-body"
                      value={systemPromptDraft}
                      onChange={(e) => setSystemPromptDraft(e.target.value)}
                      rows={12}
                      spellCheck={false}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 font-mono text-sm text-slate-900 outline-none ring-indigo-500/20 focus:border-indigo-400 focus:ring-2 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
                    />
                  </div>
                  {systemPromptsMessage && (
                    <p className="text-sm text-emerald-700 dark:text-emerald-400" role="status">
                      {systemPromptsMessage}
                    </p>
                  )}
                  <button
                    type="submit"
                    disabled={systemPromptsSaving || !systemPromptKey}
                    className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-neutral-100 dark:text-neutral-950 dark:hover:bg-white dark:shadow-none"
                  >
                    {systemPromptsSaving ? 'Saving…' : 'Save'}
                  </button>
                </form>
              )}
              {!systemPromptsLoading && systemPrompts.length === 0 && !systemPromptsError && (
                <p className="mt-4 text-sm text-slate-500">No system prompts are registered.</p>
              )}
            </RequirePermission>
          </div>
        )}

        {activeView === 'account' && (
          <div>
            <h2 className="text-base font-semibold text-slate-900">Account</h2>
            <p className="mt-1 text-sm text-slate-500">
              Update your name and profile image shown in the app header.
            </p>
            {!accountLoading && (
              <div className="mt-6">
                <p className="text-sm font-medium text-slate-700 dark:text-neutral-200">Appearance</p>
                <p className="mt-1 text-sm text-slate-500 dark:text-neutral-400">
                  Theme follows your account when signed in; density is stored on this device only.
                </p>
                <p className="mt-8 text-sm font-medium text-slate-700 dark:text-neutral-200">Layout density</p>
                <p className="mt-1 text-sm text-slate-500 dark:text-neutral-400">
                  Compact tightens spreadsheet-style views (for example the gradebook) for power users on large
                  rosters. Stored on this device only.
                </p>
                <div className="mt-3 inline-flex rounded-xl border border-slate-200 bg-slate-50 p-1 dark:border-neutral-600 dark:bg-neutral-800/50">
                  <button
                    type="button"
                    onClick={() => setDensity('comfortable')}
                    className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
                      density === 'comfortable'
                        ? 'bg-white text-slate-900 shadow-sm dark:bg-neutral-600 dark:text-neutral-50 dark:shadow-md dark:ring-1 dark:ring-inset dark:ring-white/10'
                        : 'text-slate-600 hover:text-slate-900 dark:text-neutral-400 dark:hover:text-neutral-200'
                    }`}
                  >
                    Comfortable
                  </button>
                  <button
                    type="button"
                    onClick={() => setDensity('compact')}
                    className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
                      density === 'compact'
                        ? 'bg-white text-slate-900 shadow-sm dark:bg-neutral-600 dark:text-neutral-50 dark:shadow-md dark:ring-1 dark:ring-inset dark:ring-white/10'
                        : 'text-slate-600 hover:text-slate-900 dark:text-neutral-400 dark:hover:text-neutral-200'
                    }`}
                  >
                    Compact
                  </button>
                </div>
                <p className="mt-8 text-sm font-medium text-slate-700 dark:text-neutral-200">Light or dark</p>
                <div className="mt-3 inline-flex rounded-xl border border-slate-200 bg-slate-50 p-1 dark:border-neutral-600 dark:bg-neutral-800/50">
                  <button
                    type="button"
                    onClick={() => void persistUiTheme('light')}
                    className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
                      uiTheme === 'light'
                        ? 'bg-white text-slate-900 shadow-sm dark:bg-neutral-600 dark:text-neutral-50 dark:shadow-md dark:ring-1 dark:ring-inset dark:ring-white/10'
                        : 'text-slate-600 hover:text-slate-900 dark:text-neutral-400 dark:hover:text-neutral-200'
                    }`}
                  >
                    Light
                  </button>
                  <button
                    type="button"
                    onClick={() => void persistUiTheme('dark')}
                    className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
                      uiTheme === 'dark'
                        ? 'bg-white text-slate-900 shadow-sm dark:bg-neutral-600 dark:text-neutral-50 dark:shadow-md dark:ring-1 dark:ring-inset dark:ring-white/10'
                        : 'text-slate-600 hover:text-slate-900 dark:text-neutral-400 dark:hover:text-neutral-200'
                    }`}
                  >
                    Dark
                  </button>
                </div>
              </div>
            )}
            {accountLoading && <p className="mt-4 text-sm text-slate-500">Loading…</p>}
            {accountError && (
              <p className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
                {accountError}
              </p>
            )}
            {!accountLoading && (
              <form className="mt-6 space-y-5" onSubmit={onSaveAccount}>
                <div>
                  <label htmlFor="account-email" className="mb-1.5 block text-sm font-medium text-slate-700">
                    Email
                  </label>
                  <input
                    id="account-email"
                    type="text"
                    value={email}
                    disabled
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-500"
                  />
                </div>

                <div>
                  <label htmlFor="account-sid" className="mb-1.5 block text-sm font-medium text-slate-700">
                    Student ID
                  </label>
                  <input
                    id="account-sid"
                    type="text"
                    value={studentId ?? ''}
                    disabled
                    placeholder="Not assigned"
                    title="Your student ID is assigned by an administrator and cannot be changed here."
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-500 placeholder:text-slate-400"
                  />
                  <p className="mt-1 text-xs text-slate-500">
                    Assigned by your institution. Contact an administrator if this should be updated.
                  </p>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-1.5 block text-sm font-medium text-slate-700">First name</span>
                    <input
                      type="text"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      maxLength={80}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none ring-indigo-500/20 focus:border-indigo-400 focus:ring-2"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-sm font-medium text-slate-700">Last name</span>
                    <input
                      type="text"
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      maxLength={80}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none ring-indigo-500/20 focus:border-indigo-400 focus:ring-2"
                    />
                  </label>
                </div>

                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-700">Profile image</label>
                  <div className="flex items-center gap-4">
                    <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-full border border-slate-200 bg-slate-100">
                      {avatarPreviewUrl ? (
                        <img src={avatarPreviewUrl} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <ImageIcon className="h-6 w-6 text-slate-400" aria-hidden />
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={openGenerateAvatarModal}
                        className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-900"
                      >
                        <ImageIcon className="h-4 w-4" aria-hidden />
                        Generate avatar
                      </button>
                      <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-900">
                        <Upload className="h-4 w-4" aria-hidden />
                        Upload image
                        <input type="file" accept="image/*" className="hidden" onChange={onAvatarUpload} />
                      </label>
                    </div>
                  </div>
                  <label className="mt-3 block">
                    <span className="mb-1.5 block text-sm font-medium text-slate-700">Image URL</span>
                    <input
                      type="url"
                      value={avatarUrl}
                      onChange={(e) => {
                        setAvatarUrl(e.target.value)
                        setAvatarPreviewUrl(e.target.value.trim() || null)
                      }}
                      placeholder="https://example.com/avatar.png"
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none ring-indigo-500/20 focus:border-indigo-400 focus:ring-2"
                    />
                  </label>
                </div>

                {accountMessage && (
                  <p className="text-sm text-emerald-700" role="status">
                    {accountMessage}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={accountSaving}
                  className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-neutral-100 dark:text-neutral-950 dark:hover:bg-white dark:shadow-none"
                >
                  <Save className="h-4 w-4" aria-hidden />
                  {accountSaving ? 'Saving…' : 'Save'}
                </button>
              </form>
            )}
          </div>
        )}

        {activeView === 'notifications' && (
          <div>
            <h2 className="text-base font-semibold text-slate-900">Notifications</h2>
            <p className="mt-1 text-sm text-slate-500">Notification settings will appear here.</p>
          </div>
        )}

        {activeView === 'roles' && (
          <div>
            <h2 className="text-base font-semibold text-slate-900">Roles and Permissions</h2>
            <p className="mt-1 text-sm text-slate-500">
              Define permission strings and assign them to roles. Route and UI checks use the same
              matching rules as the server.
            </p>
            <RequirePermission
              permission={PERM_RBAC_MANAGE}
              fallback={
                <p className="mt-6 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                  You do not have permission to manage roles and permissions (
                  <code className="font-mono text-xs">{PERM_RBAC_MANAGE}</code>).
                </p>
              }
            >
              <RolesPermissionsPanel />
            </RequirePermission>
          </div>
        )}

        {activeView === 'lti-tools' && (
          <RequirePermission
            permission={PERM_RBAC_MANAGE}
            fallback={
              <div>
                <h2 className="text-base font-semibold text-slate-900 dark:text-neutral-100">LTI tools</h2>
                <p className="mt-6 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
                  You do not have permission to manage LTI registrations (
                  <code className="font-mono text-xs">{PERM_RBAC_MANAGE}</code>).
                </p>
              </div>
            }
          >
            <LtiToolsSettingsPanel />
          </RequirePermission>
        )}
      </div>

      {avatarModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="generate-avatar-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setAvatarModalOpen(false)
          }}
        >
          <div className="w-full max-w-2xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <h3 id="generate-avatar-title" className="text-sm font-semibold text-slate-900">
                Generate avatar
              </h3>
              <button
                type="button"
                onClick={() => setAvatarModalOpen(false)}
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={onGenerateAvatar} className="grid gap-4 p-4 md:grid-cols-[1fr,240px]">
              <div>
                <label htmlFor="avatar-prompt" className="text-xs font-medium text-slate-600">
                  Prompt
                </label>
                <textarea
                  id="avatar-prompt"
                  rows={6}
                  value={avatarPrompt}
                  onChange={(e) => setAvatarPrompt(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none ring-indigo-500/20 focus:border-indigo-400 focus:ring-2"
                />
                {avatarGenMessage && (
                  <p
                    className={
                      avatarGenStatus === 'error' ? 'mt-2 text-sm text-rose-700' : 'mt-2 text-sm text-emerald-700'
                    }
                    role="status"
                  >
                    {avatarGenMessage}
                  </p>
                )}
                <div className="mt-3 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setAvatarModalOpen(false)}
                    className="rounded-xl px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
                  >
                    Close
                  </button>
                  <button
                    type="submit"
                    disabled={avatarGenStatus === 'loading' || !avatarPrompt.trim()}
                    className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-neutral-100 dark:text-neutral-950 dark:hover:bg-white dark:shadow-none"
                  >
                    {avatarGenStatus === 'loading' ? 'Generating…' : 'Generate'}
                  </button>
                </div>
              </div>
              <div>
                <span className="text-xs font-medium text-slate-600">Preview</span>
                <div className="mt-1 flex h-60 items-center justify-center overflow-hidden rounded-xl border border-dashed border-slate-200 bg-slate-50">
                  {avatarGenStatus === 'loading' && <span className="text-sm text-slate-500">Generating…</span>}
                  {avatarGenStatus !== 'loading' && avatarPreviewUrl && (
                    <img src={avatarPreviewUrl} alt="" className="h-full w-full object-contain" />
                  )}
                  {avatarGenStatus !== 'loading' && !avatarPreviewUrl && (
                    <span className="text-sm text-slate-400">Generated image will appear here</span>
                  )}
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </LmsPage>
  )
}
