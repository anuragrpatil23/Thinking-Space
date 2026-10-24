import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' }, session: { fromPartition: () => ({}) } }))

import { parseValueLineIssuesBlock } from '../electron/src/lego_blocks/libraryValueLineBlock'
import {
  latestValueLineFileBlock,
  valueLineFileNameBlock,
  valueLineIssueRowsBlock,
  valueLineIssueToFetchBlock,
  valueLinePlanBlock,
} from '@/personal_extension/services/lego_blocks/units/webullCompanyDossierBlock'

// The shape of the Research Center's PDF reports module (2026-10-23), trimmed:
// JSON around an HTML table, each issue linked twice (desktop and phone lists)
const row = (ticker: string, label: string, id: string) => `<tr><td class="alignLeft"><span class="icon-pdf-state"></span>`
  + `<a href="/secure/api/report?documentID=${id}&amp;format=PDF&amp;symbol=${ticker}" target="_blank">${label}</a></td>`
  + `<td class="alignLeft"><a href="/secure/api/report?documentID=${id}&amp;format=PDF&amp;symbol=${ticker}" target="_blank">Company</a></td></tr>`
const listing = (rows: string) => JSON.stringify({
  apps: [{ id: 'com_13_4', status: 'SUCCESS', data: {}, html: `<table><thead><tr><th>Date</th></tr></thead><tbody>${rows}${rows}</tbody></table>` }],
  inlineScripts: [],
})

describe('reading the Value Line issue list', () => {
  it('lists each issue once, newest first, with its document id', () => {
    const issues = parseValueLineIssuesBlock(listing(row('MU', 'Jun 19, 2026', '2185-B') + row('MU', 'Sep 18, 2026', '2185-A%2Ba')), 'MU')
    expect(issues).toEqual([
      { issueDate: '2026-09-18', key: '2185-A+a' },
      { issueDate: '2026-06-19', key: '2185-B' },
    ])
  })

  it('answers empty for a ticker with no reports, and null for any page that is not the module', () => {
    expect(parseValueLineIssuesBlock(listing(''), 'TQQQ')).toEqual([])
    expect(parseValueLineIssuesBlock('<html><form action="/login">', 'MU')).toBeNull()
    expect(parseValueLineIssuesBlock('{"apps":[]}', 'MU')).toBeNull()
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

describe('the issue list on the company page', () => {
  it('merges saved issues with the library list by month, newest first', () => {
    const saved = [latestValueLineFileBlock('F9-execution/MU/valueline', ['2026-04.pdf'])!]
    const rows = valueLineIssueRowsBlock(saved, ['2026-09-18', '2026-04-03', '1997-01-24'])
    expect(rows.map(r => [r.label, r.path !== null, r.issueDate])).toEqual([
      ['September 2026', false, '2026-09-18'],
      ['April 2026', true, '2026-04-03'],
      ['January 1997', false, '1997-01-24'],
    ])
  })

  it('shows only saved issues when the library list is not there', () => {
    const saved = [latestValueLineFileBlock('F9-execution/MU/valueline', ['2025-08.pdf'])!]
    expect(valueLineIssueRowsBlock(saved, null).map(r => r.label)).toEqual(['August 2025'])
  })
})
