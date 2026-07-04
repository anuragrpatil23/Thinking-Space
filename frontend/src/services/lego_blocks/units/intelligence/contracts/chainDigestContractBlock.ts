import type { ActivityChain } from '@/services/lego_blocks/units/aiActivityParserBlock'
import { defineContractBlock, type ContractOutput } from '../promptContractBlock'
import { s } from '../schemaBlock'
import {
  CHAIN_DIGEST_LEAK_PREFIX_RE,
  CHAIN_DIGEST_USER_QUOTE_LEAD_RE,
  extractChainContextBlock,
  formatSessionShapeBlock,
  stripWrappersBlock,
} from './chainContextExtractionBlock'

// Contract that produces both a one-line TITLE and a 1-3 sentence SUMMARY
// for one activity chain. Replaces the earlier `session-title` contract —
// callers now get durable per-chain content instead of just a label.
//
// Output format is delimited plain text, not JSON. Small local models
// (Qwen, Gemma, Llama-3-8B) reliably follow a "TITLE:" + blank line +
// summary layout but stumble on strict JSON — string schema keeps this
// contract portable across the openai-compat provider matrix.

const MAX_TITLE_CHARS = 240
// Deep ideation sessions (e.g. sfpi) legitimately produce 7 numbered bullets
// ~200 chars each ≈ 1400 chars. Cap gives headroom without being loose.
const MAX_SUMMARY_CHARS = 1800

const TITLE_LINE_RE = /^\s*(?:title\s*[:\-—]\s*)?(.+)$/i

