/** Fallback when the server has no OpenRouter key or the models API fails. */
export const FALLBACK_IMAGE_MODEL_OPTIONS = [
  { id: 'google/gemini-2.5-flash-image', label: 'Gemini 2.5 Flash (image)' },
  { id: 'google/gemini-3.1-flash-image-preview', label: 'Gemini 3.1 Flash Image (preview)' },
  { id: 'black-forest-labs/flux.2-pro', label: 'FLUX.2 Pro' },
  { id: 'black-forest-labs/flux.2-flex', label: 'FLUX.2 Flex' },
  { id: 'sourceful/riverflow-v2-fast', label: 'Riverflow v2 Fast' },
  { id: 'sourceful/riverflow-v2-pro', label: 'Riverflow v2 Pro' },
] as const

/** Text-to-text (chat) models — fallback when OpenRouter list is unavailable. */
export const FALLBACK_TEXT_MODEL_OPTIONS = [
  { id: 'google/gemini-2.0-flash-001', label: 'Gemini 2.0 Flash' },
  { id: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  { id: 'openai/gpt-4o-mini', label: 'GPT-4o mini' },
  { id: 'anthropic/claude-3.5-sonnet', label: 'Claude 3.5 Sonnet' },
  { id: 'meta-llama/llama-3.3-70b-instruct', label: 'Llama 3.3 70B Instruct' },
] as const
