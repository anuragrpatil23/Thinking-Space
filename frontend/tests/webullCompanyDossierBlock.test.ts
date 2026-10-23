import { describe, expect, it } from 'vitest'
import {
  parseResearchDateKeyBlock,
  parseWebullObservationsBlock,
  parseWebullPriceSeriesBlock,
  researchFolderMatchesBlock,
  valueLineDueBlock,
  valueLineIssueLabelBlock,
} from '@/personal_extension/services/lego_blocks/units/webullCompanyDossierBlock'

describe('webullCompanyDossierBlock', () => {
  it('splits observations by dated heading, newest first', () => {
    const entries = parseWebullObservationsBlock('# TSLA — Observations\n\n## 2026-06-23\nNo thesis change.\n\n## 2026-07-01 — print\nTrimmed.\n')
    expect(entries.map(e => e.date)).toEqual(['2026-07-01', '2026-06-23'])
    expect(entries[1].body).toBe('No thesis change.')
  })

  it('reads midday prices and drops blank rows', () => {
    const points = parseWebullPriceSeriesBlock('date,midday_price,prev_open\n2023-10-11,262.99,\n2023-10-10,263.62,\n2023-10-12,,\n')
    expect(points).toEqual([{ date: '2023-10-10', price: 263.62 }, { date: '2023-10-11', price: 262.99 }])
  })

  it('orders report names by the date they carry', () => {
    const keys = ['August 2025.pdf', 'April-2026.pdf', 'Sept 2025.pdf', 'TSLA-Feb-2026.md', 'report.pdf'].map(parseResearchDateKeyBlock)
    expect(keys).toEqual([20250800, 20260400, 20250900, 20260200, 0])
  })

  it('matches research folders by ticker or company name', () => {
    expect(researchFolderMatchesBlock('TSLA', 'TSLA', null)).toBe(true)
    expect(researchFolderMatchesBlock('Marvell', 'MRVL', 'Marvell Technology')).toBe(true)
    expect(researchFolderMatchesBlock('Applied Digital', 'AMAT', 'Applied Materials')).toBe(false)
    expect(researchFolderMatchesBlock('Applied Materials', 'AMAT', 'Applied Materials, Inc.')).toBe(true)
  })

  it('reads Value Line issues filed by month and knows when one is due', () => {
    const key = parseResearchDateKeyBlock('2026-04.pdf')
    expect(key).toBe(20260400)
    const issue = { path: 'MU/valueline/2026-04.pdf', name: '2026-04', dateKey: key }
    expect(valueLineIssueLabelBlock(issue)).toBe('April 2026')
    // Counted from the end of April: due once 13 weeks have passed
    expect(valueLineDueBlock(issue, new Date(2026, 6, 25))).toBe(false)
    expect(valueLineDueBlock(issue, new Date(2026, 7, 5))).toBe(true)
    expect(valueLineDueBlock(null, new Date())).toBe(false)
    expect(parseResearchDateKeyBlock('August 2025.pdf')).toBe(20250800)
  })
})
