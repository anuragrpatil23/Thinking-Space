// A company's SEC filings, as kept in <company>/filings.csv by the SEC sync
// (newest first), and its annual reports in <company>/annual/:
//   YYYY 10-K.md              the annual report on form 10-K, as readable text
//   YYYY annual report.pdf    the glossy report to shareholders (form ARS), as filed
//
// filings.csv:  date,form,report_date,accession,document,cik

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
}

/** The forms worth listing: reports, results, the proxy, the annual booklet, and their foreign twins. */
export const SEC_FILING_FORMS_BLOCK = new Set(['10-K', '10-Q', '8-K', 'ARS', 'DEF 14A', '20-F', '40-F', '6-K', 'S-1', '10-K/A', '10-Q/A'])

export const SEC_FILING_FORM_LABELS_BLOCK: Record<string, string> = {
  '10-K': 'Annual report',
  '10-K/A': 'Annual report, amended',
  '10-Q': 'Quarterly report',
  '10-Q/A': 'Quarterly report, amended',
  '8-K': 'Current report',
  ARS: 'Annual report to shareholders',
  'DEF 14A': 'Proxy statement',
  '20-F': 'Annual report (foreign)',
  '40-F': 'Annual report (Canada)',
  '6-K': 'Current report (foreign)',
  'S-1': 'Registration',
}

const HEADER = 'date,form,report_date,accession,document,cik'

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
      return [{ date, form, reportDate: recent.reportDate?.[i] ?? '', accession, document, cik }]
    }).sort((a, b) => b.date.localeCompare(a.date) || a.form.localeCompare(b.form))
  } catch {
    return []
  }
}

const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)

export function secFilingsCsvBlock(filings: SecFilingBlock[]): string {
  return [HEADER, ...filings.map(f => [f.date, f.form, f.reportDate, f.accession, f.document, String(f.cik)].map(cell).join(','))].join('\n') + '\n'
}

export function parseSecFilingsCsvBlock(text: string | null): SecFilingBlock[] {
  if (!text) return []
  const rows: SecFilingBlock[] = []
  for (const line of text.split(/\r?\n/).slice(1)) {
    if (!line.trim()) continue
    // Fields are plain except the form ("DEF 14A" has no comma); split simply, unquoting
    const parts = line.match(/("([^"]|"")*"|[^,]*)(,|$)/g)?.map(p => p.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"')) ?? []
    const [date, form, reportDate, accession, document, cik] = parts
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '') || !form || !accession || !document) continue
    rows.push({ date, form, reportDate: reportDate ?? '', accession, document, cik: Number(cik) || 0 })
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
  if (f.form === '10-K' || f.form === '20-F' || f.form === '40-F') return `${folder}/annual/${year} ${f.form}.md`
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
