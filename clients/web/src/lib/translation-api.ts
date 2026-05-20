import { authorizedFetch } from './api'
import { readApiErrorMessage } from './errors'

export type ContentType = 'feed_post' | 'discussion_post' | 'inbox_message' | 'announcement'

export interface TranslateResponse {
  translated: string
  source_lang: string
  cached: boolean
}

export async function translateContent(
  contentType: ContentType,
  contentId: string,
  targetLang: string,
  text: string,
): Promise<TranslateResponse> {
  const res = await authorizedFetch('/api/v1/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content_type: contentType, content_id: contentId, target_lang: targetLang, text }),
  })
  const raw = (await res.json()) as unknown
  if (!res.ok) {
    throw new Error(readApiErrorMessage(raw))
  }
  return raw as TranslateResponse
}
