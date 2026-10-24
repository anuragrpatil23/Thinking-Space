import { describe, expect, it } from 'vitest'
import { leadWordsBlock, librarySearchPairsBlock, teaserSupportBlock, titleSimilarityBlock } from '@/services/lego_blocks/units/libraryMatchBlock'

const FEED = 'Tesla Profit Slumps as Elon Musk’s Car Company Considers Merging With SpaceX'
const GALE = 'Tesla Profit Slumps as Musk Pours Money Into A.I. and Robots.'
const TEASER = 'The carmaker, which is controlled by Elon Musk and is considering merging with another of his companies, SpaceX, spent heavily on artificial intelligence and other new technologies.'

describe('a headline the paper rewrote', () => {
  it('searches by its subject first, then its longest words', () => {
    expect(leadWordsBlock(FEED)).toEqual(['tesla', 'profit'])
    expect(librarySearchPairsBlock(FEED)[0]).toEqual(['tesla', 'profit'])
    expect(new Set(librarySearchPairsBlock(FEED).map(p => [...p].sort().join(' '))).size).toBe(librarySearchPairsBlock(FEED).length)
  })

  it('matches only in part, and is confirmed by the article carrying the teaser', () => {
    const score = titleSimilarityBlock(GALE, FEED)
    expect(score).toBeGreaterThan(0.35)
    expect(score).toBeLessThan(0.8)
    const article = 'Tesla, the carmaker controlled by Elon Musk, said profit fell as it spent heavily on artificial intelligence and other technologies. The company is considering merging with another of his companies, SpaceX, which reported...'
    expect(teaserSupportBlock(TEASER, article)).toBeGreaterThanOrEqual(0.6)
    const other = 'Tesla recalled two million vehicles on Tuesday over a steering defect, the National Highway Traffic Safety Administration said.'
    expect(teaserSupportBlock(TEASER, other)).toBeLessThan(0.6)
    expect(teaserSupportBlock('Short teaser.', article)).toBeNull()
  })
})
