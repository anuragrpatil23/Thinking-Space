// The Webull statements in the vault, as the statements skill lays them out
// under <executionRoot>/statements/webull/: individual/YYYY-MM.pdf (older
// Apex-era ones in individual/apex/), ira/YYYY-MM.pdf, tax/YYYY.pdf.
//
// Thinking Space files a statement and shows what is there; it never reads a
// PDF. An agent turns them into the webull-*.csv files (`thinkspc skill.get
// --name statements`), so a PDF the CSVs do not mention yet is "waiting to be
// read".

export type StatementFolderBlock = 'individual' | 'individual/apex' | 'ira' | 'tax'

export const STATEMENT_FOLDERS_BLOCK: Array<{ folder: StatementFolderBlock; label: string; monthly: boolean }> = [
  { folder: 'individual', label: 'Individual', monthly: true },
  { folder: 'ira', label: 'IRA', monthly: true },
  { folder: 'individual/apex', label: 'Individual (Apex era)', monthly: true },
  { folder: 'tax', label: 'Tax', monthly: false },
]

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
  return STATEMENT_FOLDERS_BLOCK.flatMap(({ folder, label, monthly }) => {
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

/** The month a new statement for this folder most likely covers: the one after its latest. */
export function nextStatementPeriodBlock(account: StatementAccountBlock | undefined, today = new Date()): string {
  const last = account?.periods[account.periods.length - 1]
  if (last && account?.folder === 'tax') return String(Number(last) + 1)
  if (last) return nextMonth(last)
  const d = new Date(today.getFullYear(), today.getMonth() - 1, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** Where the skill expects it, under statements/. */
export function statementPathBlock(folder: StatementFolderBlock, period: string): string {
  return `webull/${folder}/${period}.pdf`
}

/** What to hand an agent so it reads the waiting statements into the CSVs. */
export function statementsAgentPromptBlock(statementsFolder: string, waiting: string[]): string {
  return [
    `New Webull statements are in ${statementsFolder}: ${waiting.length ? waiting.map(w => `webull/${w}`).join(', ') : '(none listed)'}.`,
    'Read them into the CSVs there: run `thinkspc skill.get --name statements`, follow it (reference scripts come from `thinkspc skill.file --name statements --path <file>`),',
    'and finish only when `thinkspc skill.validate --name statements` passes.',
  ].join(' ')
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
