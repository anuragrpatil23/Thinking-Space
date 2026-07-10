// F9 "sim" data parsers + timeline model.
//
// Source of truth lives in the vault under
//   acceleration_core/F9/AI Synthesis/f9-sim/
// with three shapes (see kai-workspace/F9/f9-sim-tab-build-spec.md):
//   1. cases/<company-slug>/<company-slug>-<mon>-YYYY.md  — one case per file (YAML frontmatter)
//   2. eras.yaml                                          — labeled market/history eras
//   3. bench.md                                           — markdown table of candidate cases
//
// This module is read-only: it never writes any of these files (the vault side
// owns them). It only parses frontmatter/tables into a timeline view-model.

import yaml from 'js-yaml'
import type { ChipColorBlock } from '@/services/lego_blocks/units/chipColorBlock'

export type WebullSimStatusBlock =
  | 'case-staged'
  | 'response-written'
  | 'revealed'
  | 'post-mortem-done'
  | 'unknown'

export type WebullSimRepTypeBlock = 'case' | 'quarter-walk' | 'pair'

/** A single staged rep (case or quarter-walk) parsed from a case file. */
export interface WebullSimCaseBlock {
  filePath: string
  /** Lane key — the company folder slug (e.g. "xerox"). */
  companySlug: string
  /** Display name from the `company` frontmatter field; falls back to the slug. */
  company: string
  status: WebullSimStatusBlock
  statusRaw: string | null
  /** Machine-readable position, YYYY-MM. */
  momentDate: string
  /** Fractional year for timeline positioning (e.g. 1961-10 → 1961.75). */
  momentYear: number
  /** Human-readable label for tooltips (from `moment`, falls back to momentDate). */
  momentLabel: string
  era: string | null
  repType: WebullSimRepTypeBlock
  /** quarter-walk only — end of the walked span (YYYY-MM). */
  spanEnd: string | null
  /** Fractional year for the span end, when present. */
  spanEndYear: number | null
  caseId: string | null
}

/** A bench candidate — not yet staged. Rendered as a hollow mark. */
export interface WebullSimBenchEntryBlock {
  companySlug: string
  company: string
  momentDate: string
  momentYear: number
  era: string | null
  why: string
}

/** An era band segment. `end: null` means "to present". */
export interface WebullSimEraBlock {
  slug: string
  label: string
  start: number
  end: number | null
}

const FM_OPEN_BLOCK = '---'
const FM_CLOSE_RE_BLOCK = /^---\s*$/m

function parseFrontmatterBlock(content: string): Record<string, unknown> | null {
  const trimmed = content.trimStart()
  if (!trimmed.startsWith(FM_OPEN_BLOCK)) return null
  const afterOpen = trimmed.indexOf('\n')
  if (afterOpen === -1) return null
  const rest = trimmed.slice(afterOpen + 1)
  const closeMatch = FM_CLOSE_RE_BLOCK.exec(rest)
  if (!closeMatch) return null
  const yamlStr = rest.slice(0, closeMatch.index)
  try {
    const loaded = yaml.load(yamlStr)
    if (loaded && typeof loaded === 'object' && !Array.isArray(loaded)) {
      return loaded as Record<string, unknown>
    }
  } catch {
    // fall through
  }
  return null
}

function asStringOrNullBlock(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

// YAML may hand back a YYYY-MM value as a plain string, but a full YYYY-MM-DD
// would parse to a Date. Normalize any of those into a "YYYY-MM" string.
function asMomentStringBlock(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const year = value.getUTCFullYear()
    const month = String(value.getUTCMonth() + 1).padStart(2, '0')
    return `${year}-${month}`
  }
  const raw = asStringOrNullBlock(value)
  if (!raw) return null
  const match = /^(\d{4})-(\d{1,2})/.exec(raw)
  if (!match) return null
  return `${match[1]}-${match[2].padStart(2, '0')}`
}

/** Fractional year for a YYYY-MM string (1961-10 → 1961 + 9/12 ≈ 1961.75). */
export function momentDateToYearFractionBlock(momentDate: string | null): number | null {
  if (!momentDate) return null
  const match = /^(\d{4})-(\d{1,2})/.exec(momentDate)
  if (!match) return null
  const year = Number(match[1])
  const month = Math.min(12, Math.max(1, Number(match[2])))
  if (!Number.isFinite(year)) return null
  return year + (month - 1) / 12
}

function mapRepTypeBlock(value: unknown): WebullSimRepTypeBlock {
  const raw = asStringOrNullBlock(value)?.toLowerCase()
  if (raw === 'quarter-walk') return 'quarter-walk'
  if (raw === 'pair') return 'pair'
  return 'case'
}

const SIM_STATUSES_BLOCK: readonly WebullSimStatusBlock[] = [
  'case-staged',
  'response-written',
  'revealed',
  'post-mortem-done',
]

