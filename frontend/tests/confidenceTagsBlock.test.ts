import { describe, expect, it } from 'vitest'
import { parseConfidenceTagsBlock } from '@/services/lego_blocks/units/confidenceTagsBlock'

describe('parseConfidenceTagsBlock', () => {
  it('returns null and consumes nothing when there is no grid vocabulary', () => {
    const { label, consumed } = parseConfidenceTagsBlock(['held', 'watchlist'])
    expect(label).toBeNull()
    expect(consumed.size).toBe(0)
  })

  it('compacts a single facet', () => {
    const { label, consumed } = parseConfidenceTagsBlock(['for sure for value'])
    expect(label).toBe('sure · value')
    expect(consumed.has('for sure for value')).toBe(true)
  })

  it('folds both axes at one confidence into a single token (MSFT-429)', () => {
    const { label } = parseConfidenceTagsBlock([
      'for sure for price',
      'for sure for value',
      'bucket 1',
    ])
    expect(label).toBe('sure · price+value · b1')
  })

  it('recognizes a bucket with a trailing phrase', () => {
    const { label } = parseConfidenceTagsBlock(['bucket 2 - momentum phase'])
    expect(label).toBe('b2')
  })

  it('recognizes the bare axis and `worked`, leaving Kai placeholders alone', () => {
    const { label, consumed } = parseConfidenceTagsBlock(['for price', 'worked', 'machinery'])
    expect(label).toBe('price · worked')
    expect(consumed.has('machinery')).toBe(false)
  })
})
