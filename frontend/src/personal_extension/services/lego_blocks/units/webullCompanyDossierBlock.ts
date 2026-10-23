// Pure parsers behind the company page: everything the vault already says
// about one company, read from the files where it already lives — nothing
// here is picked by hand or stored twice.

export interface WebullObservationEntryBlock {
  /** YYYY-MM-DD from the `## <date>` heading. */
  date: string
  body: string
}

export interface WebullPricePointBlock {
  date: string
  price: number
}

export interface WebullResearchFileBlock {
  path: string
  name: string
  /** Sortable year*10000 + month*100 + day, from the file name; 0 when none. */
  dateKey: number
}

export interface WebullResearchGroupBlock {
  label: string
  files: WebullResearchFileBlock[]
}

/** `observations.md`: one `## YYYY-MM-DD` section per sitting, newest first. */
export function parseWebullObservationsBlock(content: string): WebullObservationEntryBlock[] {
  const entries: WebullObservationEntryBlock[] = []
  for (const section of content.split(/^## /m).slice(1)) {
    const newline = section.indexOf('\n')
    const heading = (newline < 0 ? section : section.slice(0, newline)).trim()
    const date = heading.match(/^(\d{4}-\d{2}-\d{2})/)?.[1]
    if (!date) continue
    entries.push({ date, body: newline < 0 ? '' : section.slice(newline + 1).trim() })
  }
  return entries.sort((a, b) => b.date.localeCompare(a.date))
}

/** `prices.csv` (date, midday_price, ...): oldest first, unparseable rows dropped. */
export function parseWebullPriceSeriesBlock(csv: string): WebullPricePointBlock[] {
  const lines = csv.split(/\r?\n/).filter(line => line.trim())
  if (lines.length < 2) return []
  const header = lines[0].split(',').map(cell => cell.trim().toLowerCase())
  const dateIndex = header.indexOf('date')
  const priceIndex = ['midday_price', 'close', 'price'].map(name => header.indexOf(name)).find(index => index >= 0) ?? -1
  if (dateIndex < 0 || priceIndex < 0) return []
  const points: WebullPricePointBlock[] = []
  for (const line of lines.slice(1)) {
    const cells = line.split(',')
    const date = cells[dateIndex]?.trim()
    const price = Number(cells[priceIndex])
    if (date && Number.isFinite(price) && price > 0) points.push({ date, price })
  }
  return points.sort((a, b) => a.date.localeCompare(b.date))
}

const MONTHS_BLOCK = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/** "August 2025.pdf", "April-2026.pdf", "TSLA-Feb-2026.md", "2026-06-16-x.md" → sortable key. */
export function parseResearchDateKeyBlock(name: string): number {
  const iso = name.match(/(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return Number(iso[1]) * 10000 + Number(iso[2]) * 100 + Number(iso[3])
  // Value Line issues are filed by month: "2026-04.pdf"
  const yearMonth = name.match(/^(\d{4})-(\d{2})(?:\D|$)/)
  if (yearMonth) return Number(yearMonth[1]) * 10000 + Number(yearMonth[2]) * 100
  const year = name.match(/(?:^|\D)(20\d{2})(?:\D|$)/)?.[1]
  if (!year) return 0
  const lower = name.toLowerCase()
  const month = MONTHS_BLOCK.findIndex(m => new RegExp(`(^|[^a-z])${m}`).test(lower))
  return Number(year) * 10000 + (month >= 0 ? month + 1 : 0) * 100
}

export function sortResearchFilesBlock(files: WebullResearchFileBlock[]): WebullResearchFileBlock[] {
  return [...files].sort((a, b) => (b.dateKey - a.dateKey) || a.name.localeCompare(b.name))
}

function normalizeNameBlock(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * A company's research folder is named by its ticker ("TSLA") or, for the
 * smaller ones, its name ("Marvell", "Applied Materials").
 */
export function researchFolderMatchesBlock(folderName: string, ticker: string, companyName: string | null): boolean {
  const folder = normalizeNameBlock(folderName)
  if (!folder) return false
  if (folder === normalizeNameBlock(ticker)) return true
  const company = companyName ? normalizeNameBlock(companyName) : ''
  return company.length >= 3 && (company.startsWith(folder) || folder.startsWith(company))
}

export function isValueLineFolderBlock(folderName: string): boolean {
  return /value\s*line/i.test(folderName)
}

/**
 * Value Line reports live in F9-execution/<TICKER>/valueline/, one PDF per
 * issue named by its month ("2026-04.pdf"). Value Line reviews each stock
 * about every 13 weeks, so an issue older than that is due for a new one.
 */
export const VALUE_LINE_FOLDER_NAME_BLOCK = 'valueline'

/**
 * Earnings call transcripts live in F9-execution/<TICKER>/calls/, one Markdown
 * file per call named by its quarter's bucket month ("2026-05.md"; the
 * buckets are in kai-workspace/F9/f9-earnings-call-naming-convention.md),
 * plus an optional index.md listing the source pages. Moved there from the
 * research folders 2026-10-23.
 */
export const EARNINGS_CALLS_FOLDER_NAME_BLOCK = 'calls'

// The naming convention's buckets: a call is filed under the nearest of
// Feb / May / Aug / Nov by its real date (day-of-year on a 30-day month grid,
// a tie keeps the first candidate, as the vault's backfill script does), year =
// the bucket's year. Some tickers shift by
// whole buckets so their fiscal quarters line up (MU: one earlier).
const CALL_BUCKET_MONTHS_BLOCK = [2, 5, 8, 11]
const CALL_BUCKET_SHIFT_BLOCK: Record<string, number> = { MU: -1 }

/** "2026-09-30" for MU → "2026-08": the file a call is saved as (without .md). */
export function earningsCallBucketBlock(callDate: string, ticker: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(callDate)
  if (!m) return null
  const year = Number(m[1])
  const pos = (Number(m[2]) - 1) * 30 + Number(m[3])
  const candidates: Array<[number, number, number]> = [
    ...CALL_BUCKET_MONTHS_BLOCK.map((month): [number, number, number] => [month, (month - 1) * 30 + 1, year]),
    [2, 31 + 360, year + 1],
    [11, 301 - 360, year - 1],
  ]
  let best = candidates[0]
  for (const c of candidates) if (Math.abs(pos - c[1]) < Math.abs(pos - best[1])) best = c
  let index = CALL_BUCKET_MONTHS_BLOCK.indexOf(best[0]) + (CALL_BUCKET_SHIFT_BLOCK[ticker.toUpperCase()] ?? 0)
  let bucketYear = best[2]
  bucketYear += Math.floor(index / 4)
  index = ((index % 4) + 4) % 4
  return `${bucketYear}-${String(CALL_BUCKET_MONTHS_BLOCK[index]).padStart(2, '0')}`
}

/** "2026-08" moved by whole months: (-3) → "2026-05". */
export function shiftCallMonthBlock(month: string, delta: number): string {
  const total = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + delta
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`
}

/** How far back a company's calls are kept: four years, sixteen quarters. */
export const EARNINGS_CALL_HISTORY_QUARTERS_BLOCK = 16

/** A call is expected about every quarter; past this many days since the newest one's bucket month, look for the next. */
export const EARNINGS_CALL_DUE_DAYS_BLOCK = 80

export type EarningsCallPlanBlock = 'current' | 'not-covered' | 'checked' | 'ask'

export function earningsCallPlanBlock(latest: WebullResearchFileBlock | null, check: ValueLineCheckBlock | undefined, now: Date): EarningsCallPlanBlock {
  if (latest?.dateKey) {
    const year = Math.floor(latest.dateKey / 10000)
    const month = Math.floor((latest.dateKey % 10000) / 100)
    const since = (now.getTime() - new Date(year, month - 1, 1).getTime()) / 86_400_000
    if (since <= EARNINGS_CALL_DUE_DAYS_BLOCK) return 'current'
  }
  // Same rechecks as Value Line: a day when nothing newer was found, a month when not covered
  return valueLinePlanBlock(null, check, now) as Exclude<EarningsCallPlanBlock, 'current'>
}
export const VALUE_LINE_REVIEW_DAYS_BLOCK = 13 * 7

/** "August 2025" from a report's date key; the file name when it has none. */
export function valueLineIssueLabelBlock(file: WebullResearchFileBlock): string {
  const year = Math.floor(file.dateKey / 10000)
  const month = Math.floor((file.dateKey % 10000) / 100)
  if (!year || !month) return file.name
  return new Date(year, month - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

/** True when the newest issue is older than one review cycle (a month-dated issue counts from its month's end). */
export function valueLineDueBlock(latest: WebullResearchFileBlock | null, now: Date): boolean {
  if (!latest || !latest.dateKey) return false
  const year = Math.floor(latest.dateKey / 10000)
  const month = Math.floor((latest.dateKey % 10000) / 100) || 12
  const day = latest.dateKey % 100
  const issued = day ? new Date(year, month - 1, day) : new Date(year, month, 0)
  return (now.getTime() - issued.getTime()) / 86_400_000 > VALUE_LINE_REVIEW_DAYS_BLOCK
}

/**
 * Fetching a company's newest issue from the library (desktop only). The
 * library is asked only when there is something to find: no issue yet, or the
 * newest one is due. A due company with nothing newer is asked again the next
 * day; one Value Line doesn't cover, after a month.
 */
export const VALUE_LINE_RECHECK_MS_BLOCK = 24 * 60 * 60 * 1000
export const VALUE_LINE_NOT_COVERED_RECHECK_MS_BLOCK = 30 * 24 * 60 * 60 * 1000

export interface ValueLineCheckBlock {
  /** ISO time of the last answer from the library */
  at: string
  result: 'not-covered' | 'no-new' | 'fetched'
}

export type ValueLinePlanBlock = 'current' | 'not-covered' | 'checked' | 'ask'

/** The newest issue among a valueline/ folder's files, or null. */
export function latestValueLineFileBlock(folder: string, names: string[]): WebullResearchFileBlock | null {
  const files = names
    .filter(name => /\.pdf$/i.test(name))
    .map(name => ({ path: `${folder}/${name}`, name: name.replace(/\.pdf$/i, ''), dateKey: parseResearchDateKeyBlock(name) }))
  return sortResearchFilesBlock(files)[0] ?? null
}

export function valueLinePlanBlock(latest: WebullResearchFileBlock | null, check: ValueLineCheckBlock | undefined, now: Date): ValueLinePlanBlock {
  if (latest && !valueLineDueBlock(latest, now)) return 'current'
  const age = check ? now.getTime() - Date.parse(check.at) : Infinity
  if (check?.result === 'not-covered' && age < VALUE_LINE_NOT_COVERED_RECHECK_MS_BLOCK) return 'not-covered'
  if (check && check.result !== 'not-covered' && age < VALUE_LINE_RECHECK_MS_BLOCK) return 'checked'
  return 'ask'
}

/** "2026-09-18" → "2026-09.pdf": one issue a month at most, named like the rest. */
export function valueLineFileNameBlock(issueDate: string): string {
  return `${issueDate.slice(0, 7)}.pdf`
}

export interface ValueLineIssueRowBlock {
  /** year*100 + month; 0 for a saved file with no date in its name */
  monthKey: number
  label: string
  /** The saved PDF, when the issue is in the vault */
  path: string | null
  /** The library's issue date (YYYY-MM-DD), when the library lists it */
  issueDate: string | null
}

/** Saved issues and the library's list as one list by month, newest first. */
export function valueLineIssueRowsBlock(saved: WebullResearchFileBlock[], libraryIssues: string[] | null): ValueLineIssueRowBlock[] {
  const rows = new Map<string, ValueLineIssueRowBlock>()
  for (const file of saved) {
    const monthKey = Math.floor(file.dateKey / 100)
    const key = monthKey ? String(monthKey) : `file:${file.path}`
    if (!rows.has(key)) rows.set(key, { monthKey, label: valueLineIssueLabelBlock(file), path: file.path, issueDate: null })
  }
  for (const issueDate of libraryIssues ?? []) {
    const monthKey = Number(issueDate.slice(0, 4)) * 100 + Number(issueDate.slice(5, 7))
    const row = rows.get(String(monthKey))
    if (row) {
      row.issueDate ??= issueDate
      continue
    }
    const label = new Date(Number(issueDate.slice(0, 4)), Number(issueDate.slice(5, 7)) - 1, 1)
      .toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    rows.set(String(monthKey), { monthKey, label, path: null, issueDate })
  }
  return [...rows.values()].sort((a, b) => b.monthKey - a.monthKey)
}

/** The library's newest issue when it is newer than what the folder has; null when nothing to fetch. */
export function valueLineIssueToFetchBlock(latest: WebullResearchFileBlock | null, issues: Array<{ issueDate: string }>): string | null {
  const newest = issues[0]?.issueDate
  if (!newest) return null
  const newestKey = Number(newest.slice(0, 4)) * 10000 + Number(newest.slice(5, 7)) * 100
  const latestMonthKey = latest ? Math.floor(latest.dateKey / 100) * 100 : 0
  return newestKey > latestMonthKey ? newest : null
}