function mapStatusBlock(value: unknown): { status: WebullSimStatusBlock; raw: string | null } {
  const raw = asStringOrNullBlock(value)
  if (!raw) return { status: 'unknown', raw: null }
  const normalized = raw.toLowerCase()
  if ((SIM_STATUSES_BLOCK as readonly string[]).includes(normalized)) {
    return { status: normalized as WebullSimStatusBlock, raw }
  }
  return { status: 'unknown', raw }
}

// Case file names to skip when walking the cases/ tree (per the build spec):
//   *-patterns.md  — per-company cross-case notes, not reps
//   pair-*.md      — paired-rep choice files at the cases/ root
export function isSimNonRepFileNameBlock(fileName: string): boolean {
  const lower = fileName.toLowerCase()
  if (!lower.endsWith('.md')) return true
  if (lower.endsWith('-patterns.md')) return true
  if (lower.startsWith('pair-')) return true
  return false
}

export function parseWebullSimCaseBlock(input: {
  filePath: string
  companySlug: string
  content: string
}): WebullSimCaseBlock | null {
  const frontmatter = parseFrontmatterBlock(input.content)
  if (!frontmatter) return null

  const momentDate = asMomentStringBlock(frontmatter.moment_date)
  if (!momentDate) return null
  const momentYear = momentDateToYearFractionBlock(momentDate)
  if (momentYear === null) return null

  const repType = mapRepTypeBlock(frontmatter.rep_type)
  // `pair` files are the paired-choice wrappers, not point-in-time reps; the
  // scan already skips `pair-*` filenames, but guard the frontmatter too.
  if (repType === 'pair') return null

  const { status, raw: statusRaw } = mapStatusBlock(frontmatter.status)
  const spanEnd = repType === 'quarter-walk' ? asMomentStringBlock(frontmatter.span_end) : null
  const company = asStringOrNullBlock(frontmatter.company) ?? input.companySlug

  return {
    filePath: input.filePath,
    companySlug: input.companySlug,
    company,
    status,
    statusRaw,
    momentDate,
    momentYear,
    momentLabel: asStringOrNullBlock(frontmatter.moment) ?? momentDate,
    era: asStringOrNullBlock(frontmatter.era),
    repType,
    spanEnd,
    spanEndYear: momentDateToYearFractionBlock(spanEnd),
    caseId: asStringOrNullBlock(frontmatter.case_id),
  }
}

export function parseWebullSimErasBlock(content: string): WebullSimEraBlock[] {
  let loaded: unknown
  try {
    loaded = yaml.load(content)
  } catch {
    return []
  }
  const list = (loaded && typeof loaded === 'object' && !Array.isArray(loaded)
    ? (loaded as Record<string, unknown>).eras
    : loaded)
  if (!Array.isArray(list)) return []
  const out: WebullSimEraBlock[] = []
  for (const entry of list) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const record = entry as Record<string, unknown>
    const slug = asStringOrNullBlock(record.slug)
    const label = asStringOrNullBlock(record.label)
    const start = typeof record.start === 'number' ? record.start : Number(asStringOrNullBlock(record.start))
    if (!slug || !label || !Number.isFinite(start)) continue
    const endRaw = record.end
    const end = endRaw === null || endRaw === undefined || endRaw === ''
      ? null
      : (typeof endRaw === 'number' ? endRaw : Number(asStringOrNullBlock(endRaw)))
    out.push({
      slug,
      label,
      start,
      end: end !== null && Number.isFinite(end) ? end : null,
    })
  }
  return out
}

// Parse the bench.md GitHub-flavored table with columns: company | moment | era | why.
export function parseWebullSimBenchBlock(content: string): WebullSimBenchEntryBlock[] {
  const lines = content.split('\n')
  const out: WebullSimBenchEntryBlock[] = []
  let inTable = false
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('|')) {
      // A blank/non-pipe line ends the current table; a later table can restart.
      if (inTable && trimmed.length === 0) inTable = false
      continue
    }
    const cells = trimmed
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((cell) => cell.trim())
    if (cells.length < 4) continue
    const [companyCell, momentCell, eraCell, ...whyCells] = cells
    const lowerCompany = companyCell.toLowerCase()
    // Skip the header row and its `---` separator.
    if (lowerCompany === 'company') {
      inTable = true
      continue
    }
    if (/^:?-{2,}:?$/.test(companyCell)) continue
    const momentDate = asMomentStringBlock(momentCell)
    const momentYear = momentDateToYearFractionBlock(momentDate)
    if (!momentDate || momentYear === null) continue
    const companySlug = companyCell.toLowerCase()
    out.push({
      companySlug,
      company: companyCell,
      momentDate,
      momentYear,
      era: eraCell || null,
      why: whyCells.join('|').trim(),
    })
  }
  return out
}

// ── Timeline view-model ───────────────────────────────────────────────────

export interface WebullSimLaneMarkBlock {
  key: string
  kind: 'case' | 'quarter-walk' | 'bench'
  status: WebullSimStatusBlock | 'bench'
  company: string
  momentLabel: string
  momentYear: number
  spanEndYear: number | null
  era: string | null
  /** Present for real case files; bench marks have no file to open. */
  filePath: string | null
  /** Tooltip line — bench uses the `why`; cases use their status. */
  detail: string
}

