import { defineContractBlock, type ContractOutput } from '../promptContractBlock'
import { s } from '../schemaBlock'

// Contract that composes several SESSION digests into one chain-level digest.
//
// This is the second-order call, and it is deliberately cheap: its input is a
// handful of short summaries, not transcripts. The expensive read of raw
// material happened once per session, below this.
//
// WHY THIS EXISTS AT ALL
//
// A chain is a *time* grouping — same project, within the idle gap, no overlap,
// no `/clear`. Most of the time that is one sitting and this contract never
// runs (see the pass-through in `aiActivityChainDigestOrch`: 64% of chains in a
// real vault have a single member). It runs for the case the chain abstraction
// was actually built for: you closed the terminal, came back twenty minutes
// later on the same project, and experienced one continuous piece of work.
//
// WHY THIS SHOULD READ BETTER THAN THE OLD WHOLE-CHAIN DIGEST
//
// The old path fed the model up to five interleaved transcripts under ONE input
// budget, per-turn trimmed, then dropped turns from the middle of the merged
// stream until it fit. A two-session chain therefore reached the model with
// each session already thinned by roughly half; a six-session chain silently
// lost its sixth entirely. This path gives every session the full budget on its
// own, and then composes complete summaries. The model here never has to guess
// what was cut.
//
// The risk this trades for is different in kind and worth naming: composition
// can only work with what the session summaries captured, so a detail no
// session digest mentioned cannot be recovered at this layer. That is why the
// prompt below forbids inventing connective tissue — a chain summary that
// asserts a causal link the sessions did not state would be a fabrication the
// old path could not have produced.

const MAX_TITLE_CHARS = 240
const MAX_SUMMARY_CHARS = 1800

export interface ChainStitchSessionInput {
  /** Local clock time of the sitting, e.g. `1:52pm–3:09pm`. Ordering context
   *  for the model; it reasons about "then" without being handed timestamps. */
  when: string
  title: string
  summary: string
}

export interface ChainStitchContractInput {
  projectLabel: string
  /** Member sittings, earliest first. Always length >= 2 — a single-session
   *  chain is a pass-through and never reaches this contract. */
  sessions: ChainStitchSessionInput[]
}

export interface ChainStitchOutput {
  title: string
  summary: string
}

const SYSTEM_PROMPT = [
  'You are given summaries of consecutive work sittings that belong to one',
  'stretch of work on the same project — the user closed their tool and came',
  'back, or ran two windows back to back. Compose them into a single title',
  'and summary describing the stretch as a whole.',
  '',
  'INPUT FORMAT:',
  '  One block per sitting, in time order, each with a time range, a title',
  '  and a numbered-bullet summary.',
  '',
  'OUTPUT FORMAT (strict):',
  '  Line 1 must be: TITLE: <one line, no line breaks>',
  '  Line 2 must be blank.',
  '  Lines 3+ are a numbered bullet list — one bullet per distinct piece of',
  '  work across the whole stretch. Use `1.` `2.` `3.` prefixes.',
  '',
  '  Example (two sittings, one continuing thread):',
  '  TITLE: Rewrote the sync worker retry path, then fixed the fallout',
  '',
  '  1. Replaced the sync worker\'s fixed 5s retry with exponential backoff',
  '     plus jitter, capped at 30s.',
  '  2. Traced the resulting duplicate-write bug to the now-longer retry',
  '     window and made the write idempotent on the job id.',
  '  3. Left the dashboard\'s retry counter showing pre-backoff numbers —',
  '     flagged, not fixed.',
  '',
  'RULES:',
  '  - MERGE work that continues across sittings into one bullet. That is the',
  '    entire reason to compose rather than concatenate: if sitting 2 finished',
  '    or fixed what sitting 1 started, say so as one arc.',
  '  - KEEP work that is genuinely separate as separate bullets. These',
  '    sittings are grouped by TIME, not by topic, so they may well be about',
  '    unrelated things. Two unrelated sittings must read as two bullets, not',
  '    be forced into a false narrative.',
  '  - NEVER invent a connection. If the summaries do not say that one piece',
  '    of work led to another, do not assert that it did. Adjacent in time is',
  '    not the same as caused by.',
  '  - NEVER add facts absent from the input. You are composing summaries,',
  '    not the original sessions — anything not written below is unavailable',
  '    to you, and guessing at it is the one failure this layer can produce',
  '    that the per-session layer cannot.',
  '  - NO preamble, NO trailing meta-notes, NO markdown headings or fences.',
  '  - Do not mention "sittings", "sessions", "windows" or the fact that this',
  '    was composed. Describe the work, not its packaging.',
  '  - Never refer to "the user" or "the assistant". Work-voice: "Added X",',
  '    "Caught Y", "Landed Z", "Deferred W".',
  '  - Title should lead with the dominant work across the whole stretch; if',
  '    it covered unrelated things, join them briefly with `+` or `;`.',
].join('\n')

