// F9 "study record" markdown parser.
// Schema documented in vault: acceleration_core/F9/F9-execution/watchlist/dell-study.md (worked example).

import yaml from 'js-yaml'

export type WebullStudyStatusBlock =
  | 'own-at-right-price'
  | 'restudy-needed'
  | 'too-hard'
  | 'unknown'

export interface WebullStudyRangeBlock {
  low: number
  high: number
  setOn: string | null
  sourceSession: string | null
}

export interface WebullStudyTargetPremiumRangeBlock {
  low: number
  high: number
}

export interface WebullStudyOptionBlock {
  optionType: 'CALL' | 'PUT' | null
  exercisePrice: number | null
  expireDate: string | null
  targetPremiumRange: WebullStudyTargetPremiumRangeBlock | null
  notes: string | null
  raw: Record<string, unknown>
}

export interface WebullStudyRangeHistoryEntryBlock {
  heading: string
  date: string | null
  body: string
}

export interface WebullStudyCommentBlock {
  date: string | null
  text: string
  raw: string
}

export interface WebullStudyRecordBlock {
  filePath: string
  fileName: string
  ticker: string
  // Display name pulled from the study's frontmatter (e.g. "Apple"). Falls
  // back to the ticker symbol upstream when absent.
  company: string | null
  status: WebullStudyStatusBlock
  statusRaw: string | null
  monitor: boolean
  lastUpdated: string | null
  validThrough: string | null
  relatedIu: string | null
  currentRange: WebullStudyRangeBlock | null
  options: WebullStudyOptionBlock[]
  rangeHistory: WebullStudyRangeHistoryEntryBlock[]
  comments: WebullStudyCommentBlock[]
  impQuickNotes: WebullStudyCommentBlock[]
  body: string
  rawFrontmatter: Record<string, unknown>
  parseWarnings: string[]
}

const FM_OPEN_BLOCK = '---'
const FM_CLOSE_RE_BLOCK = /^---\s*$/m

function parseFrontmatterAndBodyBlock(content: string): {
  frontmatter: Record<string, unknown> | null
  body: string
} {
  const trimmed = content.trimStart()
  if (!trimmed.startsWith(FM_OPEN_BLOCK)) {
    return { frontmatter: null, body: content }
  }
  const afterOpen = trimmed.indexOf('\n')
  if (afterOpen === -1) return { frontmatter: null, body: content }
  const rest = trimmed.slice(afterOpen + 1)
  const closeMatch = FM_CLOSE_RE_BLOCK.exec(rest)
  if (!closeMatch) return { frontmatter: null, body: content }
  const yamlStr = rest.slice(0, closeMatch.index)
  const body = rest.slice(closeMatch.index + closeMatch[0].length).replace(/^\n/, '')
  try {
    const loaded = yaml.load(yamlStr)
    if (loaded && typeof loaded === 'object' && !Array.isArray(loaded)) {
      return { frontmatter: loaded as Record<string, unknown>, body }
    }
  } catch {
    // fall through
  }
  return { frontmatter: null, body }
}

function asStringOrNullBlock(value: unknown): string | null {
  // js-yaml reads a bare `2026-12-16` as a Date; dates stay YYYY-MM-DD here.
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10)
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function asNumberOrNullBlock(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value.trim())
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function asBooleanBlock(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase()
    if (v === 'true' || v === 'yes') return true
    if (v === 'false' || v === 'no') return false
  }
  return fallback
}

function asRecordBlock(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function stripWikilinkBlock(value: string | null): string | null {
  if (!value) return null
  // [[some-key]] or [[some-key|label]] → "some-key"
  const match = /^\[\[([^\]|]+)(?:\|[^\]]*)?\]\]$/.exec(value.trim())
  return match ? match[1].trim() : value
}