export interface WebullSimLaneBlock {
  companySlug: string
  company: string
  marks: WebullSimLaneMarkBlock[]
}

export interface WebullSimStatusCountsBlock {
  staged: number
  responseWritten: number
  revealed: number
  postMortemDone: number
}

export interface WebullSimTimelineModelBlock {
  lanes: WebullSimLaneBlock[]
  eras: WebullSimEraBlock[]
  /** Inclusive timeline domain in whole years. */
  minYear: number
  maxYear: number
  totalReps: number
  benchSize: number
  counts: WebullSimStatusCountsBlock
}

/** Progression palette — staged reads as neutral, post-mortem as "done" green. */
export const SIM_STATUS_CHIP_COLOR_BLOCK: Record<WebullSimStatusBlock | 'bench', ChipColorBlock> = {
  'case-staged': 'slate',
  'response-written': 'amber',
  revealed: 'sky',
  'post-mortem-done': 'emerald',
  unknown: 'zinc',
  bench: 'zinc',
}

export const SIM_STATUS_LABEL_BLOCK: Record<WebullSimStatusBlock | 'bench', string> = {
  'case-staged': 'Staged',
  'response-written': 'Response written',
  revealed: 'Revealed',
  'post-mortem-done': 'Post-mortem done',
  unknown: 'Unknown',
  bench: 'Bench',
}

const PRESENT_PADDING_YEARS_BLOCK = 2

export function buildWebullSimTimelineModelBlock(input: {
  cases: WebullSimCaseBlock[]
  bench: WebullSimBenchEntryBlock[]
  eras: WebullSimEraBlock[]
}): WebullSimTimelineModelBlock {
  const { cases, bench, eras } = input
  const currentYear = new Date().getFullYear()

  // Domain: span the eras and every plotted mark, with a little breathing room
  // toward the present so the newest era block isn't jammed against the edge.
  const years: number[] = []
  for (const era of eras) {
    years.push(era.start)
    years.push(era.end ?? currentYear)
  }
  for (const c of cases) {
    years.push(Math.floor(c.momentYear))
    if (c.spanEndYear !== null) years.push(Math.ceil(c.spanEndYear))
  }
  for (const b of bench) years.push(Math.floor(b.momentYear))

  const minYear = years.length > 0 ? Math.min(...years) : 1920
  const maxYear = Math.max(currentYear + PRESENT_PADDING_YEARS_BLOCK, years.length > 0 ? Math.max(...years) : currentYear)

  // Group cases + bench into lanes keyed by company slug. Company display name
  // prefers a case's `company` field, then a bench company label, then the slug.
  const laneMap = new Map<string, WebullSimLaneBlock>()
  const ensureLane = (companySlug: string, company: string): WebullSimLaneBlock => {
    const existing = laneMap.get(companySlug)
    if (existing) {
      if ((existing.company === existing.companySlug) && company !== companySlug) {
        existing.company = company
      }
      return existing
    }
    const lane: WebullSimLaneBlock = { companySlug, company, marks: [] }
    laneMap.set(companySlug, lane)
    return lane
  }

  const counts: WebullSimStatusCountsBlock = {
    staged: 0,
    responseWritten: 0,
    revealed: 0,
    postMortemDone: 0,
  }

  for (const c of cases) {
    const lane = ensureLane(c.companySlug, c.company)
    lane.marks.push({
      key: c.filePath,
      kind: c.repType === 'quarter-walk' ? 'quarter-walk' : 'case',
      status: c.status,
      company: c.company,
      momentLabel: c.momentLabel,
      momentYear: c.momentYear,
      spanEndYear: c.spanEndYear,
      era: c.era,
      filePath: c.filePath,
      detail: SIM_STATUS_LABEL_BLOCK[c.status],
    })
    if (c.status === 'case-staged') counts.staged += 1
    else if (c.status === 'response-written') counts.responseWritten += 1
    else if (c.status === 'revealed') counts.revealed += 1
    else if (c.status === 'post-mortem-done') counts.postMortemDone += 1
  }

  for (const b of bench) {
    const lane = ensureLane(b.companySlug, b.company)
    lane.marks.push({
      key: `bench-${b.companySlug}-${b.momentDate}`,
      kind: 'bench',
      status: 'bench',
      company: b.company,
      momentLabel: b.momentDate,
      momentYear: b.momentYear,
      spanEndYear: null,
      era: b.era,
      filePath: null,
      detail: b.why || 'Bench candidate',
    })
  }

  const lanes = [...laneMap.values()].sort((a, b) => a.company.localeCompare(b.company))
  for (const lane of lanes) {
    lane.marks.sort((a, b) => a.momentYear - b.momentYear)
  }

  return {
    lanes,
    eras: [...eras].sort((a, b) => a.start - b.start),
    minYear,
    maxYear,
    totalReps: cases.length,
    benchSize: bench.length,
    counts,
  }
}
