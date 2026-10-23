import { describe, expect, it } from 'vitest'
import {
  LIBRARY_MATCH_THRESHOLD_BLOCK,
  bestLibraryHitBlock,
  librarySourceForLinkBlock,
  queryWordsBlock,
  titleSimilarityBlock,
} from '@/services/lego_blocks/units/libraryMatchBlock'

describe('matching a feed item to the library', () => {
  it('knows which library source a link belongs to', () => {
    expect(librarySourceForLinkBlock('https://www.nytimes.com/2026/10/22/business/x.html')?.name).toBe('NYT')
    expect(librarySourceForLinkBlock('https://www.washingtonpost.com/tech/2026/x')?.name).toBe('Washington Post')
    expect(librarySourceForLinkBlock('https://www.wsj.com/articles/x')).toBeNull()
    expect(librarySourceForLinkBlock('not a url')).toBeNull()
  })

  it('searches by the longest distinctive words, without stop words', () => {
    expect(queryWordsBlock('How the Fed Learned to Stop Worrying About Inflation')).toEqual(['inflation', 'worrying', 'learned', 'stop'])
  })

  it('scores the same headline high and a different story low', () => {
    expect(titleSimilarityBlock('Bose Is Buying Skullcandy', 'Bose is buying Skullcandy')).toBe(1)
    expect(titleSimilarityBlock('Micron Shelves Plan for U.S. Listing of Memory Unit', 'Micron shelves plans for US listing of its memory-chip unit')).toBeGreaterThanOrEqual(LIBRARY_MATCH_THRESHOLD_BLOCK)
    expect(titleSimilarityBlock('Oil Falls on Technical Correction', 'Volvo Cuts 2,600 Jobs')).toBeLessThan(LIBRARY_MATCH_THRESHOLD_BLOCK)
  })

  it('picks the closest hit', () => {
    const best = bestLibraryHitBlock('Airbnb Bans Making Guests Do Dishes', [
      { title: 'Airbnb hosts push back', docId: 'A1' },
      { title: 'Airbnb bans making guests do dishes', docId: 'A2' },
    ])
    expect(best?.hit.docId).toBe('A2')
    expect(bestLibraryHitBlock('x', [])).toBeNull()
  })
})
