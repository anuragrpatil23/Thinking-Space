import { defineContractBlock, type ContractOutput } from '../promptContractBlock'
import { s } from '../schemaBlock'

// Contract that composes chain-level digests across a date range into a
// project range summary — a numbered list of arcs ordered by wall-clock
// time spent, with a tail bullet for cross-cutting small work.
//
// Output is delimited plain text (numbered bullets), same reasoning as the
// chain-digest and day-atom contracts: small local models (Qwen, Gemma,
// Llama-3-8B) reliably follow labeled/numbered layouts but stumble on JSON.
//
// This is a *range* summary, not a day summary. The atom-level HEADLINE +
// WHY shape is the wrong unit for a multi-day view — it collapses within-day
// themes so aggressively that the model can't find the "3 sessions over 2
// days on the same feature" arcs that make a range readable. So we feed
// chain digests directly and let the model group them itself.

const MAX_ARCS = 8
const MAX_BULLET_CHARS = 700

export interface RangeSummaryChainInput {
  chainKey: string
  /** Local calendar date (YYYY-MM-DD) the chain is bucketed into. */
  date: string
  /** ISO start/end for the wall-clock spans the model reasons about. */
  startedIso: string
  endedIso: string
  /** Chain digest title + numbered-bullet summary — the ChainDigestOutput
   *  shape produced by the chain-digest contract. */
  title: string
  summary: string
  durationMs: number
  msgCount: number
}

export interface RangeSummaryContractInput {
  projectId: string
  /** Human-facing project label if the raw projectId is a path. */
  projectLabel?: string
  /** Inclusive local dates (YYYY-MM-DD) of the range shown to the user. */
  rangeStartDate: string
  rangeEndDate: string
  /** All chain digests in-range for this project. Order doesn't matter —
   *  the contract sorts them for the model. */
  chains: RangeSummaryChainInput[]
}

export interface RangeSummaryOutput {
  /** Full numbered-bullet body, already parsed / sanitized. Callers render
   *  this as markdown. Not split into structured arcs because the tail
   *  bullets (bug counts, feature counts, "also worked on") don't share
   *  a shape with the arcs, and forcing structure would just make the
   *  parser fragile against small local-model output variance. */
  body: string
}

