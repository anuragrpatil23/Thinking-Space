// What a reading sitting was about.
//
// Deliberately the same contract shape as `session-digest` — TITLE line, blank
// line, summary body — so the layers above compose reading and AI sittings
// without knowing the difference. A chain stitch, a range summary and the day
// table all consume digests, and a reading digest that answered in a different
// format would need special-casing in each of them.
//
// What differs is the input, and only the input. An AI sitting is summarised
// from its transcript; a reading sitting has none, so it is summarised from the
// text at the locations where the attention actually settled — pages dwelt on,
// canvas regions rested in. The metrics (how long, how many pages, how deep)
// never reach the model: they are mechanically derived and already exact, and
// asking a model to restate them is the waste `readingDigestBlock` exists to
// avoid. The model sees only prose it could not have computed.
//
// Sittings without enough dwell to have read anything never get here at all —
// `isReadingWorthSummarisingBlock` stops them. Handed forty pages at two
// seconds each, a model produces a confident theme out of nothing, which is
// worse than the honest mechanical sentence it would have replaced.

import type { ParsedSession } from '@/services/lego_blocks/units/aiActivityParserBlock'
import { defineContractBlock, type ContractOutput } from '../promptContractBlock'
import { s } from '../schemaBlock'

const SYSTEM_PROMPT = [
  'You label a reading session from excerpts of what the reader actually spent time on.',
  '',
  'The excerpts are labelled by location — [p.14] is page 14, [region 2] is a',
  'region of a canvas. They are samples, weighted by how long the reader stayed',
  'there, and they are clipped: an excerpt ending in … continues beyond what you',
  'can see.',
  '',
  'Output exactly:',
  '  TITLE: <what this reading was about, max 8 words>',
  '  <blank line>',
  '  <one or two sentences of substance>',
  '',
  'Rules:',
  '  - Name the actual subject matter. "The point-contact transistor" beats',
  '    "Reading about technology history".',
  '  - Say what was covered, not that reading occurred. The reader knows they',
  '    were reading.',
  '  - NEVER mention duration, page counts, or how much was read. Those are',
  '    recorded exactly elsewhere and restating them wastes the answer.',
  '  - Where excerpts come from different locations and disagree in subject,',
  '    say so plainly rather than inventing a thread between them.',
  '  - If the excerpts are too thin to support a claim, title them by their',
  '    apparent subject and keep the body to one hedged sentence. Do not',
  '    manufacture detail that is not present.',
  '  - NO preamble. NO "Here is". NO markdown headers. NO bullet lists.',
].join('\n')

/** `buildRequest` is sync, so the excerpt is pre-flighted and stashed here —
 *  the same WeakMap handoff `session-digest` uses for transcript extraction. */
const PREPARED = new WeakMap<ParsedSession, string>()

export function setReadingDigestInputBlock(session: ParsedSession, excerpt: string): void {
  PREPARED.set(session, excerpt)
}

export function hasReadingDigestInputBlock(session: ParsedSession): boolean {
  const prepared = PREPARED.get(session)
  return typeof prepared === 'string' && prepared.trim().length > 0
}

export interface ReadingDigestOutput {
  title: string
  summary: string
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

export const readingDigestContract = defineContractBlock({
  id: 'reading-digest',
  // v1. Bump whenever what the model *sees* changes — the excerpt budget, the
  // dwell floors that decide which locations are included, or how locations are
  // labelled. All three alter the input without touching any per-record value
  // the freshness hash covers, which is exactly the case DERIVATION.md names as
  // invisible to a hash over inputs.
  promptVersion: 1,
  outputSchema: s.string({ description: 'TITLE line + blank line + summary body' }),
  buildRequest: (session: ParsedSession) => {
    const excerpt = PREPARED.get(session) ?? ''
    const prompt = [
      `reading: ${session.topic || '(untitled)'}`,
      '',
      excerpt,
      '',
      '---',
      'OUTPUT:',
    ].join('\n')
    return {
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user' as const, content: prompt }],
      temperature: 0.2,
    }
  },
  finalize: (raw: string, session: ParsedSession): ContractOutput<ReadingDigestOutput> | null => {
    const { title, summary } = splitTitleAndSummary(raw)
    if (!title) return null
    // A title that is just the document's name says nothing the row does not
    // already show, and is the shape the model falls into when the excerpt was
    // too thin. Rejecting it returns the caller to the mechanical sentence.
    if (title.toLowerCase() === (session.topic ?? '').toLowerCase().trim()) return null
    return { value: { title, summary }, meta: {} }
  },
  // A reading sitting is fixed once it ends, and its excerpt is a function of
  // the span plus the document. The span id covers the first; `activeMs` moves
  // whenever the sitting itself was re-measured (a hide-flush upgraded by a
  // real close), which is the only way a finished sitting's excerpt can change.
  cacheKey: (session: ParsedSession) =>
    `${session.sessionId ?? session.path}#${Math.round((session.activeDurationMs ?? 0) / 1000)}`,
})
