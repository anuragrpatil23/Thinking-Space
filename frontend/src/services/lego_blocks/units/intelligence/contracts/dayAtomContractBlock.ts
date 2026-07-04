import { defineContractBlock, type ContractOutput } from '../promptContractBlock'
import { s } from '../schemaBlock'

// Contract that composes a day's chain-level digests into a single-day
// project atom — a HEADLINE and a WHY-it-matters paragraph. Runs once
// per (project, date) and cached in the intelligence sidecar; the atom
// orchestrator handles invalidation via inputHash.
//
// Output is delimited plain text (HEADLINE / WHY sections) rather than
// JSON — same reasoning as the chain-digest contract: small local
// models (Qwen, Gemma, Llama-3-8B) follow labeled-section layouts far
// more reliably than they follow strict JSON schemas.

const MAX_HEADLINE_CHARS = 180
const MAX_WHY_CHARS = 480

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
}

const SYSTEM_PROMPT = [
  'You compose one day of AI-assisted project work into a short daily',
  'atom: a headline and a "why it matters" paragraph. You are given a',
  'list of per-session digests (each with a title and a numbered-bullet',
  'summary) for one project on one calendar date, and optionally the',
  'previous day\'s atom headline as an anchor.',
  '',
  'OUTPUT FORMAT (strict, two labeled sections in this exact order):',
  '  HEADLINE: <one line — the day\'s dominant arc>',
  '  WHY: <1-3 sentences on why this day mattered for the project>',
  '',
  'Example (three related coding sessions in a day):',
  '  HEADLINE: Auth middleware landed + settings modal fallout',
  '  WHY: This closes the compliance blocker that had been open since the',
  '  last legal review — session-token storage is now signed-cookie only,',
  '  and the settings-modal regressions surfaced during rollout got',
  '  patched same day. The retry-backoff tweak is unrelated but rides',
  '  along cleanly.',
  '',
  'Example (a single research/writing arc):',
  '  HEADLINE: TSMC capacity note landed for Q3 planning',
  '  WHY: First proper capacity model tied to announced demand rather',
  '  than raw wafer starts; three named risks and one open question',
  '  give planning something to push against.',
  '',
  'RULES:',
  '  - NO preamble, NO trailing meta-notes, NO markdown headings or',
  '    code fences. Just the two labeled sections.',
  '  - Use the work-voice ("Landed X", "Caught Y", "Deferred Z"). Never',
  '    "the user" / "the assistant" / "you".',
  '  - Concrete nouns: name the feature, file, company, or decision.',
  '    Don\'t say "some work" when the chain titles name real things.',
  '  - HEADLINE leads with the dominant arc. If the day held multiple',
  '    unrelated threads, mention a second briefly with `+` or `;`.',
  '  - WHY is about significance, not a re-list of what happened. If',
  '    a previous-day anchor was supplied, you may reference it in one',
  '    short clause ("continues yesterday\'s X…").',
  '  - If the day had one tiny session or nothing substantive, write',
  '    HEADLINE: (quiet day) / WHY: <one short line>.',
].join('\n')

function truncateAtWord(value: string, max: number): string {
  if (value.length <= max) return value
  const cut = value.slice(0, max)
  const lastSpace = cut.lastIndexOf(' ')
  const base = lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut
  return `${base.trimEnd()}…`
}

function stripLabelPrefix(line: string): string {
  return line.replace(/^(headline|why|why it matters)\s*[:\-—]\s*/i, '').trim()
}

function stripWrappers(line: string): string {
  return line
    .replace(/^[*\-•>\s]+/, '')
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .replace(/^\*\*|\*\*$/g, '')
    .trim()
}

// Pulls two labeled sections out of the raw model output. Tolerates
// variations: label on its own line, label + inline body, missing WHY.
// Missing HEADLINE is the only fatal case — orchestrator falls through
// to the stub generator when we return null. Any stray NEXT: line the
// model still emits (despite the prompt) is dropped silently.
function parseSectionsBlock(raw: string): DayAtomOutput | null {
  const lines = raw.split('\n')
  const buf: { headline: string[]; why: string[]; other: string[] } = {
    headline: [], why: [], other: [],
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
    // Drop any stray NEXT: (or "Next Signal:") section the model still
    // emits — it's no longer part of the atom shape.
    if (/^next(?:\s*signal)?\s*[:\-—]/i.test(line)) {
      current = 'other'
      continue
    }
    buf[current].push(stripWrappers(line))
  }
  const headline = stripWrappers(stripLabelPrefix(buf.headline.join(' ').replace(/\s+/g, ' ').trim()))
  if (!headline) return null
  const whyRaw = buf.why.join(' ').replace(/\s+/g, ' ').trim()
  return {
    headline: truncateAtWord(headline, MAX_HEADLINE_CHARS),
    whyItMatters: truncateAtWord(stripWrappers(whyRaw), MAX_WHY_CHARS),
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
  promptVersion: 2,
  outputSchema: s.string({ description: 'HEADLINE / WHY labeled sections' }),
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
