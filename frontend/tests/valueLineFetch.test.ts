import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' }, session: { fromPartition: () => ({}) } }))

import { parseValueLineIssuesBlock } from '../electron/src/lego_blocks/libraryValueLineBlock'
import {
  latestValueLineFileBlock,
  valueLineFileNameBlock,
  valueLineIssueToFetchBlock,
  valueLinePlanBlock,
} from '@/personal_extension/services/lego_blocks/units/webullCompanyDossierBlock'

// The shape of the library's Historical Reports answer (2026-10-23), trimmed
const row = (ticker: string, label: string, key: string) => `
  <tr>
    <td class="text-start"><a class="text-success" href="?IssueDate=x">Micron Technology</a></td>
    <td class="text-center"><a class="text-success" href="?IssueDate=x">${label}</a></td>
    <td class="text-center">
      <a href='/File/Handler?productCode=investment-survey&amp;key=reports\\${key}' target='_blank'>
        <i class="bi bi-file-earmark-pdf-fill text-danger" title='Report of ${ticker} for ${label}'></i>
      </a>
    </td>
    <td class="text-center pdf-list"><a href='/File/Handler?productCode=investment-survey&key=so\\OTHER'>x</a></td>
  </tr>`
const listing = (rows: string) => `<table id="tableDataList"><tbody><tr><td>MU</td></tr></tbody></table>
  <table id="tableSearchedByTicker" class="table"><thead><tr><th>Company Name</th></tr></thead><tbody>${rows}</tbody></table>`

describe('reading the Value Line issue list', () => {
  it('lists each issue newest first with its report key', () => {
    const issues = parseValueLineIssuesBlock(listing(row('MU', 'Jun 19, 2026', 'B%2Fb') + row('MU', 'Sep 18, 2026', 'A%2Ba')), 'MU')
    expect(issues).toEqual([
      { issueDate: '2026-09-18', key: 'reports\\A%2Ba' },
      { issueDate: '2026-06-19', key: 'reports\\B%2Fb' },
    ])
  })

  it('answers empty for a ticker Value Line does not cover, and null for any other page', () => {
    expect(parseValueLineIssuesBlock('<p>Sorry! Report not found for the ticker (TQQQ). Please try again.</p>', 'TQQQ')).toEqual([])
    expect(parseValueLineIssuesBlock('<html><form action="/login">', 'MU')).toBeNull()
  })

  it('ignores rows for another ticker', () => {
    expect(parseValueLineIssuesBlock(listing(row('MUX', 'Sep 18, 2026', 'A')), 'MU')).toEqual([])
  })
})

describe('when to ask the library', () => {
  const now = new Date('2026-10-23T12:00:00')
  const folder = 'F9-execution/MU/valueline'
  const latest = (names: string[]) => latestValueLineFileBlock(folder, names)

  it('takes the newest PDF in the folder', () => {
    expect(latest(['2025-08.pdf', '2026-04.pdf', 'notes.md'])?.name).toBe('2026-04')
    expect(latest([])).toBeNull()
  })

  it('leaves a current company alone and asks for a due or missing one', () => {
    expect(valueLinePlanBlock(latest(['2026-09.pdf']), undefined, now)).toBe('current')
    expect(valueLinePlanBlock(latest(['2026-04.pdf']), undefined, now)).toBe('ask')
    expect(valueLinePlanBlock(null, undefined, now)).toBe('ask')
  })

  it('asks a due company again after a day, and an uncovered one after a month', () => {
    const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString()
    expect(valueLinePlanBlock(null, { at: hoursAgo(2), result: 'no-new' }, now)).toBe('checked')
    expect(valueLinePlanBlock(null, { at: hoursAgo(30), result: 'no-new' }, now)).toBe('ask')
    expect(valueLinePlanBlock(null, { at: hoursAgo(24 * 20), result: 'not-covered' }, now)).toBe('not-covered')
    expect(valueLinePlanBlock(null, { at: hoursAgo(24 * 40), result: 'not-covered' }, now)).toBe('ask')
  })

  it('fetches the newest issue only when its month is newer than the folder', () => {
    const issues = [{ issueDate: '2026-09-18' }, { issueDate: '2026-06-19' }]
    expect(valueLineIssueToFetchBlock(latest(['2026-04.pdf']), issues)).toBe('2026-09-18')
    expect(valueLineIssueToFetchBlock(latest(['2026-09.pdf']), issues)).toBeNull()
    expect(valueLineIssueToFetchBlock(null, issues)).toBe('2026-09-18')
    expect(valueLineIssueToFetchBlock(null, [])).toBeNull()
    expect(valueLineFileNameBlock('2026-09-18')).toBe('2026-09.pdf')
  })
})
