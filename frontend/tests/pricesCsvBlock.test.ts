import { describe, expect, it } from 'vitest'
import { marketDayBlock, mergePriceBarsBlock, priceDateRangeBlock, rsiSeriesBlock, settledBarsBlock } from '@/personal_extension/services/lego_blocks/units/pricesCsvBlock'
import { parsePriceBandsBlock } from '@/personal_extension/services/lego_blocks/units/priceBandsBlock'
import { parseYahooDailyBarsBlock } from '@/personal_extension/services/lego_blocks/integrations/yahooQuoteBlock'

const OLD = `date,midday_price,prev_open,prev_close,rsi_14,mfi_14,source
2026-01-05,312.1500,295.1300,315.4200,0.00,,yfinance-daily-backfill
2026-01-06,318.0000,312.0000,312.1500,55.00,,yfinance-midday
`

describe('prices.csv', () => {
  it('adds days before and after, and leaves the rows already there exactly as written', () => {
    const { csv, added } = mergePriceBarsBlock(OLD, [
      { date: '2026-01-02', open: 300, close: 315.42 },
      { date: '2026-01-05', open: 312, close: 999 },
      { date: '2026-01-07', open: 318.5, close: 320 },
    ])
    expect(added).toBe(2)
    const lines = csv.trim().split('\n')
    expect(lines[0]).toBe('date,midday_price,prev_open,prev_close,rsi_14,mfi_14,source')
    expect(lines.slice(1).map(l => l.split(',')[0])).toEqual(['2026-01-02', '2026-01-05', '2026-01-06', '2026-01-07'])
    expect(lines[2]).toBe('2026-01-05,312.1500,295.1300,315.4200,0.00,,yfinance-daily-backfill')
    // The day after a kept row uses the file's own close for prev_close
    expect(lines[4]).toBe('2026-01-07,320.0000,,318.0000,,,yahoo-daily')
  })

  it('starts a new file with the header, and changes nothing when there is nothing new', () => {
    const fresh = mergePriceBarsBlock(null, [{ date: '2026-01-02', open: 1, close: 2 }])
    expect(fresh.csv).toBe('date,midday_price,prev_open,prev_close,rsi_14,mfi_14,source\n2026-01-02,2.0000,,,,,yahoo-daily\n')
    expect(mergePriceBarsBlock(OLD, [{ date: '2026-01-05', open: 1, close: 2 }])).toEqual({ csv: OLD, added: 0 })
    expect(priceDateRangeBlock(OLD)).toEqual({ first: '2026-01-05', last: '2026-01-06' })
  })

  it("computes Wilder's RSI once there are fifteen closes", () => {
    const rising = Array.from({ length: 20 }, (_, i) => 100 + i)
    const rsi = rsiSeriesBlock(rising)
    expect(rsi[13]).toBeNull()
    expect(rsi[14]).toBe(100)
  })

  it("leaves out today's bar until the session is over", () => {
    const bars = [{ date: '2026-10-22', open: 1, close: 1 }, { date: '2026-10-23', open: 1, close: 2 }]
    const midday = new Date('2026-10-23T16:00:00Z') // noon in New York
    const evening = new Date('2026-10-23T22:30:00Z')
    expect(marketDayBlock(midday)).toEqual({ today: '2026-10-23', closed: false })
    expect(settledBarsBlock(bars, midday).map(b => b.date)).toEqual(['2026-10-22'])
    expect(settledBarsBlock(bars, evening).map(b => b.date)).toEqual(['2026-10-22', '2026-10-23'])
  })

  it("reads Yahoo's daily bars on the exchange's own day", () => {
    const body = JSON.stringify({ chart: { result: [{ meta: { exchangeTimezoneName: 'America/New_York' }, timestamp: [1792762200], indicators: { quote: [{ open: [101.5], close: [102.25] }] } }] } })
    expect(parseYahooDailyBarsBlock(body)).toEqual([{ date: '2026-10-23', open: 101.5, close: 102.25 }])
  })
})

describe('bands.yaml', () => {
  it('reads the bands, settled or forming, and skips broken ones', () => {
    const bands = parsePriceBandsBlock(`ticker: AAPL
last_updated: 2026-06-10
bands:
  - id: R1
    lo: 246
    hi: 260
    state: settled
    duration_note: "4w spring band"
  - { id: R2, lo: 270, hi: 265 }
  - { lo: 290, hi: 300, state: forming }
`)
    expect(bands).toEqual({
      lastUpdated: '2026-06-10',
      bands: [
        { id: 'R1', lo: 246, hi: 260, state: 'settled', note: '4w spring band' },
        { id: 'B3', lo: 290, hi: 300, state: 'forming', note: null },
      ],
    })
    expect(parsePriceBandsBlock('not: [yaml')).toBeNull()
  })
})