const SYSTEM_PROMPT = [
  'You summarize a range of AI-assisted project work — usually a week or two,',
  'sometimes a month — as a short list of ARCS ordered by time spent. Time',
  'is the honest importance signal: an arc that ate three hours over two',
  'days matters more than one that took twenty minutes, regardless of how',
  'interesting either topic sounds.',
  '',
  'INPUT: aggregate stats for the range, then per-chain sections in',
  'descending duration. Each chain section starts with a metadata line',
  '(`date · started HH:MM-HH:MM · Nmsgs · Xm`) followed by the chain\'s',
  'title and numbered-bullet summary from the chain-digest step.',
  '',
  'OUTPUT FORMAT (strict): numbered bullets `1.` `2.` `3.` etc, one per',
  'line-start (bullet body may span multiple lines). Each ARC bullet',
  'follows this shape:',
  '',
  '  N. **<theme>** — <M sessions> across <date range>, **~Xh Ym** (raw',
  '     durations shown compactly). <One or two sentences on what the arc',
  '     was actually about, naming concrete files/companies/decisions.>',
  '',
  'Rank arcs by total time DESCENDING. After the arcs, add tail bullets',
  '(also numbered, continuing the sequence) in this fixed order:',
  '',
  '  - one bullet counting bugs fixed across the range (with rough combined',
  '    time if you can estimate it),',
  '  - one bullet counting features/artifacts shipped or filed,',
  '  - a final "**Also worked on:**" bullet for small cross-cutting items',
  '    that don\'t deserve their own arc (blocked/deferred work, one-off',
  '    experiments, tangents). Small-scale outcome-less sessions belong',
  '    here regardless of topic.',
  '',
  'Example (payments-system engineering range):',
  '  Range: 2026-04-08 → 2026-04-21 · 11 chains · ~8h 40m',
  '',
  '  1. **Stripe → Adyen migration** — 4 sessions across Apr 8 → Apr 15,',
  '     **~3h 30m**. New charge/refund endpoints wired, webhook signature',
  '     verification ported, backwards-compat shim for the two callers',
  '     still on Stripe. Rollout gated on `PAYMENTS_ADYEN_ENABLED`.',
  '  2. **Idempotency-key rework** — 3 sessions across Apr 10 → Apr 18,',
  '     **~2h 15m**. Moved from request-ID to hash-of-body, storage swapped',
  '     to Redis with 24h TTL, replay-safety proof added to the docs page.',
  '  3. **Payment-failure taxonomy** — 2 sessions on Apr 12, **~1h 20m**.',
  '     Named 6 canonical failure modes, wired the mapping table, dashboards',
  '     updated.',
  '  4. **~5 bug fixes** across the range, **~40m combined**: null refund',
  '     amount, webhook duplicate-delivery race, currency-code casing,',
  '     timeout-on-retry-loop, config-load ordering.',
  '  5. **~3 features shipped**: Adyen provider adapter, hash-based',
  '     idempotency, failure taxonomy dashboard.',
  '  6. **Also worked on:** dead-code cleanup in the old Stripe adapter',
  '     (deferred until flag flip), one-off refund for a stuck test-mode',
  '     payment, brief spike on tokenization vs. hosted-fields for the',
  '     mobile SDK (parked).',
  '',
  'Example (semiconductor-study range):',
  '  Range: 2026-05-06 → 2026-05-19 · 7 chains · ~5h 45m',
  '',
  '  1. **TSMC capacity + 2nm ramp** — 3 sessions across May 6 → May 14,',
  '     **~2h 40m**. Wafer-capacity numbers pulled from two earnings calls,',
  '     Q3 planning note landed at `Semiconductor/Foundry/TSMC/tsmc-capacity.md`',
  '     with three named risks. Arizona ramp timing flagged as the biggest',
  '     open question.',
  '  2. **Applied Materials margin analysis** — 2 sessions on May 12,',
  '     **~1h 40m**. Historical operating margins bucketed by tool category,',
  '     gross-vs-op divergence traced to services mix.',
  '  3. **Advanced packaging deep-dive** — 1 session on May 17, **~50m**.',
  '     CoWoS vs HBM3E named as the binding constraint on AI-accelerator',
  '     throughput in 2026.',
  '  4. **~2 study records + 3 concept notes** filed under `Semiconductor/`.',
  '  5. **2 durable frameworks** named: *structural-floor-vs-cyclical-premium*',
  '     (extended from an earlier NVDA note), *tool-category margin dispersion*.',
  '  6. **Also worked on:** brief revisit of ASML lithography roadmap',
  '     (folded into TSMC note), quick note on Micron\'s HBM3E supply',
  '     guidance during the AMAT session.',
  '',
  'RULES:',
  '  - NO preamble ("Here is the summary"). NO trailing meta-notes.',
  '    NO markdown headings or code fences. Just numbered bullets.',
  '  - Rank arcs by total time DESCENDING. Small-scale items merge into',
  '    the "Also worked on" tail bullet regardless of topic or outcome.',
  '    Outcome does NOT demote — a one-hour blocked session is a real arc.',
  '  - Group chains into themes ACROSS days. Do NOT list chains one-per-',
  '    bullet; the whole point of the summary is theme detection.',
  '  - When a theme spans multiple days, say so ("3 sessions across Jun 10',
  '     → Jun 14"). When it\'s one day, say the date once.',
  '  - Concrete nouns: name the feature, file, company, decision. Avoid',
  '    generic words like "improvements", "changes", "some work".',
  '  - Use the work-voice: "Landed X", "Fixed Y", "Named Z", "Deferred W".',
  '    Never "the user" / "the assistant" / "you".',
  '  - Bug/feature counts are approximate — round to nearest sensible',
  '    number. If the range has neither, drop those bullets.',
  '  - If the range is truly empty (no signal), write one bullet: "1. Quiet',
  '    range — no substantive activity." and stop.',
].join('\n')

function truncateAtWord(value: string, max: number): string {
  if (value.length <= max) return value
  const cut = value.slice(0, max)
  const lastSpace = cut.lastIndexOf(' ')
  const base = lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut
  return `${base.trimEnd()}…`
}

