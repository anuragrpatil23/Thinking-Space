import { describe, expect, it } from 'vitest'
import { gapsForPositionBlock, type GapPositionLinkBlock } from '@/personal_extension/services/lego_blocks/units/webullGapLinkMatchBlock'

const link = (over: Partial<GapPositionLinkBlock>): GapPositionLinkBlock => ({
  gapId: 'G-0001', title: 't', filePath: '/g.md', webullId: null, symbol: 'TSLA', kind: 'option', strike: 500, right: 'call', expiry: '2025-12-19', account: '', ...over,
})

const option = { symbol: 'TSLA', instrumentType: 'OPTION', optionType: 'CALL', optionExpireDate: '2025-12-19', optionExercisePrice: '500.00' }

describe('gapsForPositionBlock', () => {
  it('matches by Webull id first, with or without the account prefix', () => {
    const links = [link({ gapId: 'G-0086', webullId: 'W1' }), link({ gapId: 'G-0040' })]
    expect(gapsForPositionBlock(links, { id: 'ACC::W1', ...option }).map(g => g.gapId)).toEqual(['G-0086'])
  })

  it('otherwise matches the contract, every gap that bought it, newest first', () => {
    const links = [link({ gapId: 'G-0031' }), link({ gapId: 'G-0040' }), link({ gapId: 'G-0040' }), link({ gapId: 'G-0050', strike: 420 })]
    expect(gapsForPositionBlock(links, { id: 'X', ...option }).map(g => g.gapId)).toEqual(['G-0040', 'G-0031'])
  })

  it('matches a stock to the gaps holding the company\'s stock, and cash to none', () => {
    const links = [link({ gapId: 'G-0003', kind: 'stock', strike: null, expiry: null }), link({ gapId: 'G-0004' })]
    expect(gapsForPositionBlock(links, { id: null, symbol: 'tsla', instrumentType: 'STOCK', optionType: null, optionExpireDate: null, optionExercisePrice: null }).map(g => g.gapId)).toEqual(['G-0003'])
    expect(gapsForPositionBlock(links, { id: null, symbol: 'CASH', instrumentType: 'CASH', optionType: null, optionExpireDate: null, optionExercisePrice: null })).toEqual([])
  })
})
