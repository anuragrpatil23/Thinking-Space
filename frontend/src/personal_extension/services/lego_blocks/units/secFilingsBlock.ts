// A company's SEC filings, as kept in <company>/filings.csv by the SEC sync
// (newest first), and its annual reports in <company>/annual/:
//   YYYY 10-K.pdf             the annual report on form 10-K, printed as filed
//   YYYY annual report.pdf    the glossy report to shareholders (form ARS), as filed
//
// filings.csv:  date,form,report_date,accession,document,cik,items
// (items: an 8-K's item numbers, "2.02 9.01"; files from before it was kept have none)

export interface SecFilingBlock {
  /** The day it was filed, YYYY-MM-DD */
  date: string
  form: string
  /** The period it covers, YYYY-MM-DD; '' when it covers none */
  reportDate: string
  accession: string
  /** The filing's main document */
  document: string
  cik: number
  /** An 8-K's item numbers (what the news is about), space-separated */
  items?: string
}

/** The forms worth listing: reports, results, the proxy, the annual booklet, and their foreign twins. */
export const SEC_FILING_FORMS_BLOCK = new Set(['10-K', '10-Q', '8-K', 'ARS', 'DEF 14A', '20-F', '40-F', '6-K', 'S-1', '10-K/A', '10-Q/A'])

// What an 8-K is about, by its items; the first that matters names it (9.01 is only "exhibits attached")
const EIGHT_K_ITEMS_BLOCK: Array<[string, string]> = [
  ['2.02', 'Results announced'],
  ['5.02', 'Leadership change'],
  ['5.07', 'Shareholder vote results'],
  ['1.01', 'Major agreement signed'],
  ['2.01', 'Acquisition or sale completed'],
  ['2.03', 'New debt taken on'],
  ['2.05', 'Restructuring costs'],
  ['2.06', 'Write-down'],
  ['1.02', 'Agreement ended'],
  ['3.02', 'New shares sold'],
  ['5.03', 'Bylaws or fiscal year changed'],
  ['4.01', 'Auditor changed'],
  ['7.01', 'Investor presentation or update'],
  ['8.01', 'Other company news'],
]

const monthYearBlock = (day: string) => (day ? new Date(`${day}T12:00:00`).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : '')

/** A filing in plain words: what it is, and what it covers. */
export function secFilingTitleBlock(f: Pick<SecFilingBlock, 'form' | 'reportDate' | 'date' | 'items'>): { title: string; covers: string | null } {
  const amended = f.form.endsWith('/A') ? ', corrected' : ''
  const year = (f.reportDate || f.date).slice(0, 4)
  switch (f.form.replace(/\/A$/, '')) {
    case '10-K': return { title: `Annual report${amended}`, covers: `fiscal ${year}` }
    case '20-F': return { title: `Annual report${amended}`, covers: `fiscal ${year}, foreign company` }
    case '40-F': return { title: `Annual report${amended}`, covers: `fiscal ${year}, Canadian company` }
    case '10-Q': return { title: `Quarterly report${amended}`, covers: f.reportDate ? `quarter ending ${monthYearBlock(f.reportDate)}` : null }
    case 'ARS': return { title: 'Annual report to shareholders', covers: 'the booklet' }
    case 'DEF 14A': return { title: 'Proxy statement', covers: 'the vote, the board, executive pay' }
    case 'S-1': return { title: 'Registration to sell shares', covers: null }
    case '6-K': return { title: 'Company news', covers: 'foreign company' }
    case '8-K': {
      const items = (f.items ?? '').split(/[\s,]+/)
      const named = EIGHT_K_ITEMS_BLOCK.filter(([code]) => items.includes(code)).map(([, label]) => label)
      return { title: named[0] ?? 'Company news', covers: named.length > 1 ? named.slice(1).join(', ').toLowerCase() : null }
    }
    default: return { title: f.form, covers: null }
  }
}

const HEADER = 'date,form,report_date,accession,document,cik,items'

