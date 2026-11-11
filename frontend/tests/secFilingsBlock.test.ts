import { describe, expect, it } from 'vitest'
import {
  annualReportPathBlock,
  filingHtmlToTextBlock,
  parseSecFilingsCsvBlock,
  secFilingsCsvBlock,
  secFilingsFromSubmissionsBlock,
  secFilingUrlBlock,
} from '@/personal_extension/services/lego_blocks/units/secFilingsBlock'

const submissions = JSON.stringify({
  filings: {
    recent: {
      form: ['8-K', '10-Q', '4', 'ARS', 'DEF 14A', '10-K', '10-K'],
      filingDate: ['2026-10-30', '2026-08-01', '2026-07-01', '2026-01-10', '2026-01-10', '2025-11-01', '2022-11-01'],
      reportDate: ['2026-10-30', '2026-06-27', '', '', '', '2025-09-27', '2022-09-24'],
      accessionNumber: ['0000320193-26-000100', '0000320193-26-000080', 'x', '0000320193-26-000010', '0000320193-26-000011', '0000320193-25-000079', 'y'],
      primaryDocument: ['a8-k.htm', 'q3.htm', 'f4.xml', 'ars2025.pdf', 'proxy.htm', 'aapl-20250927.htm', 'old.htm'],
    },
  },
})

describe('SEC filings', () => {
  it('keeps the forms worth listing from the date asked, newest first', () => {
    const filings = secFilingsFromSubmissionsBlock(submissions, 320193, '2025-01-01')
    expect(filings.map(f => f.form)).toEqual(['8-K', '10-Q', 'ARS', 'DEF 14A', '10-K'])
    expect(secFilingUrlBlock(filings[4])).toBe('https://www.sec.gov/Archives/edgar/data/320193/000032019325000079/aapl-20250927.htm')
  })
  it('round-trips through filings.csv', () => {
    const filings = secFilingsFromSubmissionsBlock(submissions, 320193, '2025-01-01')
    expect(parseSecFilingsCsvBlock(secFilingsCsvBlock(filings))).toEqual(filings)
  })
  it('files a 10-K as text and the annual report booklet as its PDF, by fiscal year', () => {
    const [, , ars, proxy, tenK] = secFilingsFromSubmissionsBlock(submissions, 320193, '2025-01-01')
    expect(annualReportPathBlock('/f9/AAPL', tenK)).toBe('/f9/AAPL/annual/2025 10-K.md')
    expect(annualReportPathBlock('/f9/AAPL', ars)).toBe('/f9/AAPL/annual/2026 annual report.pdf')
    expect(annualReportPathBlock('/f9/AAPL', proxy)).toBeNull()
  })
  it('turns a filing into readable text, without the machine-only XBRL header', () => {
    const html = '<html><head><title>x</title></head><body><ix:header><ix:hidden>secret</ix:hidden></ix:header>'
      + '<p>Net sales&nbsp;rose <b>8%</b>.</p><table><tr><td>Revenue</td><td>$391,035</td></tr></table><div>Risk&#8217;s here</div></body></html>'
    expect(filingHtmlToTextBlock(html)).toBe('Net sales rose 8%.\n\nRevenue | $391,035\n\nRisk’s here')
  })
})
