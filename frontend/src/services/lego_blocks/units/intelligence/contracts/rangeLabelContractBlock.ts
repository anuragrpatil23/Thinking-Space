import { defineContractBlock, type ContractOutput } from '../promptContractBlock'
import { s } from '../schemaBlock'

// Stage 1 of the local two-stage range-summary pipeline: given a range of
// chain digests, propose 3-6 themes and assign each chain to one. We do the
// hard aggregation deterministically in code afterwards — the model just
// answers "which sessions share a workstream?" once.
//
// Output is delimited plain text (THEMES: / ASSIGNMENTS: sections) rather
// than JSON, same reasoning as the chain-digest + day-atom contracts:
// small local models follow labeled layouts far more reliably than strict
// JSON schemas.

export interface RangeLabelChainInput {
  chainKey: string
  /** Short key the model uses in its output — e.g. "S1", "S2". */
  shortKey: string
  title: string
  /** First bullet of the chain's summary; enough context for grouping
   *  without swamping attention. */
  firstBulletHint?: string
}

export interface RangeLabelContractInput {
  projectId: string
  projectLabel?: string
  rangeStartDate: string
  rangeEndDate: string
  chains: RangeLabelChainInput[]
}

/** Themes proposed + per-chain assignment. Themes list is 1-indexed as the
 *  model sees it; the caller flattens `chainKey → theme name` for clustering. */
export interface RangeLabelOutput {
  themes: string[]
  assignments: Record<string, number>
}

const SYSTEM_PROMPT = [
  'You are a THEME CLUSTERER for a range of AI-assisted work sessions.',
  '',
  'Given N sessions (title + first bullet each), propose 3 to 6 THEMES that',
  'describe the whole range at a workstream level, then assign every session',
  'to exactly one theme. Aim LOW on theme count — a range with 12 sessions',
  'usually has 3 or 4 real themes, not 12.',
  '',
  'Naming themes:',
  '  - 2-5 words. No dates. No punctuation-heavy titles.',
  '  - Name the workstream, not the session ("Webull work", "AMD study",',
  '    "auth pipeline overhaul" — NOT "logo fix", "credential decryption").',
  '  - Sessions that touch the same product/file/company almost always',
  '    belong together, even when session titles use different words.',
  '  - If a session doesn\'t fit any real theme, assign it to a theme named',
  '    "Misc". Do not invent a one-item theme for it.',
  '',
  'OUTPUT FORMAT (strict, exact structure, no markdown headings, no preamble):',
  '',
  '  THEMES:',
  '  1. <theme name>',
  '  2. <theme name>',
  '  3. <theme name>',
  '',
  '  ASSIGNMENTS:',
  '  S1 -> 2',
  '  S2 -> 1',
  '  S3 -> 1',
  '',
  'Every session in the input MUST appear in ASSIGNMENTS exactly once.',
  'Assignments reference themes by their number.',
  '',
  'Example input:',
  '  S1: Add Adyen provider adapter',
  '       Wired new charge/refund endpoints against Adyen SDK.',
  '  S2: Wire Adyen webhook signature verification',
  '       Ported HMAC verification and added replay-window check.',
  '  S3: Fix null refund amount edge case',
  '       Refunds with null amount now default to original charge total.',
  '  S4: Rebrand landing page hero section',
  '       Replaced old logo lockup and copy.',
  '  S5: Adyen dashboard failure-taxonomy view',
  '       Wired 6 canonical failure modes into a dashboard.',
  '',
  'Example output:',
  '  THEMES:',
  '  1. Adyen migration',
  '  2. Landing page rebrand',
  '',
  '  ASSIGNMENTS:',
  '  S1 -> 1',
  '  S2 -> 1',
  '  S3 -> 1',
  '  S4 -> 2',
  '  S5 -> 1',
].join('\n')

function buildUserPromptBlock(input: RangeLabelContractInput): string {
  const lines: string[] = []
  input.chains.forEach(c => {
    lines.push(`${c.shortKey}: ${c.title}`)
    if (c.firstBulletHint) lines.push(`       ${c.firstBulletHint}`)
  })
  return lines.join('\n')
}

function parseSectionsBlock(raw: string, chains: RangeLabelChainInput[]): RangeLabelOutput | null {
  const shortKeys = new Set(chains.map(c => c.shortKey))
  const themes = new Map<string, string>()
  const assignments: Record<string, number> = {}
  let mode: 'themes' | 'assign' | null = null
  for (const rawLine of raw.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue
    if (/^themes\s*[:\-—]?\s*$/i.test(line)) { mode = 'themes'; continue }
    if (/^assignments\s*[:\-—]?\s*$/i.test(line)) { mode = 'assign'; continue }
    if (mode === 'themes') {
      const m = /^(\d+)[.)]\s*(.+?)\s*$/.exec(line)
      if (m) {
        const name = m[2].replace(/\*+/g, '').replace(/^["']|["']$/g, '').trim()
        if (name) themes.set(m[1], name)
      }
      continue
    }
    if (mode === 'assign') {
      const m = /^(S\d+)\s*(?:->|→|:)\s*(\d+)\s*$/.exec(line)
      if (m && shortKeys.has(m[1])) assignments[m[1]] = Number(m[2])
      continue
    }
  }
  if (themes.size === 0) return null
  const themeArr: string[] = []
  for (let i = 1; i <= themes.size; i += 1) {
    const t = themes.get(String(i))
    if (t) themeArr.push(t)
  }
  return { themes: themeArr, assignments }
}

export const rangeLabelContract = defineContractBlock({
  id: 'range-summary-label',
  promptVersion: 1,
  outputSchema: s.string({ description: 'THEMES + ASSIGNMENTS labeled sections' }),
  buildRequest: (input: RangeLabelContractInput, ctx) => ({
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user' as const, content: buildUserPromptBlock(input) }],
    maxTokens: Math.max(ctx.recommendedMaxTokens, 500),
    temperature: 0.15,
  }),
  finalize: (raw: string, input: RangeLabelContractInput): ContractOutput<RangeLabelOutput> | null => {
    const parsed = parseSectionsBlock(raw, input.chains)
    if (!parsed) return null
    return { value: parsed, meta: {} }
  },
  cacheKey: (input: RangeLabelContractInput) =>
    `${input.projectId}#label#${input.rangeStartDate}#${input.rangeEndDate}#${input.chains
      .map(c => c.chainKey)
      .sort()
      .join('|')}`,
})
