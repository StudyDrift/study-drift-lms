export type ImageModelOption = {
  id: string
  name: string
  contextLength?: number | null
  inputPricePerMillionUsd?: number | null
  outputPricePerMillionUsd?: number | null
  modalitiesSummary?: string | null
}

export function filterModels(models: ImageModelOption[], query: string): ImageModelOption[] {
  const q = query.trim().toLowerCase()
  if (!q) return models
  return models.filter((m) => {
    if (m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q)) return true
    if (m.modalitiesSummary?.toLowerCase().includes(q)) return true
    return false
  })
}

/** OpenRouter free-tier models often use `:free`; some list $0 / 1M token pricing. */
export function isFreeModel(m: ImageModelOption): boolean {
  if (m.id.includes(':free')) return true
  const inn = m.inputPricePerMillionUsd
  const out = m.outputPricePerMillionUsd
  if (inn == null || out == null) return false
  return Math.abs(inn) < 1e-9 && Math.abs(out) < 1e-9
}

/** Curated order (lower index = shown first when sorting by popularity). */
export const POPULARITY_PREFIX_ORDER: readonly string[] = [
  'openai/gpt-4o',
  'openai/chatgpt-4o',
  'openai/gpt-4-turbo',
  'anthropic/claude-3.5-sonnet',
  'anthropic/claude-3.7-sonnet',
  'anthropic/claude-sonnet-4',
  'anthropic/claude-3',
  'google/gemini-2.5',
  'google/gemini-2.0',
  'google/gemini-3',
  'meta-llama/llama-3.3',
  'meta-llama/llama-3.1',
  'deepseek/deepseek',
  'mistralai/mistral-large',
  'qwen/qwen',
  'x-ai/grok',
  'black-forest-labs/flux',
  'sourceful/riverflow',
  'bytedance-seed/seedream',
]

export function popularityRank(id: string): number {
  const lower = id.toLowerCase()
  for (let i = 0; i < POPULARITY_PREFIX_ORDER.length; i++) {
    if (lower.startsWith(POPULARITY_PREFIX_ORDER[i].toLowerCase())) return i
  }
  return 500 + lower.charCodeAt(0)
}

export function applyPillFiltersAndSort(
  models: ImageModelOption[],
  query: string,
  pillFree: boolean,
  pillPopularity: boolean,
): ImageModelOption[] {
  let list = filterModels(models, query)
  if (pillFree) {
    list = list.filter(isFreeModel)
  }
  if (pillPopularity) {
    list = [...list].sort((a, b) => {
      const ra = popularityRank(a.id)
      const rb = popularityRank(b.id)
      if (ra !== rb) return ra - rb
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    })
  }
  return list
}
