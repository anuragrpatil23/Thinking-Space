import { defineContractBlock, type ContractOutput } from '../promptContractBlock'
import { s } from '../schemaBlock'

// Stage 2 of the local two-stage range-summary pipeline: given pre-clustered
// arcs (from rangeLabelContract + deterministic clustering), narrate each
// arc into one numbered bullet. The model never has to group, count, or
// aggregate — those are handed to it. Only writes the trailing 1-2 sentence
// narration per bullet.
//
// This split is what makes the range-summary reliable on small local models
// (Qwen 3.6-35B, Qwen 2.5-7B, Gemma). Without it, the narrator drops arcs
// when the count gets big.

export interface RangeNarrateChainInput {
  chainKey: string
  title: string
  /** Chain-digest summary body (numbered bullets). Source material for the
   *  narration sentence — the only content the narrator is allowed to draw
   *  from for the enclosing arc. */
  summary: string
  date: string
  durationMs: number
  msgCount: number
  startedIso: string
  endedIso: string
}

export interface RangeNarrateArcInput {
  themeLabel: string
  sessionCount: number
  /** Human-formatted span, e.g. "across Jun 19 → Jul 2" or "on Jul 2". */
  dateSpan: string
  /** Human-formatted total, e.g. "3h 30m". */
  totalDuration: string
  chains: RangeNarrateChainInput[]
}

export interface RangeNarrateContractInput {
  projectId: string
  projectLabel?: string
  rangeStartDate: string
  rangeEndDate: string
  /** Aggregate stats already computed for the header line. */
  totalChains: number
  totalDuration: string
  uniqueDays: number
  arcs: RangeNarrateArcInput[]
  /** Items that don't get their own arc — rolled into a single "Also worked
   *  on" tail bullet. Each item is (title, date, dur, first-bullet). */
  misc: Array<{ title: string; date: string; duration: string; firstBulletHint: string }>
}

export interface RangeNarrateOutput {
  body: string
}

const MAX_BODY_CHARS = 6000

const SYSTEM_PROMPT = [
  'You narrate a pre-clustered range summary. The hard work — grouping,',
  'counting, timing — is already DONE. Only fill in the narration sentence',
  'for each arc. Do NOT re-group, re-order, split, merge, or reweight.',
  '',
  'You receive a list of ARCs. Each ARC gives you four fields to copy',
  'VERBATIM and one thing to write:',
  '  theme_label     → copy verbatim into `**...**` at the start',
  '  session_count   → copy verbatim as `<N> sessions` (or `<N> session`)',
  '  date_span       → copy verbatim exactly as given',
  '  duration        → copy verbatim inside `**~...**`',
  '  Sessions block  → SOURCE MATERIAL for the narration sentence — the',
  '                    only allowed source.',
  '',
  'Exact bullet shape (fill only the trailing narration):',
  '',
  '  N. **{theme_label}** — {session_count} sessions {date_span}, **~{duration}**.',
  '     {ONE OR TWO SENTENCES drawing ONLY from the Sessions block above.',
  '      Name concrete files, features, companies, decisions from those',
  '      sessions. Use the work-voice — "Landed X", "Fixed Y", "Named Z".}',
  '',
  'If a MISC block appears at the end, add ONE final bullet:',
  '',
  '  N. **Also worked on:** {one short comma-separated line listing what\'s',
  '                          in the MISC block — do not repeat arc content}.',
  '',
  'If NO MISC block is present, do NOT emit an "Also worked on" bullet.',
  'Stop after the last arc.',
  '',
  'HARD RULES:',
  '  - Copy theme_label, session_count, date_span, duration VERBATIM. Do',
  '    not paraphrase, translate, or replace with a session title.',
  '  - Preserve arc order. Bullet 1 = ARC 1, bullet 2 = ARC 2, etc.',
  '  - Narration for arc N draws ONLY from the Sessions block of arc N.',
  '    Never borrow from another arc or invent details.',
  '  - Never "the user" / "the assistant" / "you". Use work-voice.',
  '  - NO preamble. NO trailing meta-notes. NO markdown headings or code',
  '    fences. Just the numbered bullets.',
].join('\n')

function buildUserPromptBlock(input: RangeNarrateContractInput): string {
  const parts: string[] = []
  parts.push(`Project: ${input.projectLabel?.trim() || input.projectId}`)
  parts.push(
    `Range: ${input.rangeStartDate} → ${input.rangeEndDate} · ${input.uniqueDays} day${input.uniqueDays === 1 ? '' : 's'} with activity · ${input.totalChains} chains · ~${input.totalDuration} total`,
  )
  parts.push('')

  input.arcs.forEach((arc, i) => {
    parts.push('---')
    parts.push(`ARC ${i + 1}`)
    parts.push(`theme_label: ${arc.themeLabel}`)
    parts.push(`session_count: ${arc.sessionCount}`)
    parts.push(`date_span: ${arc.dateSpan}`)
    parts.push(`duration: ${arc.totalDuration}`)
    parts.push('')
    parts.push('Sessions in this arc:')
    arc.chains
      .slice()
      .sort((a, b) => b.durationMs - a.durationMs)
      .forEach((c, j) => {
        parts.push(`  ${j + 1}. ${c.title} (${c.date}, ${humanDuration(c.durationMs)})`)
        if (c.summary?.trim()) {
          for (const line of c.summary.trim().split('\n')) parts.push(`     ${line}`)
        }
      })
    parts.push('')
  })

  if (input.misc.length > 0) {
    parts.push('---')
    parts.push('MISC (goes into the "Also worked on" bullet)')
    for (const m of input.misc) {
      parts.push(`  - ${m.title} (${m.date}, ${m.duration}): ${m.firstBulletHint}`)
    }
    parts.push('')
  }

  parts.push('---')
  parts.push('OUTPUT:')
  return parts.join('\n')
}

function humanDuration(ms: number): string {
  const totalMinutes = Math.max(1, Math.round(ms / 60_000))
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
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

export const rangeNarrateContract = defineContractBlock({
  id: 'range-summary-narrate',
  promptVersion: 1,
  outputSchema: s.string({ description: 'Numbered-bullet range summary body' }),
  buildRequest: (input: RangeNarrateContractInput, ctx) => ({
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user' as const, content: buildUserPromptBlock(input) }],
    // Body is ~5-8 bullets, each 1-2 sentences. Bump the floor so long
    // multi-arc ranges don't clip.
    maxTokens: Math.max(ctx.recommendedMaxTokens, 1200),
    temperature: 0.2,
  }),
  finalize: (raw: string, _input: RangeNarrateContractInput): ContractOutput<RangeNarrateOutput> | null => {
    const body = sanitizeBody(raw)
    if (!body) return null
    return { value: { body }, meta: {} }
  },
  cacheKey: (input: RangeNarrateContractInput) => {
    const arcKey = input.arcs
      .map(a => `${a.themeLabel}:${a.sessionCount}:${a.totalDuration}`)
      .join('|')
    return `${input.projectId}#narrate#${input.rangeStartDate}#${input.rangeEndDate}#${arcKey}`
  },
})
