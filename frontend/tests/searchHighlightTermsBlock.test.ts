import { describe, expect, it } from 'vitest'
import {
  findSearchWordMatchesBlock,
  getSearchHighlightWordsBlock,
  onSearchHighlightWordsBlock,
  setSearchHighlightQueryBlock,
} from '@/services/lego_blocks/units/searchHighlightTermsBlock'

const lit = (text: string, words: string[]) =>
  findSearchWordMatchesBlock(text, words).map(m => text.slice(m.from, m.to))

describe('findSearchWordMatchesBlock', () => {
  it('matches at word starts, any case, lighting the whole word', () => {
    expect(lit('Money, moneyness and the Fact Factory; summoney', ['money', 'fact']))
      .toEqual(['Money', 'moneyness', 'Fact', 'Factory'])
  })
  it('handles accents and regex characters safely', () => {
    expect(lit('Über café (c++) ok', ['café', 'c'])).toEqual(['café', 'c'])
    expect(lit('a.b', ['.'])).toEqual([])
  })
})

describe('search highlight words', () => {
  it('uses the index vocabulary and notifies only on change', () => {
    const seen: string[][] = []
    const off = onSearchHighlightWordsBlock(w => seen.push([...w]))
    setSearchHighlightQueryBlock('the Bank money')
    setSearchHighlightQueryBlock('bank   MONEY')
    expect(getSearchHighlightWordsBlock()).toEqual(['bank', 'money'])
    setSearchHighlightQueryBlock(null)
    off()
    expect(seen).toEqual([['bank', 'money'], []])
  })
})
