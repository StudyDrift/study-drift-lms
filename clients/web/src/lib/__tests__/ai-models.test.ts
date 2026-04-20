import { describe, expect, it } from 'vitest'
import { FALLBACK_IMAGE_MODEL_OPTIONS, FALLBACK_TEXT_MODEL_OPTIONS } from '../ai-models'

describe('fallback model lists', () => {
  it('image options have non-empty id and label', () => {
    for (const o of FALLBACK_IMAGE_MODEL_OPTIONS) {
      expect(o.id.length).toBeGreaterThan(0)
      expect(o.label.length).toBeGreaterThan(0)
    }
    expect(FALLBACK_IMAGE_MODEL_OPTIONS.length).toBeGreaterThanOrEqual(3)
  })

  it('text options have non-empty id and label', () => {
    for (const o of FALLBACK_TEXT_MODEL_OPTIONS) {
      expect(o.id.length).toBeGreaterThan(0)
      expect(o.label.length).toBeGreaterThan(0)
    }
    expect(FALLBACK_TEXT_MODEL_OPTIONS.length).toBeGreaterThanOrEqual(3)
  })

  it('ids are unique within each list', () => {
    const img = new Set(FALLBACK_IMAGE_MODEL_OPTIONS.map((o) => o.id))
    const txt = new Set(FALLBACK_TEXT_MODEL_OPTIONS.map((o) => o.id))
    expect(img.size).toBe(FALLBACK_IMAGE_MODEL_OPTIONS.length)
    expect(txt.size).toBe(FALLBACK_TEXT_MODEL_OPTIONS.length)
  })
})
