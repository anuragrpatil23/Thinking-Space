import { defineContractBlock, type ContractOutput } from '../promptContractBlock'
import { s } from '../schemaBlock'

// Top-level narrator for the decomposed-range path. Given a chronological
// list of pre-summarized SUBUNITs (months, weeks, or days — each already
// carries a narrated body from its own tier), compose one range-level
// narrative body. The lower tiers have already done grouping/counting and
// the narration of arcs inside them; this layer just distills each subunit
// into one bullet keyed by its natural label ("Aug 2026", "Week of Aug 4",
// "Aug 12") so the reader can scan the range at a glance.
//
// Reused for two callers:
//   - month summary path: subunits are the 4-ish weekly bodies inside a
//     calendar month.
//   - decomposed arbitrary-range path: subunits are the mix of month/week/
//     day bodies emitted by decomposeRangeIntoSubunitsBlock.

export type SubunitKind = 'month' | 'week' | 'day'

export interface SubunitInput {
  kind: SubunitKind
  /** Natural label — "Aug 2026" / "Week of Aug 4" / "Aug 12". */
  label: string
  /** Human dateSpan — e.g. "Aug 1 → Aug 31" or "on Aug 12". */
  dateSpan: string
  /** Human total duration inside the subunit — "12h 30m". */
  duration: string
  /** Chain count inside the subunit. */
  chainCount: number
  /** Pre-narrated body from the subunit's own tier. Empty string is legal
   *  (means the lower tier had no activity or emitted a stub). */
  body: string
}

export interface SubunitComposeContractInput {
  projectId: string
  projectLabel?: string
  rangeStartDate: string
  rangeEndDate: string
  totalChains: number
  totalDuration: string
  uniqueDays: number
  subunits: SubunitInput[]
}

export interface SubunitComposeOutput {
  body: string
}

const MAX_BODY_CHARS = 6000

const SYSTEM_PROMPT = [
  'You compose one range-level narrative from a list of pre-summarized',
  'SUBUNITs (months, weeks, or days). Each subunit already has a narrated',
  'body — your only job is to distill it into a single bullet keyed by the',
  'subunit label.',
  '',
  'COUNT INVARIANT — the single most important rule:',
  '  - You will receive exactly N SUBUNITs. Emit exactly N bullets.',
  '  - N is given verbatim as "Expected output: N bullets" in the user',
  '    message. Match it. If N=1, output 1 bullet. If N=2, output 2.',
  '  - NEVER invent an extra bullet to "match a template". The template',
  '    below is a per-item shape, not a sample count.',
  '',
  'TEMPLATE — apply this shape to EACH SUBUNIT you receive:',
  '',
  '  <index>. **{label}** — {chain_count} sessions {date_span}, **~{duration}**.',
  '     {ONE OR TWO SENTENCES drawing ONLY from the Body of that subunit.',
  '      Name the biggest concrete arcs from that body — files, features,',
  '      decisions. Work-voice — "Landed X", "Wrapped Y".}',
  '',
  'Number sequentially starting at 1. Bullet 1 = SUBUNIT 1. Bullet 2 =',
  'SUBUNIT 2. Etc. Stop after the last subunit.',
  '',
  'HARD RULES:',
  '  - Copy label, chain_count, date_span, duration VERBATIM.',
  '  - Preserve subunit order.',
  '  - Narration for subunit N draws ONLY from the Body of subunit N.',
  '  - If a subunit body is empty, emit a bullet with "No highlights" as',
  '    the narration — do not invent content.',
  '  - Never "the user" / "the assistant" / "you". Work-voice only.',
  '  - NO preamble. NO trailing notes. NO markdown headings or code fences.',
  '    Just the numbered bullets.',
].join('\n')

function buildUserPromptBlock(input: SubunitComposeContractInput): string {
  const parts: string[] = []
  parts.push(`Project: ${input.projectLabel?.trim() || input.projectId}`)
  parts.push(
    `Range: ${input.rangeStartDate} → ${input.rangeEndDate} · ${input.uniqueDays} day${input.uniqueDays === 1 ? '' : 's'} with activity · ${input.totalChains} chains · ~${input.totalDuration} total`,
  )
  parts.push(
    `Expected output: ${input.subunits.length} bullet${input.subunits.length === 1 ? '' : 's'} (one per SUBUNIT below).`,
  )
  parts.push('')

  input.subunits.forEach((sub, i) => {
    parts.push('---')
    parts.push(`SUBUNIT ${i + 1} (${sub.kind})`)
    parts.push(`label: ${sub.label}`)
    parts.push(`chain_count: ${sub.chainCount}`)
    parts.push(`date_span: ${sub.dateSpan}`)
    parts.push(`duration: ${sub.duration}`)
    parts.push('')
    parts.push('Body:')
    const body = sub.body?.trim()
    if (body) {
      for (const line of body.split('\n')) parts.push(`  ${line}`)
    } else {
      parts.push('  (empty)')
    }
    parts.push('')
  })

  parts.push('---')
  parts.push('OUTPUT:')
  return parts.join('\n')
}

function truncateAtWord(value: string, max: number): string {
  if (value.length <= max) return value
  const cut = value.slice(0, max)
  const lastSpace = cut.lastIndexOf(' ')
  const base = lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut
  return `${base.trimEnd()}…`
}

function sanitizeBody(raw: string): string {
  const stripped = raw.replace(/^```(?:markdown|md)?\s*/i, '').replace(/```\s*$/i, '').trim()
  const lines = stripped.split('\n')
  let firstBullet = -1
  for (let i = 0; i < lines.length; i += 1) {
    if (/^\s*1\.\s/.test(lines[i])) { firstBullet = i; break }
  }
  const body = firstBullet >= 0 ? lines.slice(firstBullet).join('\n') : stripped
  return truncateAtWord(body.replace(/\n{3,}/g, '\n\n').trim(), MAX_BODY_CHARS)
}

export const SUBUNIT_COMPOSE_PROMPT_VERSION = 2

export const subunitComposeContract = defineContractBlock({
  id: 'range-summary-subunit-compose',
  promptVersion: SUBUNIT_COMPOSE_PROMPT_VERSION,
  outputSchema: s.string({ description: 'Numbered-bullet subunit compose body' }),
  buildRequest: (input: SubunitComposeContractInput) => ({
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user' as const, content: buildUserPromptBlock(input) }],
    // One bullet per subunit — a 3-month decomposed range may have 3 month
    // bullets + a handful of edge weeks/days. Bump the floor so nothing clips.
    temperature: 0.2,
  }),
  finalize: (raw: string, _input: SubunitComposeContractInput): ContractOutput<SubunitComposeOutput> | null => {
    const body = sanitizeBody(raw)
    if (!body) return null
    return { value: { body }, meta: {} }
  },
  cacheKey: (input: SubunitComposeContractInput) => {
    const subKey = input.subunits
      .map(s => `${s.kind}:${s.label}:${s.chainCount}:${s.duration}`)
      .join('|')
    return `${input.projectId}#compose#${input.rangeStartDate}#${input.rangeEndDate}#${subKey}`
  },
})
