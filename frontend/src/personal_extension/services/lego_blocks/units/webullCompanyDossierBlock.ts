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
