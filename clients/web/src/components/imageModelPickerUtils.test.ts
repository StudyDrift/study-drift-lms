import { describe, expect, it } from 'vitest'
import {
  applyPillFiltersAndSort,
  filterModels,
  isFreeModel,
  popularityRank,
  type ImageModelOption,
} from './imageModelPickerUtils'

const sample: ImageModelOption[] = [
  { id: 'zoo/late', name: 'Z', inputPricePerMillionUsd: 1, outputPricePerMillionUsd: 1 },
  { id: 'openai/gpt-4o-mini', name: 'Mini', inputPricePerMillionUsd: 0, outputPricePerMillionUsd: 0 },
  { id: 'google/gemini-2.5-flash:free', name: 'Free Gem', inputPricePerMillionUsd: 1, outputPricePerMillionUsd: 1 },
  { id: 'anthropic/claude-3.5-sonnet', name: 'Claude', modalitiesSummary: 'vision + text' },
]

describe('filterModels', () => {
  it('returns all when query is empty', () => {
    expect(filterModels(sample, '  ')).toHaveLength(4)
  })

  it('matches id, name, or modalities summary', () => {
    expect(filterModels(sample, 'claude').map((m) => m.id)).toEqual(['anthropic/claude-3.5-sonnet'])
    expect(filterModels(sample, 'vision').map((m) => m.id)).toEqual(['anthropic/claude-3.5-sonnet'])
    expect(filterModels(sample, 'gpt-4o-mini').map((m) => m.id)).toEqual(['openai/gpt-4o-mini'])
  })
})

describe('isFreeModel', () => {
  it('detects :free suffix', () => {
    expect(isFreeModel({ id: 'x:free', name: 'Free' })).toBe(true)
  })

  it('detects zero input and output price', () => {
    expect(
      isFreeModel({
        id: 'paid-id',
        name: 'x',
        inputPricePerMillionUsd: 0,
        outputPricePerMillionUsd: 0,
      }),
    ).toBe(true)
  })

  it('returns false when prices are null or non-zero', () => {
    expect(isFreeModel({ id: 'a', name: 'a' })).toBe(false)
    expect(
      isFreeModel({
        id: 'a',
        name: 'a',
        inputPricePerMillionUsd: 0,
        outputPricePerMillionUsd: 1,
      }),
    ).toBe(false)
  })
})

describe('popularityRank', () => {
  it('ranks known prefixes lower than unknown', () => {
    expect(popularityRank('openai/gpt-4o-mini')).toBeLessThan(popularityRank('zzz/unknown'))
  })
})

describe('applyPillFiltersAndSort', () => {
  it('combines free filter and popularity sort', () => {
    const out = applyPillFiltersAndSort(sample, '', true, true)
    expect(out.every(isFreeModel)).toBe(true)
    expect(out[0]!.id).toBe('openai/gpt-4o-mini')
  })
})
