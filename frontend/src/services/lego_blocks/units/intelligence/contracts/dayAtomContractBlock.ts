import { defineContractBlock, type ContractOutput } from '../promptContractBlock'
import { s } from '../schemaBlock'

// Contract that composes a day's chain-level digests into a single-day
// project atom — one headline, one "why it matters", one "what to watch
// next". Runs once per (project, date) and cached in the intelligence
// sidecar; the atom orchestrator handles invalidation via inputHash.
//
// Output is delimited plain text (HEADLINE / WHY / NEXT sections) rather
// than JSON — same reasoning as the chain-digest contract: small local
// models (Qwen, Gemma, Llama-3-8B) follow labeled-section layouts far more
// reliably than they follow strict JSON schemas.

const MAX_HEADLINE_CHARS = 180
const MAX_WHY_CHARS = 480
const MAX_NEXT_CHARS = 320

export interface DayAtomContractInput {
  projectId: string
  /** Human-facing project label if the raw projectId is a path — the model
   *  should never echo path segments. Falls back to projectId when absent. */
  projectLabel?: string
  date: string
  chainDigests: Array<{
    chainKey: string
    title: string
    summary: string
    durationMs: number
  }>
  previousAtomAnchor?: {
    date: string
    headline: string
  }
}

export interface DayAtomOutput {
  headline: string
  whyItMatters: string
  nextSignal: string
}

const SYSTEM_PROMPT = [
  'You compose one day of AI-assisted project work into a short daily',
  'atom: a headline, a "why it matters" paragraph, and a forward-looking',
  '"what to watch next" line. You are given a list of per-session',
  'digests (each with a title and a numbered-bullet summary) for one',
  'project on one calendar date, and optionally the previous day\'s atom',
  'headline as an anchor.',
  '',
  'OUTPUT FORMAT (strict, three labeled sections in this exact order):',
  '  HEADLINE: <one line — the day\'s dominant arc>',
  '  WHY: <1-3 sentences on why this day mattered for the project>',
  '  NEXT: <one line on open loops, next step, or thing to watch>',
  '',
  'Example (three related coding sessions in a day):',
  '  HEADLINE: Auth middleware landed + settings modal fallout',
  '  WHY: This closes the compliance blocker that had been open since the',
  '  last legal review — session-token storage is now signed-cookie only,',
  '  and the settings-modal regressions surfaced during rollout got',
  '  patched same day. The retry-backoff tweak is unrelated but rides',
  '  along cleanly.',
  '  NEXT: Watch for the mobile client\'s next release cut — it still',
  '  reads the old token format and will need the migration path.',
  '',
  'Example (a single research/writing arc):',
  '  HEADLINE: TSMC capacity note landed for Q3 planning',
  '  WHY: First proper capacity model tied to announced demand rather',
  '  than raw wafer starts; three named risks and one open question',
  '  give planning something to push against.',
  '  NEXT: Chase down the Arizona ramp timing — the upstream sheet',
  '  needs correction before the next planning pass.',
  '',
  'RULES:',
  '  - NO preamble, NO trailing meta-notes, NO markdown headings or',
  '    code fences. Just the three labeled lines.',
  '  - Use the work-voice ("Landed X", "Caught Y", "Deferred Z"). Never',
  '    "the user" / "the assistant" / "you".',
  '  - Concrete nouns: name the feature, file, company, or decision.',
  '    Don\'t say "some work" when the chain titles name real things.',
  '  - HEADLINE leads with the dominant arc. If the day held multiple',
  '    unrelated threads, mention a second briefly with `+` or `;`.',
  '  - WHY is about significance, not a re-list of what happened. If',
  '    a previous-day anchor was supplied, you may reference it in one',
  '    short clause ("continues yesterday\'s X…").',
  '  - NEXT is a single forward-looking line: an open loop, a thing to',
  '    check, or "hold" if the day was self-contained. Never a to-do list.',
  '  - If the day had one tiny session or nothing substantive, write',
  '    HEADLINE: (quiet day) / WHY: <one short line> / NEXT: hold.',
].join('\n')

function truncateAtWord(value: string, max: number): string {
  if (value.length <= max) return value
  const cut = value.slice(0, max)
  const lastSpace = cut.lastIndexOf(' ')
  const base = lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut
  return `${base.trimEnd()}…`
}

function stripLabelPrefix(line: string): string {
  return line.replace(/^(headline|why|next|next signal|why it matters)\s*[:\-—]\s*/i, '').trim()
}

function stripWrappers(line: string): string {
  return line
    .replace(/^[*\-•>\s]+/, '')
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .replace(/^\*\*|\*\*$/g, '')
    .trim()
}

