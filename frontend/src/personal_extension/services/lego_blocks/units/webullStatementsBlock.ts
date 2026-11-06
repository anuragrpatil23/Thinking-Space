// The Webull statements in the vault, as the statements skill lays them out
// under <executionRoot>/statements/webull/: individual/YYYY-MM.pdf (older
// Apex-era ones in individual/apex/), ira/YYYY-MM.pdf, tax/YYYY.pdf.
//
// Thinking Space shows what is there and drops new PDFs into statements/inbox/
// as they were downloaded; it never reads a PDF. An agent sorts the inbox by the
// account and period printed inside and turns the statements into the
// webull-*.csv files (`thinkspc skill.get --name statements`), so a PDF the CSVs
// do not mention yet is "not read yet".

/** A folder under webull/: one per account type ("individual", "ira", "roth-ira", …), plus tax. */
export type StatementFolderBlock = string

/** The folders the app knows by name; any other account folder is listed too, named from its folder. */
export const STATEMENT_FOLDERS_BLOCK: Array<{ folder: string; label: string }> = [
  { folder: 'individual', label: 'Individual' },
  { folder: 'ira', label: 'IRA' },
  { folder: 'roth-ira', label: 'Roth IRA' },
  { folder: 'individual/apex', label: 'Individual (Apex era)' },
  { folder: 'tax', label: 'Tax' },
]

/** "roth-ira" → "Roth IRA"; a known folder keeps its name. */
export function statementFolderLabelBlock(folder: string): string {
  const known = STATEMENT_FOLDERS_BLOCK.find(f => f.folder === folder)
  if (known) return known.label
  return folder.split(/[-/]/).map(w => (w.length <= 3 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1))).join(' ')
}

/** Every folder to read: the known ones, then any other account folder found under webull/ (and its apex/). */
export function statementFoldersBlock(webullFolders: string[]): string[] {
  const out = STATEMENT_FOLDERS_BLOCK.map(f => f.folder)
  for (const f of webullFolders) if (!out.includes(f)) out.splice(out.length - 1, 0, f)
  return out
}

export interface StatementAccountBlock {
  folder: StatementFolderBlock
  label: string
  /** YYYY-MM (monthly) or YYYY (tax), oldest first. */
  periods: string[]
  /** Months between the first and the last with no statement. */
  missing: string[]
  /** Statements the CSVs do not mention yet (paths under webull/). */
  waiting: string[]
  /** The last day the CSVs cover for this folder, from webull-statement-periods.csv. */
  coveredTo: string | null
}

const nextMonth = (ym: string) => {
  const [y, m] = ym.split('-').map(Number)
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
}

export function statementAccountsBlock(listing: Record<StatementFolderBlock, string[]>, periodsCsv: string | null): StatementAccountBlock[] {
  // statement column (e.g. "ira/2026-09.pdf") → period_end
  const read = new Map<string, string>()
  const [head, ...rows] = (periodsCsv ?? '').split('\n').filter(l => l.trim())
  const cols = (head ?? '').split(',').map(c => c.trim()) // the CSVs end lines with \r\n
  const s = cols.indexOf('statement'), e = cols.indexOf('period_end')
  for (const r of rows.map(l => l.split(',').map(c => c.trim()))) if (r[s]) read.set(r[s], r[e] ?? '')
  // Known folders first, in their order, then any others found.
  const folders = [...STATEMENT_FOLDERS_BLOCK.map(f => f.folder), ...Object.keys(listing).filter(f => !STATEMENT_FOLDERS_BLOCK.some(k => k.folder === f))]
  return folders.flatMap((folder) => {
    const label = statementFolderLabelBlock(folder)
    const monthly = folder !== 'tax'
    const pattern = monthly ? /^(\d{4}-\d{2})\.pdf$/ : /^(\d{4})\.pdf$/
    const periods = (listing[folder] ?? []).map(f => f.match(pattern)?.[1]).filter((p): p is string => Boolean(p)).sort()
    if (!periods.length) return []
    const missing: string[] = []
    if (monthly) {
      const have = new Set(periods)
      for (let m = periods[0]; m < periods[periods.length - 1]; m = nextMonth(m)) if (!have.has(m)) missing.push(m)
    }
    const paths = periods.map(p => `${folder}/${p}.pdf`)
    const ends = paths.map(p => read.get(p)).filter((d): d is string => Boolean(d)).sort()
    return [{
      folder,
      label,
      periods,
      missing,
      waiting: folder === 'tax' ? [] : paths.filter(p => !read.has(p)),
      coveredTo: ends.length ? ends[ends.length - 1] : null,
    }]
  })
}

/** What to hand an agent so it sorts the inbox and reads the new statements into the CSVs. */
export function statementsAgentPromptBlock(statementsFolder: string, inbox: string[], waiting: string[]): string {
  const parts: string[] = []
  if (inbox.length) parts.push(`New statements were dropped into ${statementsFolder}/inbox: ${inbox.join(', ')}. Sort them into place by the account and period printed in each.`)
  if (waiting.length) parts.push(`Statements filed but not yet in the CSVs: ${waiting.map(w => `webull/${w}`).join(', ')}.`)
  parts.push('Run `thinkspc skill.get --name statements` and follow it (reference scripts come from `thinkspc skill.file --name statements --path <file>`); finish only when `thinkspc skill.validate --name statements` passes.')
  return parts.join(' ')
}

/** One row of the statements table: a statement in the vault, or a month missing between two. */
export interface StatementRowBlock {
  key: string
  folder: StatementFolderBlock
  account: string
  /** YYYY-MM, or YYYY for tax. */
  period: string
  /** Under statements/, null for a missing month. */
  path: string | null
  /** What the CSVs say it covers. */
  start: string | null
  end: string | null
  /** Trades the CSVs took from it. */
  trades: number
  status: 'read' | 'waiting' | 'missing' | 'filed'
}

/** Every statement and every missing month, newest first. */
export function statementRowsBlock(accounts: StatementAccountBlock[], periodsCsv: string | null, tradesCsv: string | null): StatementRowBlock[] {
  const split = (text: string | null) => {
    const [head, ...rows] = (text ?? '').split('\n').filter(l => l.trim())
    return { cols: (head ?? '').split(',').map(c => c.trim()), rows: rows.map(l => l.split(',').map(c => c.trim())) }
  }
  const p = split(periodsCsv)
  const span = new Map<string, { start: string; end: string }>()
  for (const r of p.rows) span.set(r[p.cols.indexOf('statement')], { start: r[p.cols.indexOf('period_start')], end: r[p.cols.indexOf('period_end')] })
  const t = split(tradesCsv)
  const count = new Map<string, number>()
  const ti = t.cols.indexOf('statement')
  for (const r of t.rows) if (r[ti]) count.set(r[ti], (count.get(r[ti]) ?? 0) + 1)
  const rows: StatementRowBlock[] = []
  for (const a of accounts) {
    for (const period of a.periods) {
      const rel = `${a.folder}/${period}.pdf`
      const s = span.get(rel)
      rows.push({
        key: rel, folder: a.folder, account: a.label, period, path: `webull/${rel}`,
        start: s?.start ?? null, end: s?.end ?? null, trades: count.get(rel) ?? 0,
        status: a.folder === 'tax' ? 'filed' : s ? 'read' : 'waiting',
      })
    }
    for (const period of a.missing) rows.push({ key: `missing|${a.folder}|${period}`, folder: a.folder, account: a.label, period, path: null, start: null, end: null, trades: 0, status: 'missing' })
  }
  return rows.sort((x, y) => y.period.localeCompare(x.period) || x.account.localeCompare(y.account))
}