function sanitizeTitle(raw: string, projectName: string): string | null {
  const lines = raw.split('\n').map(stripWrappersBlock).filter(Boolean)
  let pick: string | null = null
  for (const rawLine of lines) {
    let line = rawLine
    for (let i = 0; i < 2; i += 1) {
      const next = line.replace(CHAIN_DIGEST_LEAK_PREFIX_RE, '').trim()
      if (next === line) break
      line = next
    }
    line = stripWrappersBlock(line)
    if (!line) continue
    if (CHAIN_DIGEST_USER_QUOTE_LEAD_RE.test(line)) continue
    if (line.split(/\s+/).length < 3) continue
    pick = line
    break
  }
  if (!pick) return null
  pick = pick.replace(/^(topic( label)?|title|label|summary|description|project)\s*[:\-—]\s*/i, '').trim()
  pick = pick.replace(/[.!?;]+$/, '').trim()
  if (!pick) return null
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
  // Preserve newlines — the summary body is numbered bullets, not prose,
  // so collapsing whitespace would destroy the shape. Just strip leading
  // labels the model sometimes emits and collapse >2 blank lines.
  const cleaned = raw
    .split('\n')
    .map(l => l.replace(/^(summary|body|notes)\s*[:\-—]\s*/i, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  if (!cleaned) return ''
  if (cleaned.length <= MAX_SUMMARY_CHARS) return cleaned
  const cut = cleaned.slice(0, MAX_SUMMARY_CHARS)
  // Try to end at the last complete bullet (line starting with `N.`); fall
  // back to the last sentence-terminating punctuation.
  const bulletEnds: number[] = []
  const re = /\n\d+\.\s/g
  let m: RegExpExecArray | null
  while ((m = re.exec(cut)) !== null) bulletEnds.push(m.index)
  const lastBullet = bulletEnds.length ? bulletEnds[bulletEnds.length - 1] : -1
  if (lastBullet > MAX_SUMMARY_CHARS * 0.6) return cut.slice(0, lastBullet).trimEnd() + '…'
  const lastPunct = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '))
  return (lastPunct > MAX_SUMMARY_CHARS * 0.6 ? cut.slice(0, lastPunct + 1) : cut).trim() + '…'
}

const SYSTEM_PROMPT = [
  'You describe what an AI-assisted session was about, in two parts: a',
  'title and a numbered-bullet summary. Sessions cover anything — coding,',
  'business research, studying, writing, math, life planning. Stay neutral',
  'on domain; describe the actual subject.',
  '',
  'INPUT FORMAT:',
  '  Line 1 is a session shape line (turn / tool-call counts).',
  '  Then alternating turns marked `USER:` and `ASST:` in original order.',
  '  Long turns may show `[…Nc omitted…]` mid-turn — that\'s a middle',
  '  section snipped for length. Work with what\'s there.',
  '  Tool_use JSON payloads and tool_results are already filtered out;',
  '  slash-commands and mid-loop assistant stubs too. What remains is signal.',
  '',
  'OUTPUT FORMAT (strict):',
  '  Line 1 must be: TITLE: <one line, no line breaks>',
  '  Line 2 must be blank.',
  '  Lines 3+ are the summary body as a numbered bullet list — one bullet',
  '  per distinct sub-task or phase of the session. Use `1.` `2.` `3.`',
  '  prefixes with a period.',
  '',
  '  Example (multi-task coding session — three unrelated bugs):',
  '  TITLE: Auth middleware token-storage fix + settings modal polish',
  '',
  '  1. Refactored auth middleware to stop storing raw session tokens',
  '     — moved storage into a signed-cookie helper and updated the two',
  '     callers. Legal-driven change flagged in the last compliance pass.',
  '  2. Fixed the settings modal briefly rendering the previous user\'s',
  '     avatar during account switch (races with the auth swap).',
  '  3. Tightened the retry backoff on the sync worker: exponential with',
  '     jitter capped at 30s, was previously fixed at 5s.',
  '',
  '  Example (single-arc research/writing session):',
  '  TITLE: Wrote the TSMC capacity note for Q3 planning',
  '',
  '  1. Read the last two TSMC earnings calls and pulled the wafer-capacity',
  '     numbers into a working table under Semiconductor/Foundry/TSMC/.',
  '  2. Landed the note at Q3-planning/tsmc-capacity.md — capacity vs.',
  '     announced demand, three named risks, one open question about',
  '     Arizona ramp timing.',
  '  3. Caught a units inconsistency in the source data (300mm equivalents',
  '     vs raw wafer starts) — normalized in the note and flagged the',
  '     upstream sheet for correction.',
  '',
  'RULES:',
  '  - NO preamble ("Here is the output", "Looking at the input"). NO',
  '    trailing meta-notes. NO quoting the user verbatim. NO markdown',
  '    headings or code fences.',
  '  - Bullet count = number of distinct sub-tasks. Usually 1-5; up to 7',
  '    for a deep ideation session; 1 for a tight single-issue session.',
  '  - Never refer to "the user" or "the assistant". Use the work-voice:',
  '    "Added X", "Caught Y", "Landed Z", "Deferred W".',
  '  - Concrete nouns: name the feature, file, company, decision. Avoid',
  '    generic words like "prompt", "request", "skill", "changes" when a',
  '    real noun exists.',
  '  - Title should lead with the dominant work; if the session touched',
  '    multiple things, mention a second briefly with `+` or `;`.',
  '  - Open loops (things left unfinished, script bugs flagged, questions',
  '    for later) appear as narrative inside a bullet — never as their own',
  '    structured field.',
  '  - If nothing substantive happened (session was empty scratch or a',
  '    single slash-command), write "TITLE: (empty session)" and one',
  '    bullet noting that; stop there.',
].join('\n')

async function buildUserPromptBlock(chain: ActivityChain): Promise<string> {
  const ctx = await extractChainContextBlock(chain)
  if (ctx.turns.length === 0 && chain.topic) {
    ctx.turns.push({ role: 'user', text: chain.topic, order: 0 })
  }
  const lines: string[] = [formatSessionShapeBlock(ctx.meta), '']
  for (const turn of ctx.turns) {
    lines.push(`${turn.role === 'user' ? 'USER' : 'ASST'}: ${turn.text}`)
    lines.push('')
  }
  lines.push('---')
  lines.push('OUTPUT:')
  return lines.join('\n')
}

// The extraction step reads native JSONL from disk to find recaps. The
// orchestrator's buildRequest hook is sync, so we pre-flight the extraction
// here and stash the result on the input via WeakMap.
const PREPARED = new WeakMap<ActivityChain, string>()

export async function prepareChainDigestInputBlock(chain: ActivityChain): Promise<void> {
  if (PREPARED.has(chain)) return
  const prompt = await buildUserPromptBlock(chain)
  PREPARED.set(chain, prompt)
}

export interface ChainDigestOutput {
  title: string
  summary: string
}

function splitTitleAndSummary(raw: string): { title: string; summary: string } {
  const lines = raw.split('\n')
  let titleIdx = -1
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim()
    if (!line) continue
    if (/^title\s*[:\-—]/i.test(line)) {
      titleIdx = i
      break
    }
    // Model dropped the TITLE: prefix — treat the first substantive line as
    // the title anyway, keep the rest as summary.
    titleIdx = i
    break
  }
  if (titleIdx < 0) return { title: '', summary: '' }
  const titleRaw = lines[titleIdx].replace(/^title\s*[:\-—]\s*/i, '').trim()
  const titleMatch = TITLE_LINE_RE.exec(titleRaw)
  const title = titleMatch ? titleMatch[1].trim() : titleRaw
  const summary = lines.slice(titleIdx + 1).join('\n').trim()
  return { title, summary }
}

export const chainDigestContract = defineContractBlock({
  id: 'chain-digest',
  promptVersion: 2,
  outputSchema: s.string({ description: 'TITLE line + blank line + summary body' }),
  buildRequest: (chain: ActivityChain, ctx) => {
    const userPrompt = PREPARED.get(chain)
    // Fallback prompt for callers that skipped the async prepare step —
    // matches the new interleaved-turns shape with just the topic as the
    // sole user turn.
    const prompt = userPrompt ?? [
      'session shape: 1 substantive turn · 0 tool calls',
      '',
      `USER: ${chain.topic || '(none)'}`,
      '',
      '---',
      'OUTPUT:',
    ].join('\n')
    return {
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user' as const, content: prompt }],
      maxTokens: Math.max(ctx.recommendedMaxTokens, 320),
      temperature: 0.2,
    }
  },
  finalize: (raw: string, chain: ActivityChain): ContractOutput<ChainDigestOutput> | null => {
    const { title: rawTitle, summary: rawSummary } = splitTitleAndSummary(raw)
    const title = sanitizeTitle(rawTitle, chain.project)
    if (!title) return null
    const summary = sanitizeSummary(rawSummary)
    return { value: { title, summary }, meta: {} }
  },
  cacheKey: (chain: ActivityChain) => {
    const first = chain.sessions[0]?.sessionId ?? chain.key
    return `${first}#${chain.msgCount}`
  },
})