/** The filings worth listing from SEC's submissions file, newest first, from `since` (YYYY-MM-DD) on. */
export function secFilingsFromSubmissionsBlock(body: string | null, cik: number, since: string): SecFilingBlock[] {
  if (!body) return []
  try {
    const recent = (JSON.parse(body) as { filings?: { recent?: Record<string, string[] | undefined> } }).filings?.recent ?? {}
    const forms = recent.form ?? []
    return forms.flatMap((form, i) => {
      const date = recent.filingDate?.[i] ?? ''
      const accession = recent.accessionNumber?.[i] ?? ''
      const document = recent.primaryDocument?.[i] ?? ''
      if (!SEC_FILING_FORMS_BLOCK.has(form) || date < since || !accession || !document) return []
      const items = (recent.items?.[i] ?? '').split(',').map(x => x.trim()).filter(Boolean).join(' ')
      return [{ date, form, reportDate: recent.reportDate?.[i] ?? '', accession, document, cik, ...(items ? { items } : {}) }]
    }).sort((a, b) => b.date.localeCompare(a.date) || a.form.localeCompare(b.form))
  } catch {
    return []
  }
}

const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)

export function secFilingsCsvBlock(filings: SecFilingBlock[]): string {
  return [HEADER, ...filings.map(f => [f.date, f.form, f.reportDate, f.accession, f.document, String(f.cik), f.items ?? ''].map(cell).join(','))].join('\n') + '\n'
}

export function parseSecFilingsCsvBlock(text: string | null): SecFilingBlock[] {
  if (!text) return []
  const rows: SecFilingBlock[] = []
  for (const line of text.split(/\r?\n/).slice(1)) {
    if (!line.trim()) continue
    // Fields are plain except the form ("DEF 14A" has no comma); split simply, unquoting
    const parts = line.match(/("([^"]|"")*"|[^,]*)(,|$)/g)?.map(p => p.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"')) ?? []
    const [date, form, reportDate, accession, document, cik, items] = parts
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '') || !form || !accession || !document) continue
    rows.push({ date, form, reportDate: reportDate ?? '', accession, document, cik: Number(cik) || 0, ...(items ? { items } : {}) })
  }
  return rows
}

/** The filing's main document on sec.gov. */
export function secFilingUrlBlock(f: Pick<SecFilingBlock, 'cik' | 'accession' | 'document'>): string {
  return `https://www.sec.gov/Archives/edgar/data/${f.cik}/${f.accession.replace(/-/g, '')}/${f.document}`
}

/** Where the annual reports for a filing land in the company's folder. */
export function annualReportPathBlock(folder: string, f: Pick<SecFilingBlock, 'form' | 'reportDate' | 'date' | 'document'>): string | null {
  const year = (f.reportDate || f.date).slice(0, 4)
  if (f.form === '10-K' || f.form === '20-F' || f.form === '40-F') return `${folder}/annual/${year} ${f.form}.pdf`
  if (f.form === 'ARS' && /\.pdf$/i.test(f.document)) return `${folder}/annual/${year} annual report.pdf`
  return null
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', mdash: '—', ndash: '–', hellip: '…', bull: '•', reg: '®', trade: '™', copy: '©' }

function decodeEntitiesBlock(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m
    }
    return ENTITIES[code.toLowerCase()] ?? m
  })
}

/**
 * A filing's HTML as readable text: blocks become paragraphs, table rows become
 * lines with cells split by " | ", and the inline XBRL header (machine data
 * the reader never sees) is dropped. Plain string work, no DOM: a 10-K can be
 * 10 MB, and parsing that into a document would stall the window.
 */
export function filingHtmlToTextBlock(html: string): string {
  const text = html
    .replace(/<ix:header[\s\S]*?<\/ix:header>/gi, '')
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\/(td|th)>/gi, ' | ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6]|table|section)>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
  return decodeEntitiesBlock(text)
    .split('\n')
    .map(line => line.replace(/[ \t ]+/g, ' ').replace(/(\s*\|\s*)+$/, '').replace(/^(\s*\|\s*)+/, '').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** The 10-K as a note: a small header, then its text. */
export function annualReportNoteBlock(params: { ticker: string; filing: SecFilingBlock; text: string }): string {
  const { ticker, filing, text } = params
  const year = (filing.reportDate || filing.date).slice(0, 4)
  return [
    '---',
    `ticker: ${ticker}`,
    `form: ${filing.form}`,
    `filed: ${filing.date}`,
    `period: ${filing.reportDate}`,
    `source: ${secFilingUrlBlock(filing)}`,
    'type: annual-report',
    '---',
    '',
    `# ${ticker} ${filing.form} · fiscal ${year}`,
    '',
    text,
    '',
  ].join('\n')
}