// Compact duration formatter: "2h 15m", "45m", "3h", never "0h 45m".
export function formatDurationMinutesBlock(ms: number): string {
  const totalMinutes = Math.max(1, Math.round(ms / 60_000))
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

function fmtClock(iso: string): string {
  const d = new Date(iso)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

function formatChainSectionBlock(
  chain: RangeSummaryChainInput,
  idx: number,
): string {
  const dur = formatDurationMinutesBlock(chain.durationMs)
  const meta = `${chain.date} · ${fmtClock(chain.startedIso)}–${fmtClock(chain.endedIso)} · ${chain.msgCount} msgs · ${dur}`
  const lines: string[] = [`### Session ${idx + 1} — ${chain.title}`, `_${meta}_`]
  const summary = chain.summary?.trim()
  if (summary) {
    lines.push('')
    lines.push(summary)
  }
  return lines.join('\n')
}

function computeAggregateBlock(input: RangeSummaryContractInput): string {
  const totalMs = input.chains.reduce((n, c) => n + c.durationMs, 0)
  const uniqueDays = new Set(input.chains.map(c => c.date)).size
  return [
    `Project: ${input.projectLabel?.trim() || input.projectId}`,
    `Range: ${input.rangeStartDate} → ${input.rangeEndDate} · ${uniqueDays} day${uniqueDays === 1 ? '' : 's'} with activity`,
    `Chains: ${input.chains.length}   Total active: ${formatDurationMinutesBlock(totalMs)}`,
  ].join('\n')
}

export function buildRangeSummaryUserPromptBlock(input: RangeSummaryContractInput): string {
  const parts: string[] = [computeAggregateBlock(input), '', '---', '']
  const ranked = [...input.chains].sort((a, b) => b.durationMs - a.durationMs)
  for (let i = 0; i < ranked.length; i += 1) {
    parts.push(formatChainSectionBlock(ranked[i], i))
    parts.push('')
  }
  parts.push('---')
  parts.push('OUTPUT:')
  return parts.join('\n')
}

// Trim the model's raw output down to the well-formed numbered-bullet body:
// drop preamble before the first `1.` line and any trailing text past a
// hard character cap. Keeps blank lines inside bullets, collapses runs.
function sanitizeBody(raw: string): string {
  const stripped = raw.replace(/^```(?:markdown|md)?\s*/i, '').replace(/```\s*$/i, '').trim()
  const lines = stripped.split('\n')
  let firstBullet = -1
  for (let i = 0; i < lines.length; i += 1) {
    if (/^\s*1\.\s/.test(lines[i])) {
      firstBullet = i
      break
    }
  }
  const body = firstBullet >= 0 ? lines.slice(firstBullet).join('\n') : stripped
  const collapsed = body.replace(/\n{3,}/g, '\n\n').trim()
  // Approximate cap — MAX_BULLET_CHARS × MAX_ARCS-ish; give room for the
  // tail bullets too. Only kicks in on runaway outputs.
  return truncateAtWord(collapsed, MAX_BULLET_CHARS * MAX_ARCS)
}

export const rangeSummaryContract = defineContractBlock({
  id: 'range-summary',
  promptVersion: 1,
  outputSchema: s.string({ description: 'Numbered-bullet range summary body' }),
  buildRequest: (input: RangeSummaryContractInput, ctx) => ({
    system: SYSTEM_PROMPT,
    messages: [
      { role: 'user' as const, content: buildRangeSummaryUserPromptBlock(input) },
    ],
    // Output is a modest bullet list — 6-8 bullets, ~50-100 tokens each.
    // Bump the floor so Qwen has room without the response being clipped.
    maxTokens: Math.max(ctx.recommendedMaxTokens, 900),
    temperature: 0.2,
  }),
  finalize: (raw: string, _input: RangeSummaryContractInput): ContractOutput<RangeSummaryOutput> | null => {
    const body = sanitizeBody(raw)
    if (!body) return null
    return { value: { body }, meta: {} }
  },
  cacheKey: (input: RangeSummaryContractInput) => {
    const keyParts = input.chains
      .map(c => `${c.chainKey}:${c.durationMs}`)
      .sort()
      .join('|')
    return `${input.projectId}#${input.rangeStartDate}#${input.rangeEndDate}#${keyParts}`
  },
})

export { SYSTEM_PROMPT as RANGE_SUMMARY_SYSTEM_PROMPT }
