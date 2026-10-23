// Skills: jobs the app hands to the user's own coding agent (Claude Code,
// Codex, anything that can run a shell), through `thinkspc skill.*`. A skill
// is data, not code, in the open Agent Skills shape: `SKILL.md` (frontmatter
// `name` + `description`, then instructions) and reference files the agent
// can read and adapt. Ours add `contract.json`, describing what the finished
// folder must look like. The app never runs the reference files; it only
// checks the result against the contract (`skill.validate`), so whatever the
// agent produced is trusted because it passes the app's own check.
//
// Skills are served by the CLI, never installed: the app does not touch an
// agent's configuration (CLAUDE.md, AGENTS.md, .claude/). The agent finds them
// by running `thinkspc skill.list`, or from a README in the folder the skill
// is about. A user may copy a skill folder into their agent themselves.

export type SkillValueTypeBlock = 'date' | 'month' | 'number' | 'text'

export type SkillRuleBlock =
  /** Every file in the folder matches one of these patterns (paths relative to the folder) */
  | { kind: 'onlyFiles'; label?: string; patterns: string[] }
  /** At least `min` files match the pattern */
  | { kind: 'files'; label?: string; pattern: string; min?: number }
  /** A CSV with exactly these columns, in order; typed columns are checked on every row */
  | { kind: 'csv'; label?: string; file: string; columns: string[]; types?: Record<string, SkillValueTypeBlock>; minRows?: number }
  /** A month column with no month missing between its first and last */
  | { kind: 'monthsContiguous'; label?: string; file: string; column: string }

export interface SkillContractBlock {
  name: string
  title: string
  summary: string
  /** Bumped when the expected shape changes */
  version: number
  /** Vault-relative folder the skill is about */
  folder: string
  rules: SkillRuleBlock[]
}

export interface SkillCheckBlock {
  label: string
  ok: boolean
  detail: string
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/
const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/

/** RFC 4180-ish CSV: quoted fields, doubled quotes, commas and newlines inside quotes. */
export function parseCsvBlock(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i += 1 }
      else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i += 1
      row.push(field); field = ''
      if (row.length > 1 || row[0] !== '') rows.push(row)
      row = []
    } else field += c
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row) }
  return rows
}

function valueOkBlock(type: SkillValueTypeBlock, value: string): boolean {
  if (type === 'text') return true
  if (value === '') return true
  if (type === 'number') return Number.isFinite(Number(value))
  if (type === 'month') return MONTH_RE.test(value)
  return DATE_RE.test(value)
}

function nextMonthBlock(month: string): string {
  const y = Number(month.slice(0, 4))
  const m = Number(month.slice(5, 7))
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
}

/**
 * Check a folder against a contract. `files` are paths relative to the folder;
 * `readText` gives a file's text, or null when it cannot be read.
 */
export function validateSkillFolderBlock(
  contract: SkillContractBlock,
  files: string[],
  readText: (file: string) => string | null,
): SkillCheckBlock[] {
  const checks: SkillCheckBlock[] = []
  const csvCache = new Map<string, string[][] | null>()
  const csvOf = (file: string) => {
    if (!csvCache.has(file)) {
      const text = files.includes(file) ? readText(file) : null
      csvCache.set(file, text === null ? null : parseCsvBlock(text))
    }
    return csvCache.get(file)!
  }

  for (const rule of contract.rules) {
    if (rule.kind === 'onlyFiles') {
      const res = rule.patterns.map(p => new RegExp(p))
      const stray = files.filter(f => !res.some(re => re.test(f)))
      checks.push({
        label: rule.label ?? 'Files are in the expected places',
        ok: stray.length === 0,
        detail: stray.length === 0 ? `${files.length} files` : `Not in the layout: ${stray.slice(0, 8).join(', ')}${stray.length > 8 ? ` and ${stray.length - 8} more` : ''}`,
      })
    } else if (rule.kind === 'files') {
      const re = new RegExp(rule.pattern)
      const count = files.filter(f => re.test(f)).length
      const min = rule.min ?? 1
      checks.push({ label: rule.label ?? rule.pattern, ok: count >= min, detail: count >= min ? `${count} found` : `${count} found, at least ${min} expected` })
    } else if (rule.kind === 'csv') {
      const label = rule.label ?? rule.file
      const rows = csvOf(rule.file)
      if (!rows) {
        checks.push({ label, ok: false, detail: 'Missing' })
        continue
      }
      const [header = [], ...body] = rows
      if (header.join(',') !== rule.columns.join(',')) {
        checks.push({ label, ok: false, detail: `Columns are "${header.join(',')}", expected "${rule.columns.join(',')}"` })
        continue
      }
      const problems: string[] = []
      body.forEach((row, i) => {
        if (row.length !== header.length) problems.push(`row ${i + 2}: ${row.length} fields, expected ${header.length}`)
        for (const [col, type] of Object.entries(rule.types ?? {})) {
          const value = row[header.indexOf(col)] ?? ''
          if (!valueOkBlock(type, value)) problems.push(`row ${i + 2}: ${col} "${value}" is not a ${type}`)
        }
      })
      const minRows = rule.minRows ?? 0
      if (body.length < minRows) problems.push(`${body.length} rows, at least ${minRows} expected`)
      checks.push({
        label,
        ok: problems.length === 0,
        detail: problems.length === 0 ? `${body.length} rows` : `${problems.slice(0, 5).join('; ')}${problems.length > 5 ? ` and ${problems.length - 5} more` : ''}`,
      })
    } else if (rule.kind === 'monthsContiguous') {
      const label = rule.label ?? `${rule.file}: no month missing`
      const rows = csvOf(rule.file)
      const col = rows?.[0]?.indexOf(rule.column) ?? -1
      if (!rows || col < 0) {
        checks.push({ label, ok: false, detail: `No ${rule.column} column in ${rule.file}` })
        continue
      }
      const months = [...new Set(rows.slice(1).map(r => r[col]).filter(m => MONTH_RE.test(m)))].sort()
      const missing: string[] = []
      for (let m = months[0]; m && m < months[months.length - 1]; m = nextMonthBlock(m)) {
        if (!months.includes(m)) missing.push(m)
      }
      checks.push({
        label,
        ok: missing.length === 0,
        detail: missing.length === 0 ? (months.length ? `${months[0]} to ${months[months.length - 1]}` : 'No months') : `Missing ${missing.slice(0, 8).join(', ')}`,
      })
    }
  }
  return checks
}