function mapStatusBlock(raw: string | null): WebullStudyStatusBlock {
  if (!raw) return 'unknown'
  const lowered = raw.toLowerCase()
  if (lowered.includes('own at right price')) return 'own-at-right-price'
  if (lowered.includes('restudy')) return 'restudy-needed'
  if (lowered.includes('too-hard') || lowered.includes('too hard')) return 'too-hard'
  return 'unknown'
}

function parseCurrentRangeBlock(value: unknown): WebullStudyRangeBlock | null {
  const record = asRecordBlock(value)
  if (!record) return null
  const low = asNumberOrNullBlock(record.low)
  const high = asNumberOrNullBlock(record.high)
  if (low === null || high === null) return null
  return {
    low,
    high,
    setOn: asStringOrNullBlock(record.set_on),
    sourceSession: stripWikilinkBlock(asStringOrNullBlock(record.source_session)),
  }
}

function parseOptionsBlock(value: unknown): WebullStudyOptionBlock[] {
  if (!Array.isArray(value)) return []
  const out: WebullStudyOptionBlock[] = []
  for (const entry of value) {
    const record = asRecordBlock(entry)
    if (!record) continue
    const rawType = asStringOrNullBlock(record.option_type) ?? asStringOrNullBlock(record.type)
    const upper = rawType?.toUpperCase() ?? null
    const optionType: 'CALL' | 'PUT' | null =
      upper === 'CALL' || upper === 'PUT' ? upper : null
    const premiumRecord = asRecordBlock(record.target_premium_range)
    let targetPremiumRange: WebullStudyTargetPremiumRangeBlock | null = null
    if (premiumRecord) {
      const low = asNumberOrNullBlock(premiumRecord.low)
      const high = asNumberOrNullBlock(premiumRecord.high)
      if (low !== null && high !== null) targetPremiumRange = { low, high }
    }
    out.push({
      optionType,
      exercisePrice: asNumberOrNullBlock(record.exercise_price ?? record.strike),
      expireDate: asStringOrNullBlock(record.expire_date ?? record.expiration),
      targetPremiumRange,
      notes: asStringOrNullBlock(record.notes),
      raw: record,
    })
  }
  return out
}

const DATE_PREFIX_RE_BLOCK = /^\s*(\d{4}-\d{2}-\d{2})\b/

function parseRangeHistoryBlock(body: string): WebullStudyRangeHistoryEntryBlock[] {
  // Locate the "## Range history" section. The exact-match start anchor avoids
  // mistaking sibling H2s like "## Range history (future updates appended below)"
  // for the section start; the end loop then stops at ANY subsequent H2, so the
  // trailing-marker H2 correctly closes the section.
  const lines = body.split('\n')
  let startIdx = -1
  let endIdx = lines.length
  for (let i = 0; i < lines.length; i++) {
    if (/^##\s+Range history\s*$/i.test(lines[i])) {
      startIdx = i + 1
      for (let j = startIdx; j < lines.length; j++) {
        if (/^##\s+/.test(lines[j])) {
          endIdx = j
          break
        }
      }
      break
    }
  }
  if (startIdx === -1) return []

  const entries: WebullStudyRangeHistoryEntryBlock[] = []
  let currentHeading: string | null = null
  let currentBuffer: string[] = []
  const flush = () => {
    if (currentHeading === null) return
    const dateMatch = DATE_PREFIX_RE_BLOCK.exec(currentHeading)
    entries.push({
      heading: currentHeading.trim(),
      date: dateMatch ? dateMatch[1] : null,
      body: currentBuffer.join('\n').trim(),
    })
    currentHeading = null
    currentBuffer = []
  }
  for (let i = startIdx; i < endIdx; i++) {
    const line = lines[i]
    const subMatch = /^###\s+(.*)$/.exec(line)
    if (subMatch) {
      flush()
      currentHeading = subMatch[1]
      continue
    }
    if (currentHeading === null) continue
    currentBuffer.push(line)
  }
  flush()
  return entries
}