function sanitizeTitle(raw: string, projectName: string): string | null {
  let pick = raw.trim()
  if (!pick) return null
  pick = pick
    .replace(/^(topic( label)?|title|label|summary|description|project)\s*[:\-—]\s*/i, '')
    .trim()
  pick = pick.replace(/[.!?;]+$/, '').trim()
  if (!pick) return null
  if (pick.split(/\s+/).length < 3) return null
  const normalize = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, '')
  if (projectName && normalize(pick) === normalize(projectName)) return null
  if (pick.length > MAX_TITLE_CHARS) {
    const cut = pick.slice(0, MAX_TITLE_CHARS)
    const lastSpace = cut.lastIndexOf(' ')
    pick = (lastSpace > MAX_TITLE_CHARS * 0.6 ? cut.slice(0, lastSpace) : cut).trim() + '…'
  }
  return pick
}

function sanitizeSummary(raw: string): string {
  const cleaned = raw
    .split('\n')
    .map(l => l.replace(/^(summary|body|notes)\s*[:\-—]\s*/i, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  if (!cleaned || cleaned.length <= MAX_SUMMARY_CHARS) return cleaned
  const cut = cleaned.slice(0, MAX_SUMMARY_CHARS)
  const bulletEnds: number[] = []
  const re = /\n\d+\.\s/g
  let m: RegExpExecArray | null
  while ((m = re.exec(cut)) !== null) bulletEnds.push(m.index)
  const lastBullet = bulletEnds.length ? bulletEnds[bulletEnds.length - 1] : -1
  if (lastBullet > MAX_SUMMARY_CHARS * 0.6) return cut.slice(0, lastBullet).trimEnd() + '…'
  const lastPunct = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '))
  return (lastPunct > MAX_SUMMARY_CHARS * 0.6 ? cut.slice(0, lastPunct + 1) : cut).trim() + '…'
}

function splitTitleAndSummary(raw: string): { title: string; summary: string } {
  const lines = raw.split('\n')
  let titleIdx = -1
  for (let i = 0; i < lines.length; i += 1) {
    if (!lines[i].trim()) continue
    titleIdx = i
    break
  }
  if (titleIdx < 0) return { title: '', summary: '' }
  const title = lines[titleIdx].replace(/^title\s*[:\-—]\s*/i, '').trim()
  return { title, summary: lines.slice(titleIdx + 1).join('\n').trim() }
}

export function buildChainStitchPromptBlock(input: ChainStitchContractInput): string {
  const lines: string[] = [`project: ${input.projectLabel}`, '']
  input.sessions.forEach((session, i) => {
    lines.push(`SITTING ${i + 1} · ${session.when}`)
    lines.push(`TITLE: ${session.title}`)
    if (session.summary) lines.push(session.summary)
    lines.push('')
  })
  lines.push('---')
  lines.push('OUTPUT:')
  return lines.join('\n')
}

export const chainStitchContract = defineContractBlock({
  id: 'chain-stitch',
  promptVersion: 1,
  outputSchema: s.string({ description: 'TITLE line + blank line + summary body' }),
  buildRequest: (input: ChainStitchContractInput) => ({
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user' as const, content: buildChainStitchPromptBlock(input) }],
    temperature: 0.2,
  }),
  finalize: (
    raw: string,
    input: ChainStitchContractInput,
  ): ContractOutput<ChainStitchOutput> | null => {
    const { title: rawTitle, summary: rawSummary } = splitTitleAndSummary(raw)
    const title = sanitizeTitle(rawTitle, input.projectLabel)
    if (!title) return null
    return { value: { title, summary: sanitizeSummary(rawSummary) }, meta: {} }
  },
  // Content-addressed: the members' own titles and summaries are the entire
  // input, so hashing them is exact. Nothing positional appears here — this
  // memo is keyed by what it summarizes, never by where the chain sits.
  cacheKey: (input: ChainStitchContractInput) => {
    const material = input.sessions.map(s => `${s.title} ${s.summary}`).join('')
    let hash = 5381
    for (let i = 0; i < material.length; i += 1) {
      hash = ((hash << 5) + hash + material.charCodeAt(i)) | 0
    }
    return `${input.sessions.length}#${(hash >>> 0).toString(36)}`
  },
})