// Pulls three labeled sections out of the raw model output. Tolerates
// variations: label on its own line, label + inline body, missing sections.
// Missing HEADLINE is the only fatal case — orchestrator falls through to
// the stub generator when we return null.
function parseSectionsBlock(raw: string): DayAtomOutput | null {
  const lines = raw.split('\n')
  const buf: { headline: string[]; why: string[]; next: string[]; other: string[] } = {
    headline: [], why: [], next: [], other: [],
  }
  let current: keyof typeof buf = 'other'
  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) {
      if (current === 'why' || current === 'headline') buf[current].push('')
      continue
    }
    const headlineMatch = /^headline\s*[:\-—]\s*(.*)$/i.exec(line)
    if (headlineMatch) {
      current = 'headline'
      const inline = headlineMatch[1].trim()
      if (inline) buf.headline.push(inline)
      continue
    }
    const whyMatch = /^(?:why(?: it matters)?)\s*[:\-—]\s*(.*)$/i.exec(line)
    if (whyMatch) {
      current = 'why'
      const inline = whyMatch[1].trim()
      if (inline) buf.why.push(inline)
      continue
    }
    const nextMatch = /^next(?:\s*signal)?\s*[:\-—]\s*(.*)$/i.exec(line)
    if (nextMatch) {
      current = 'next'
      const inline = nextMatch[1].trim()
      if (inline) buf.next.push(inline)
      continue
    }
    buf[current].push(stripWrappers(line))
  }
  const headline = stripWrappers(stripLabelPrefix(buf.headline.join(' ').replace(/\s+/g, ' ').trim()))
  if (!headline) return null
  const whyRaw = buf.why.join(' ').replace(/\s+/g, ' ').trim()
  const nextRaw = buf.next.join(' ').replace(/\s+/g, ' ').trim()
  return {
    headline: truncateAtWord(headline, MAX_HEADLINE_CHARS),
    whyItMatters: truncateAtWord(stripWrappers(whyRaw), MAX_WHY_CHARS),
    nextSignal: truncateAtWord(stripWrappers(nextRaw), MAX_NEXT_CHARS),
  }
}

function formatChainSectionBlock(digest: DayAtomContractInput['chainDigests'][number], idx: number): string {
  const mins = Math.max(1, Math.round(digest.durationMs / 60_000))
  const lines: string[] = [`### Session ${idx + 1} — ${digest.title} (${mins}m)`]
  const summary = digest.summary?.trim()
  if (summary) lines.push(summary)
  return lines.join('\n')
}

function buildUserPromptBlock(input: DayAtomContractInput): string {
  const label = input.projectLabel?.trim() || input.projectId
  const parts: string[] = []
  parts.push(`Project: ${label}`)
  parts.push(`Date: ${input.date}`)
  parts.push(`Chains this day: ${input.chainDigests.length}`)
  if (input.previousAtomAnchor) {
    parts.push('')
    parts.push(`Yesterday (${input.previousAtomAnchor.date}): ${input.previousAtomAnchor.headline}`)
  }
  parts.push('')
  parts.push('---')
  parts.push('')
  const ranked = [...input.chainDigests].sort((a, b) => b.durationMs - a.durationMs)
  for (let i = 0; i < ranked.length; i += 1) {
    parts.push(formatChainSectionBlock(ranked[i], i))
    parts.push('')
  }
  parts.push('---')
  parts.push('OUTPUT:')
  return parts.join('\n')
}

export const dayAtomContract = defineContractBlock({
  id: 'day-atom',
  promptVersion: 1,
  outputSchema: s.string({ description: 'HEADLINE / WHY / NEXT labeled sections' }),
  buildRequest: (input: DayAtomContractInput, ctx) => ({
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user' as const, content: buildUserPromptBlock(input) }],
    // Atom output is short prose. Reasoning models may still leak thinking
    // tokens before the labeled sections; the sanitizer discards them.
    maxTokens: Math.max(ctx.recommendedMaxTokens, 480),
    temperature: 0.25,
  }),
  finalize: (raw: string, _input: DayAtomContractInput): ContractOutput<DayAtomOutput> | null => {
    const parsed = parseSectionsBlock(raw)
    if (!parsed) return null
    return { value: parsed, meta: {} }
  },
  cacheKey: (input: DayAtomContractInput) => {
    const digestPart = input.chainDigests
      .map(d => `${d.chainKey}:${d.title}`)
      .sort()
      .join('|')
    const anchor = input.previousAtomAnchor
      ? `${input.previousAtomAnchor.date}:${input.previousAtomAnchor.headline}`
      : ''
    return `${input.projectId}#${input.date}#${digestPart}#${anchor}`
  },
})
