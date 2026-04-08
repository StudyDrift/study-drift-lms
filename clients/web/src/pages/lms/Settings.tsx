import { type FormEvent, useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { ImageModelPicker } from '../../components/ImageModelPicker'
import { RequirePermission } from '../../components/RequirePermission'
import { RolesPermissionsPanel } from '../../components/settings/RolesPermissionsPanel'
import { PERM_RBAC_MANAGE } from '../../lib/rbacApi'
import { LmsPage } from './LmsPage'
import { FALLBACK_IMAGE_MODEL_OPTIONS, FALLBACK_TEXT_MODEL_OPTIONS } from '../../lib/aiModels'
import { authorizedFetch } from '../../lib/api'
import { readApiErrorMessage } from '../../lib/errors'

type TabId = 'ai' | 'account' | 'notifications' | 'roles'

function isTabId(s: string | null): s is TabId {
  return s === 'ai' || s === 'account' || s === 'notifications' || s === 'roles'
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
  const { tab: tabParam } = useParams()
  const rawTab = tabParam ?? null
  const activeTab: TabId = isTabId(rawTab) ? rawTab : 'ai'

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

  useEffect(() => {
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
  }, [loadModels])

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
    } catch {
      setAiError('Could not save settings.')
    } finally {
      setAiSaving(false)
    }
  }

  const saveDisabled = aiSaving || !imageModelId || !courseSetupModelId

  return (
    <LmsPage title="Settings" description="Account and learning preferences.">
      <div className={`mt-8 ${activeTab === 'roles' ? 'max-w-4xl' : 'max-w-xl'}`}>
        {activeTab === 'ai' && (
          <div>
            <h2 className="text-base font-semibold text-slate-900">Artificial Intelligence</h2>
            <p className="mt-1 text-sm text-slate-500">
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
                  className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {aiSaving ? 'Saving…' : 'Save'}
                </button>
              </form>
            )}
          </div>
        )}

        {activeTab === 'account' && (
          <div>
            <h2 className="text-base font-semibold text-slate-900">Account</h2>
            <p className="mt-1 text-sm text-slate-500">Account settings will appear here.</p>
          </div>
        )}

        {activeTab === 'notifications' && (
          <div>
            <h2 className="text-base font-semibold text-slate-900">Notifications</h2>
            <p className="mt-1 text-sm text-slate-500">Notification settings will appear here.</p>
          </div>
        )}

        {activeTab === 'roles' && (
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
      </div>
    </LmsPage>
  )
}