// Match a leading ISO date or date-time prefix on a comment bullet:
//   "2026-05-29 08:14 — text"  →  date=2026-05-29, text="text"
//   "2026-05-29: text"          →  date=2026-05-29, text="text"
//   "text"                      →  date=null,       text="text"
const COMMENT_DATE_PREFIX_RE_BLOCK =
  /^\s*(\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:?\d{2})?)?)\s*(?:[—\-:]\s*)(.*)$/

// Parse a `## <Heading>` section whose body is a list of `- ` / `* ` bullets,
// each optionally prefixed with an ISO date. Shared by Comments and Imp Quick Note.
function parseBulletSectionBlock(body: string, headingRe: RegExp): WebullStudyCommentBlock[] {
  const lines = body.split('\n')
  let startIdx = -1
  let endIdx = lines.length
  for (let i = 0; i < lines.length; i++) {
    if (headingRe.test(lines[i])) {
      startIdx = i + 1
      for (let j = startIdx; j < lines.length; j++) {
        if (/^##\s+/.test(lines[j])) {
          endIdx = j
          break
        }
      }
      break
    }
  }
  if (startIdx === -1) return []

  const out: WebullStudyCommentBlock[] = []
  for (let i = startIdx; i < endIdx; i++) {
    const raw = lines[i]
    const bulletMatch = /^\s*[-*]\s+(.*)$/.exec(raw)
    if (!bulletMatch) continue
    const content = bulletMatch[1].trim()
    if (!content) continue
    const dateMatch = COMMENT_DATE_PREFIX_RE_BLOCK.exec(content)
    if (dateMatch) {
      out.push({
        date: dateMatch[1].trim(),
        text: dateMatch[2].trim(),
        raw,
      })
    } else {
      out.push({ date: null, text: content, raw })
    }
  }
  return out
}

function parseCommentsSectionBlock(body: string): WebullStudyCommentBlock[] {
  return parseBulletSectionBlock(body, /^##\s+Comments\s*$/i)
}

// Accepts "Imp Quick Note", "Important Quick Note", optional trailing "s".
function parseImpQuickNoteSectionBlock(body: string): WebullStudyCommentBlock[] {
  return parseBulletSectionBlock(body, /^##\s+(?:Imp|Important)\s+Quick\s+Notes?\s*$/i)
}

export function parseWebullStudyRecordBlock(input: {
  filePath: string
  fileName: string
  content: string
}): WebullStudyRecordBlock | null {
  const { filePath, fileName, content } = input
  const { frontmatter, body } = parseFrontmatterAndBodyBlock(content)
  const warnings: string[] = []

  if (!frontmatter) {
    return null
  }

  const ticker = asStringOrNullBlock(frontmatter.ticker)
  if (!ticker) {
    warnings.push('missing ticker in frontmatter')
    return null
  }

  const statusRaw = asStringOrNullBlock(frontmatter.status)
  const status = mapStatusBlock(statusRaw)
  if (status === 'unknown' && statusRaw) {
    warnings.push(`unrecognized status: "${statusRaw}"`)
  }

  const currentRange = parseCurrentRangeBlock(frontmatter.current_range)
  if (frontmatter.current_range && !currentRange) {
    warnings.push('current_range present but low/high could not be parsed as numbers')
  }

  return {
    filePath,
    fileName,
    ticker: ticker.toUpperCase(),
    company: asStringOrNullBlock(frontmatter.company),
    status,
    statusRaw,
    monitor: asBooleanBlock(frontmatter.monitor, false),
    lastUpdated: asStringOrNullBlock(frontmatter.last_updated),
    validThrough: asStringOrNullBlock(frontmatter.valid_through),
    relatedIu: stripWikilinkBlock(asStringOrNullBlock(frontmatter.related_iu)),
    currentRange,
    options: parseOptionsBlock(frontmatter.options),
    rangeHistory: parseRangeHistoryBlock(body),
    comments: parseCommentsSectionBlock(body),
    impQuickNotes: parseImpQuickNoteSectionBlock(body),
    body,
    rawFrontmatter: frontmatter,
    parseWarnings: warnings,
  }
}
